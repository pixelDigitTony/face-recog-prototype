import { describe, it, expect } from 'vitest';
import {
  createDatabase,
  validateDatabase,
} from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { createFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';
import { createMultiEnrollmentWorkflow } from '@/utils/hooks/faceRecognition/workflows/multiEnrollmentWorkflow';
import { associateFacePoses } from '@/utils/hooks/faceRecognition/liveness/associateFacePoses';
import { MULTI_ENROLLMENT_POLICY } from '@/utils/hooks/faceRecognition/liveness/livenessPolicy';

const context = { environment: 'test', companyId: 'company', storeId: null },
  manifest = {
    detector: { sha256: 'd' },
    recognizer: { sha256: 'r' },
    preprocessingVersion: 'v1',
    embeddingDimension: 128,
  };
const vector = (n) => Array.from({ length: 128 }, (_, i) => (i === n ? 1 : 0));
const fixtureFaces = [
  { box: [10, 10, 120, 140], confidence: 0.99, reasonCode: null },
  { box: [300, 10, 120, 140], confidence: 0.99, reasonCode: null },
];
async function harness(
  configuration = { version: 1, turnLeft: false, turnRight: false, blink: false },
) {
  const db = createDatabase(context);
  db.settings.saveThumbnails = false;
  db.settings.enrollmentLiveness = configuration;
  let raw = JSON.stringify(db),
    clock = 0,
    faces = fixtureFaces,
    quota = false;
  const yaw = [0, 0],
    eye = [0, 0];
  const repo = createLocalStorageRepository({
    context,
    storage: {
      getItem: () => raw,
      setItem: (_key, value) => {
        if (quota) throw new Error('quota');
        raw = value;
      },
    },
    locks: { request: (_n, _o, callback) => callback({}) },
    events: null,
  });
  await repo.load();
  const engine = {
    manifest,
    initialize: async () => manifest,
    analyzeFrame: async (_frame, { includeEmbedding }) => ({
      faces,
      faceEmbeddings: includeEmbedding
        ? faces.map((face, i) => ({ detectionId: i, embedding: vector(face.box[0] < 200 ? 0 : 1) }))
        : [],
      quality: {},
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
    }),
  };
  const liveness = {
    manifest: { sha256: 'pose-model' },
    initialize: async () => {},
    observe: async (_frame, timestamp) => ({
      faces: faces
        .map((face) => {
          const i = face.box[0] < 200 ? 0 : 1;
          return {
            box: face.box,
            yaw: yaw[i],
            eyeBlinkLeft: eye[i],
            eyeBlinkRight: eye[i],
            timestamp,
          };
        })
        .reverse(),
    }),
  };
  const workflow = createFaceWorkflow({ repository: repo, engine, context });
  const flow = createMultiEnrollmentWorkflow({
    repository: repo,
    engine,
    liveness,
    workflow,
    context,
    now: () => clock,
  });
  const step = async (time) => {
    clock = time;
    if (flow.getSnapshot().needsIndependentPose)
      await flow.observePose({ width: 640, height: 480 }, time);
    await flow.process({ width: 640, height: 480 }, time);
  };
  await flow.start();
  for (const time of [0, 400, 800]) await step(time);
  return {
    repo,
    flow,
    liveness,
    step,
    yaw,
    eye,
    faces: (value) => (faces = value),
    quota: (value) => (quota = value),
    raw: () => raw,
  };
}
async function bind(h, trackId, name, guided = false) {
  await h.flow.nameDetectedFace({ trackId, name, acknowledged: true, guided });
}
describe('parallel per-face enrollment capture', () => {
  it('waits for an in-flight observation before initializing another face’s liveness', async () => {
    const h = await harness();
    let initialized = 0,
      release;
    h.liveness.initialize = async () => {
      initialized++;
    };
    await bind(h, 1, 'Alice');
    h.liveness.observe = () => new Promise((resolve) => (release = resolve));
    const observation = h.flow.observePose({ width: 640, height: 480 }, 800);
    const second = bind(h, 2, 'Bob');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(initialized).toBe(1);
    release({ faces: fixtureFaces.map((face) => ({ box: face.box, yaw: 0, timestamp: 800 })) });
    await observation;
    await second;
    expect(initialized).toBe(2);
    expect(h.flow.getSnapshot().sessions).toHaveLength(2);
  });
  it('captures two named people with isolated liveness and atomic records in the same feed', async () => {
    const h = await harness();
    await Promise.all([bind(h, 1, 'Alice'), bind(h, 2, 'Bob')]);
    expect(h.repo.getSnapshot().database.people).toHaveLength(0);
    for (const time of [1200, 1600, 2000]) await h.step(time);
    const db = h.repo.getSnapshot().database;
    expect(db.people.map((p) => p.displayName)).toEqual(['Alice', 'Bob']);
    expect(db.templates).toHaveLength(2);
    expect(db.attempts.map((a) => a.trackId)).toEqual([1, 2]);
    expect(
      db.attempts.every(
        (a) =>
          a.faceCountAtDecision === 2 &&
          a.targetFaceCountAtDecision === 1 &&
          a.decisionPolicyVersion === MULTI_ENROLLMENT_POLICY,
      ),
    ).toBe(true);
    expect(db.templates[0].embedding).toEqual(vector(0));
    expect(db.templates[1].embedding).toEqual(vector(1));
    validateDatabase(db, context);
    for (const time of [2400, 2800, 3200]) await h.step(time);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(2);
  });
  it('one person can finish head movement while the other is still on its own challenge', async () => {
    const h = await harness({ version: 1, turnLeft: true, turnRight: false, blink: false });
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    for (const time of [1000, 1200, 1400, 1600, 1800, 2000]) await h.step(time);
    h.yaw[0] = 25;
    for (const time of [2200, 2400, 2600]) await h.step(time);
    h.yaw[0] = 0;
    for (const time of [2800, 3000, 3200, 3400, 3600, 3800, 4200]) await h.step(time);
    expect(h.repo.getSnapshot().database.people.map((p) => p.displayName)).toEqual(['Alice']);
    expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 2).liveness.status).toBe(
      'checking',
    );
    expect(
      h.flow
        .getSnapshot()
        .sessions.find((s) => s.trackId === 2)
        .liveness.steps.every((s) => s.completedAt === undefined),
    ).toBe(true);
  });
  it('blinks only complete the challenge for the face that performed them', async () => {
    const h = await harness({ version: 1, turnLeft: false, turnRight: false, blink: true });
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    for (let t = 1000; t <= 2200; t += 50) await h.step(t);
    h.eye[0] = 1;
    for (const t of [2250, 2300, 2350]) await h.step(t);
    h.eye[0] = 0;
    for (const t of [2400, 2450]) await h.step(t);
    const sessions = h.flow.getSnapshot().sessions;
    expect(sessions[0].liveness.status).toBe('passed_basic');
    expect(sessions[1].liveness.status).toBe('checking');
  });
  it('saving one person retains the other person’s already passed challenge steps', async () => {
    const h = await harness({ version: 1, turnLeft: true, turnRight: false, blink: false });
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    for (const t of [1000, 1200, 1400, 1600, 1800, 2000]) await h.step(t);
    h.yaw[0] = h.yaw[1] = 25;
    for (const t of [2200, 2400, 2600]) await h.step(t);
    h.yaw[0] = 0;
    for (const t of [2800, 3000, 3200, 3400, 3600, 3800, 4200]) await h.step(t);
    const bob = h.flow.getSnapshot().sessions.find((s) => s.trackId === 2);
    expect(bob.liveness.step).toBe(1);
    expect(bob.liveness.steps[0].completedAt).toBe(2600);
    expect(h.repo.getSnapshot().database.people.map((p) => p.displayName)).toEqual(['Alice']);
    const invalid = structuredClone(h.repo.getSnapshot().database);
    invalid.attempts[0].captureFrameTimestamp = invalid.attempts[0].liveness.passedAt - 1;
    expect(() => validateDatabase(invalid, context)).toThrow('association');
  });
  it('losing one face cancels only its draft and lets the remaining face finish', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    h.faces([fixtureFaces[1]]);
    for (const time of [1200, 1600, 2000, 2400, 2800]) await h.step(time);
    expect(h.repo.getSnapshot().database.people.map((p) => p.displayName)).toEqual(['Bob']);
    expect(h.repo.getSnapshot().database.templates[0].embedding).toEqual(vector(1));
  });
  it('a failed save retains each person’s own operation for independent retry', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    const before = h.raw();
    h.quota(true);
    for (const t of [1200, 1600, 2000]) await h.step(t);
    expect(h.raw()).toBe(before);
    expect(h.flow.getSnapshot().sessions.every((s) => s.status === 'save_failed')).toBe(true);
    h.quota(false);
    await h.flow.retry(2);
    expect(h.repo.getSnapshot().database.people.map((p) => p.displayName)).toEqual(['Bob']);
    h.flow.discard();
    expect(h.flow.getSnapshot().result).toBeNull();
    expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 1).status).toBe('save_failed');
    await h.flow.retry(1);
    await h.flow.retry(1);
    expect(h.repo.getSnapshot().database.people).toHaveLength(2);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(2);
  });
  it('does not allow two in-flight faces to use the same name', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await expect(bind(h, 2, 'alice')).rejects.toThrow('already');
    expect(h.repo.getSnapshot().database.people).toHaveLength(0);
  });
  it('associates unordered poses exclusively and refuses overlapping competing pose claims', () => {
    const faces = fixtureFaces.map((face, i) => ({ ...face, trackId: i + 1 }));
    const matches = associateFacePoses(faces, [
      { box: faces[1].box, yaw: -20 },
      { box: faces[0].box, yaw: 25 },
    ]);
    expect(matches.get(1).pose.yaw).toBe(25);
    expect(matches.get(2).pose.yaw).toBe(-20);
    expect(
      associateFacePoses(
        [{ ...faces[0] }, { ...faces[0], trackId: 2 }],
        [{ box: faces[0].box, yaw: 0 }],
      ).size,
    ).toBe(0);
  });
  it('retains strict historical policy validation and rejects forged per-face bindings', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    for (const t of [1200, 1600, 2000]) await h.step(t);
    const db = structuredClone(h.repo.getSnapshot().database);
    db.attempts[0].sourceTrackId = 999;
    expect(() => validateDatabase(db, context)).toThrow('association');
    db.attempts[0].sourceTrackId = db.attempts[0].trackId;
    db.attempts[0].decisionPolicyVersion = 'enrollment-configurable-liveness-v1';
    expect(() => validateDatabase(db, context)).toThrow('evidence');
  });
});

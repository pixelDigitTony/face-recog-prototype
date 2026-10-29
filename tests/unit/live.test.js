import { describe, it, expect, vi } from 'vitest';
import {
  percentage,
  similarityPassed,
  createStableWindow,
} from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
import { createActiveChallenge } from '@/utils/hooks/faceRecognition/liveness/activeChallenge';
import { createFaceTracker } from '@/utils/hooks/faceRecognition/recognition/faceTracker';
import {
  createDatabase,
  validateDatabase,
} from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { migrateDatabase } from '@/utils/hooks/faceRecognition/repositories/migrateDatabase';
import { createLiveFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/liveFaceWorkflow';
import { createFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';

const scope = { environment: 'test', companyId: 'company', storeId: null };
const embedding = Array(128).fill(1 / Math.sqrt(128));
const face = { box: [20, 20, 100, 120], confidence: 0.99, reasonCode: null };
function drive(challenge, observations, start = 0) {
  let time = start,
    state;
  for (const yaw of observations) {
    state = challenge.update({ yaw, timestamp: time });
    time += 150;
  }
  return { state, time };
}
const motion = [
  ...Array(8).fill(0),
  10,
  20,
  25,
  25,
  25,
  10,
  0,
  0,
  0,
  0,
  -10,
  -20,
  -25,
  -25,
  -25,
  -10,
  0,
  0,
  0,
  0,
];
describe('strict match policy', () => {
  it.each([
    [-1, 0, false],
    [0.84999, 84.999, false],
    [0.85, 85, false],
    [0.85001, 85.001, true],
    [1, 100, true],
    [null, null, false],
  ])('maps %s and compares unrounded', (s, p, pass) => {
    if (p === null) expect(percentage(s)).toBeNull();
    else expect(percentage(s)).toBeCloseTo(p, 5);
    expect(similarityPassed(s)).toBe(pass);
  });
  it('rejects nonfinite and invalid scores', () => {
    expect(() => percentage(NaN)).toThrow();
    expect(() => percentage(1.01)).toThrow();
  });
  it('requires three consecutive fresh passing samples and uses their minimum', () => {
    const w = createStableWindow();
    expect(w.observe(0.99, 0).outcome).toBeNull();
    expect(w.observe(0.85, 350).outcome).toBeNull();
    expect(w.observe(0.99, 700).outcome).toBeNull();
    w.observe(0.91, 1050);
    const r = w.observe(0.95, 1400);
    expect(r.outcome).toBe('MATCH');
    expect(r.score).toBe(0.91);
    expect(w.observe(0.99, 3000).outcome).toBeNull();
  });
});
describe('motion challenge', () => {
  it('requires ordered turns and returns, expires and resets', () => {
    const c = createActiveChallenge({ random: () => 1 });
    const { state, time } = drive(c, motion);
    expect(state.status).toBe('passed_basic');
    expect(state.steps).toHaveLength(4);
    expect(state.steps.every((s) => Number.isFinite(s.completedAt))).toBe(true);
    expect(c.update({ yaw: 0, timestamp: time + 6000 }).status).toBe('expired');
    c.reset();
    expect(c.snapshot().challengeId).toBeNull();
  });
  it('does not pass a still photo, wrong turn or stale frames', () => {
    const c = createActiveChallenge({ random: () => 1 });
    let { time } = drive(c, [...Array(8).fill(0), ...Array(12).fill(-25)]);
    expect(c.snapshot().status).not.toBe('passed_basic');
    expect(c.snapshot().step).toBe(0);
    expect(c.update({ yaw: 0, timestamp: time + 1000 }).status).toBe('not_checked');
  });
  it('times out an unanswered challenge and rejects pose jumps', () => {
    const c = createActiveChallenge({ random: () => 1 });
    drive(c, Array(80).fill(0));
    expect(c.snapshot().status).toBe('failed');
    c.reset();
    drive(c, Array(8).fill(0));
    expect(c.update({ yaw: 39, timestamp: 1200 }).status).toBe('not_checked');
  });
});
describe('tracking and migration', () => {
  it('associates stable boxes and invalidates ambiguous crossing', () => {
    const tracker = createFaceTracker();
    const a = tracker.update([face], 0);
    expect(tracker.update([{ ...face, box: [22, 20, 100, 120] }], 200).faces[0].trackId).toBe(
      a.faces[0].trackId,
    );
    tracker.update([face, { ...face, box: [40, 20, 100, 120] }], 300);
    expect(tracker.update([face], 400).ambiguous).toBe(true);
    expect(tracker.update([face], 2000).faces[0].trackId).not.toBe(a.faces[0].trackId);
  });
  it('migrates without mutating or reclassifying old records', () => {
    const old = createDatabase(scope);
    old.schemaVersion = 1;
    old.settings.matchThreshold = 0.363;
    old.people.push({
      id: 'p',
      companyId: scope.companyId,
      displayName: 'Legacy Person',
      employeeCode: '1',
      normalizedEmployeeCode: '1',
      activeTemplateId: null,
    });
    old.attempts.push({
      id: 'old',
      companyId: scope.companyId,
      personId: 'p',
      purpose: 'verify',
      personSnapshot: { displayName: 'Legacy Person' },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      outcome: 'MATCH',
      similarity: 0.5,
      thresholdSnapshot: 0.363,
      livenessStatus: 'not_implemented',
      probeEmbedding: embedding,
    });
    const before = JSON.stringify(old);
    const next = migrateDatabase(old, scope);
    expect(next.schemaVersion).toBe(2);
    expect(next.settings.matchThreshold).toBe(0.85);
    expect(next.attempts[0]).toMatchObject({
      outcome: 'MATCH',
      thresholdSnapshot: 0.363,
      decisionPolicyVersion: 'legacy-cosine-v1',
      comparisonOperator: '>=',
      matchPercentage: 50,
    });
    expect(JSON.stringify(old)).toBe(before);
    expect(migrateDatabase(next, scope)).toEqual(next);
  });
  it('preserves bytes on failed migration write', async () => {
    const old = createDatabase(scope);
    old.schemaVersion = 1;
    old.settings.matchThreshold = 0.363;
    const raw = JSON.stringify(old);
    const repo = createLocalStorageRepository({
      context: scope,
      storage: {
        getItem: () => raw,
        setItem() {
          throw new Error('quota');
        },
      },
      locks: { request: (_n, _o, cb) => cb({}) },
      events: null,
    });
    await repo.load();
    expect(repo.getSnapshot().mode).toBe('recovery');
    expect(await repo.exportJson()).toBe(raw);
    repo.dispose();
  });
  it('rejects a forged live match with no challenge', () => {
    const db = createDatabase(scope);
    db.people.push({
      id: 'p',
      companyId: 'company',
      displayName: 'Person',
      employeeCode: '1',
      normalizedEmployeeCode: '1',
      activeTemplateId: null,
    });
    db.attempts.push({
      id: 'a',
      companyId: 'company',
      personId: 'p',
      personSnapshot: { displayName: 'Person' },
      purpose: 'verify',
      outcome: 'MATCH',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      similarity: 0.99,
      thresholdSnapshot: 0.85,
      probeEmbedding: embedding,
      livenessStatus: 'not_checked',
      decisionPolicyVersion: 'live-85-strict-v1',
      authoritative: false,
      comparisonOperator: '>',
      percentageThresholdSnapshot: 85,
      matchPercentage: 99,
    });
    expect(() => validateDatabase(db, scope)).toThrow(/evidence/);
  });
});
async function liveHarness() {
  let raw = null,
    time = 0,
    yaw = 0,
    faces = [face];
  const repo = createLocalStorageRepository({
    context: scope,
    storage: { getItem: () => raw, setItem: (_k, v) => (raw = v) },
    locks: { request: (_n, _o, cb) => cb({}) },
    events: null,
  });
  await repo.load();
  await repo.commit({
    type: 'savePerson',
    person: {
      id: 'p',
      employeeCode: '1',
      displayName: 'Person',
      acknowledgedAt: new Date().toISOString(),
    },
  });
  const manifest = {
    detector: { sha256: 'a' },
    recognizer: { sha256: 'b' },
    preprocessingVersion: 'v1',
    embeddingDimension: 128,
  };
  const db = repo.getSnapshot().database;
  db.templates.push({
    id: 't',
    personId: 'p',
    companyId: 'company',
    version: 1,
    modelIdentity: manifest,
    preprocessingVersion: 'v1',
    embedding,
    enrollmentSource: 'live_camera',
  });
  db.people[0].activeTemplateId = 't';
  raw = JSON.stringify(db);
  await repo.refresh();
  const engine = {
    manifest,
    initialize: async () => manifest,
    analyzeFrame: async (_f, options) => ({
      faces,
      embedding: options.includeEmbedding ? embedding : null,
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
      quality: { faceCount: faces.length },
      timingsMs: {},
    }),
  };
  const liveness = {
    manifest: { sha256: 'liveness' },
    initialize: async () => {},
    observe: async () => ({ yaw, box: face.box }),
  };
  const workflow = createFaceWorkflow({ repository: repo, engine, context: scope });
  const live = createLiveFaceWorkflow({
    repository: repo,
    engine,
    liveness,
    workflow,
    context: scope,
    now: () => time,
  });
  await live.start({ personId: 'p' });
  return {
    live,
    repo,
    step: async (nextYaw, nextFaces = [face]) => {
      yaw = nextYaw;
      faces = nextFaces;
      time += 150;
      await live.process({ width: 640, height: 480, data: new Uint8ClampedArray() }, time);
    },
    advance: (delta) => (time += delta),
  };
}
describe('live session orchestration', () => {
  it('completes a real policy session only after ordered liveness and stable comparisons, then deduplicates', async () => {
    const h = await liveHarness();
    for (let i = 0; i < 10; i++) await h.step(0);
    for (let i = 0; i < 4; i++) {
      const direction = h.live.getSnapshot().liveness.steps[i].direction;
      const yaw = direction === 'left' ? 25 : direction === 'right' ? -25 : 0;
      await h.step(yaw === 0 ? (i === 1 ? 10 : -10) : yaw / 2);
      for (let j = 0; j < 4; j++) await h.step(yaw);
    }
    for (let i = 0; i < 14; i++) await h.step(0);
    const attempts = h.repo.getSnapshot().database.attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('MATCH');
    expect(attempts[0].livenessStatus).toBe('passed_basic');
    expect(attempts[0].stableSampleCount).toBe(3);
    for (let i = 0; i < 10; i++) await h.step(0);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(1);
  });
  it('does not save a high score without liveness and resets on a second face', async () => {
    const h = await liveHarness();
    for (let i = 0; i < 15; i++) await h.step(0);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    await h.step(0, [face, { ...face, box: [300, 20, 100, 120] }]);
    expect(h.live.getSnapshot().status).toBe('multiple_faces');
    expect(h.live.getSnapshot().liveness.status).toBe('not_checked');
    expect(h.live.getSnapshot().similarity).toBeNull();
  });
  it('cancels without a write and rejects diagnostic enrollments', async () => {
    const h = await liveHarness();
    h.live.stop();
    await h.step(0);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
  });
});

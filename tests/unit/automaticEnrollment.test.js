import { describe, it, expect } from 'vitest';
import { createDatabase } from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { createFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';
import { createLiveFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/liveFaceWorkflow';

const context = { environment: 'test', companyId: 'company', storeId: null };
const manifest = {
  detector: { sha256: 'd' },
  recognizer: { sha256: 'r' },
  embeddingDimension: 128,
  preprocessingVersion: 'v1',
};
const probe = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0));
const face = { box: [10, 10, 120, 140], confidence: 0.99, reasonCode: null };
async function harness() {
  const db = createDatabase(context);
  db.settings.saveThumbnails = false;
  db.settings.enrollmentLiveness = { version: 1, turnLeft: false, turnRight: false, blink: false };
  let raw = JSON.stringify(db),
    clock = 0,
    faces = [face],
    quota = false,
    probeVector = probe,
    embeddingRequests = 0;
  const repository = createLocalStorageRepository({
    context,
    storage: {
      getItem: () => raw,
      setItem: (_k, v) => {
        if (quota) throw new Error('quota');
        raw = v;
      },
    },
    locks: { request: (_n, _o, cb) => cb({}) },
    events: null,
  });
  await repository.load();
  const engine = {
    manifest,
    initialize: async () => {},
    analyzeFrame: async (_frame, { includeEmbedding }) => {
      if (includeEmbedding) embeddingRequests++;
      return {
        faces,
        embedding: includeEmbedding && faces.length === 1 ? probeVector : null,
        faceEmbeddings: includeEmbedding
          ? faces.map((face, detectionId) => ({
              detectionId,
              embedding: face.embedding ?? probeVector,
            }))
          : [],
        modelIdentity: manifest,
        preprocessingVersion: 'v1',
        quality: {},
        timingsMs: {},
      };
    },
  };
  const liveness = { initialize: async () => {}, observe: async () => ({ yaw: 0, box: face.box }) };
  const workflow = createFaceWorkflow({ repository, engine, context });
  const flow = createLiveFaceWorkflow({
    repository,
    engine,
    liveness,
    workflow,
    context,
    now: () => clock,
  });
  const step = async (time) => {
    clock = time;
    await flow.process({ width: 640, height: 480 }, time);
  };
  return {
    repository,
    flow,
    liveness,
    step,
    raw: () => raw,
    quota: (v) => (quota = v),
    probe: (v) => (probeVector = v),
    embeddingRequests: () => embeddingRequests,
    faces: (v) => (faces = v),
    mutate: async (fn) => {
      const value = JSON.parse(raw);
      fn(value);
      raw = JSON.stringify(value);
      await repository.refresh();
    },
  };
}
async function discover(h) {
  await h.flow.start({ purpose: 'enroll', automaticEnrollment: true });
  for (const t of [0, 400, 800]) await h.step(t);
}
async function name(h, value = 'New Person') {
  await h.flow.nameDetectedFace({
    name: value,
    trackId: h.flow.getSnapshot().discovery.trackId,
    acknowledged: true,
  });
}

describe('automatic face-first enrollment', () => {
  it('confirms each face when camera detections arrive faster than multi-face comparison cadence', async () => {
    const h = await harness();
    await h.mutate((db) => {
      for (let i = 0; i < 2; i++) {
        db.people.push({
          id: `p${i}`,
          companyId: 'company',
          displayName: `P${i}`,
          employeeCode: `p${i}`,
          normalizedEmployeeCode: `p${i}`,
          enrollmentRevision: 1,
          acknowledgedAt: new Date().toISOString(),
        });
        db.templates.push({
          id: `t${i}`,
          personId: `p${i}`,
          companyId: 'company',
          version: 1,
          label: 'Reference',
          embedding: Array.from({ length: 128 }, (_, n) => (n === i ? 1 : 0)),
          modelIdentity: manifest,
          preprocessingVersion: 'v1',
          enrollmentSource: 'live_camera',
          enrollmentLiveness: 'passed_basic',
        });
      }
    });
    h.faces([
      face,
      {
        ...face,
        box: [300, 10, 120, 140],
        embedding: Array.from({ length: 128 }, (_, i) => (i === 1 ? 1 : 0)),
      },
    ]);
    await h.flow.start({ purpose: 'enroll', automaticEnrollment: true });
    for (const time of [0, 125, 250, 375, 500, 625, 750, 875, 1000]) await h.step(time);
    expect(h.flow.getSnapshot().faces.map((f) => f.identification.status)).toEqual([
      'identified',
      'identified',
    ]);
    expect(h.flow.getSnapshot().faces.map((f) => f.identification.person.personId)).toEqual([
      'p0',
      'p1',
    ]);
  });
  it('keeps a confirmed discovery without rescores and accepts the next unknown after disappearance', async () => {
    const h = await harness();
    await discover(h);
    await name(h);
    for (const t of [1000, 1400, 1800, 2200, 2600, 3000]) await h.step(t);
    expect(h.flow.getSnapshot().discovery.status).toBe('identified');
    const before = h.embeddingRequests();
    await h.step(3400);
    await h.step(3800);
    expect(h.embeddingRequests()).toBe(before);
    h.faces([]);
    await h.step(4000);
    h.faces([face]);
    h.probe(Array.from({ length: 128 }, (_, i) => (i === 1 ? 1 : 0)));
    for (const t of [4400, 4800, 5200]) await h.step(t);
    expect(h.flow.getSnapshot().discovery.status).toBe('unknown');
    await name(h, 'Next person');
    for (const t of [5400, 5800, 6200]) await h.step(t);
    expect(h.repository.getSnapshot().database.people).toHaveLength(2);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(2);
  });
  it('cannot create an unrelated draft person alongside someone else’s capture', async () => {
    const h = await harness(),
      commit = h.repository.commit;
    h.repository.commit = (op) => {
      if (op.newPerson) op.newPerson = { ...op.newPerson, id: 'unrelated' };
      return commit(op);
    };
    await discover(h);
    await name(h);
    for (const t of [1000, 1400, 1800]) await h.step(t);
    expect(h.flow.getSnapshot().status).toBe('save_failed');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it('names an unknown track and atomically auto-saves person, sample and attempt', async () => {
    const h = await harness();
    await discover(h);
    expect(h.flow.getSnapshot().discovery.status).toBe('unknown');
    await name(h);
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
    for (const t of [1000, 1400, 1800]) await h.step(t);
    expect(h.flow.getSnapshot().result.persisted).toBe(true);
    const db = h.repository.getSnapshot().database;
    expect(db.people).toHaveLength(1);
    expect(db.people[0].displayName).toBe('New Person');
    expect(db.people[0].employeeCode).toMatch(/^FACE-/);
    expect(db.templates).toHaveLength(1);
    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0].outcome).toBe('ENROLLED');
    await h.step(2200);
    await h.step(2600);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(1);
  });
  it('detects an existing enrollee without creating another record or adding automatically', async () => {
    const h = await harness();
    await discover(h);
    await name(h);
    for (const t of [1000, 1400, 1800]) await h.step(t);
    await h.flow.start({ purpose: 'enroll', automaticEnrollment: true });
    for (const t of [2200, 2600, 3000]) await h.step(t);
    expect(h.flow.getSnapshot().discovery.status).toBe('identified');
    await expect(name(h, 'Duplicate')).rejects.toThrow();
    expect(h.repository.getSnapshot().database.people).toHaveLength(1);
    const p = h.repository.getSnapshot().database.people[0];
    await h.flow.nameDetectedFace({
      personId: p.id,
      trackId: h.flow.getSnapshot().discovery.trackId,
      acknowledged: true,
    });
    for (const t of [3200, 3600, 4000]) await h.step(t);
    expect(h.repository.getSnapshot().database.people).toHaveLength(1);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(2);
  });
  it('rejects missing acknowledgment, blank/oversized names and premature claims', async () => {
    const h = await harness();
    await h.flow.start({ purpose: 'enroll', automaticEnrollment: true });
    await h.step(0);
    await expect(name(h)).rejects.toThrow();
    await h.step(400);
    await h.step(800);
    await expect(h.flow.nameDetectedFace({ name: 'A', trackId: 1 })).rejects.toThrow('Confirm');
    await expect(name(h, ' ')).rejects.toThrow('name');
    await expect(name(h, 'x'.repeat(121))).rejects.toThrow('name');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it.each(['multiple', 'lost', 'new_track'])(
    'drops draft identity on %s without saving phantom people',
    async (kind) => {
      const h = await harness();
      await discover(h);
      await name(h);
      h.faces(
        kind === 'lost'
          ? []
          : kind === 'new_track'
            ? [{ ...face, box: [400, 10, 120, 140] }]
            : [face, { ...face, box: [300, 10, 120, 140] }],
      );
      await h.step(2500);
      expect(h.flow.getSnapshot().enrollmentPerson).toBeNull();
      expect(h.repository.getSnapshot().database.people).toHaveLength(0);
      h.faces([face]);
      for (const t of [3000, 3400, 3800, 4200]) await h.step(t);
      expect(h.repository.getSnapshot().database.people).toHaveLength(0);
    },
  );
  it('rolls back quota failures and retries the exact capture once', async () => {
    const h = await harness();
    await discover(h);
    await name(h);
    const before = h.raw();
    h.quota(true);
    for (const t of [1000, 1400, 1800]) await h.step(t);
    expect(h.flow.getSnapshot().status).toBe('save_failed');
    expect(h.raw()).toBe(before);
    h.quota(false);
    await h.flow.retry();
    await h.flow.retry();
    const db = h.repository.getSnapshot().database;
    expect(db.people).toHaveLength(1);
    expect(db.templates).toHaveLength(1);
  });
  it('rejects duplicate names and treats ambiguous identities as a block to new enrollment', async () => {
    const h = await harness();
    await h.mutate((db) =>
      db.people.push({
        id: 'empty',
        displayName: 'Already Here',
        employeeCode: 'E1',
        normalizedEmployeeCode: 'e1',
        companyId: 'company',
        acknowledgedAt: new Date().toISOString(),
        enrollmentRevision: 0,
      }),
    );
    await discover(h);
    await expect(name(h, 'already here')).rejects.toThrow('already exists');
    await h.mutate((db) => {
      for (const id of ['one', 'two']) {
        db.people.push({
          id,
          displayName: id,
          employeeCode: id,
          normalizedEmployeeCode: id,
          companyId: 'company',
          acknowledgedAt: new Date().toISOString(),
          enrollmentRevision: 1,
        });
        db.templates.push({
          id,
          personId: id,
          companyId: 'company',
          version: 1,
          label: 'Face',
          embedding: probe,
          modelIdentity: manifest,
          preprocessingVersion: 'v1',
          enrollmentSource: 'live_camera',
          enrollmentLiveness: 'passed_basic',
        });
      }
    });
    for (const t of [1200, 1600, 2000]) await h.step(t);
    expect(h.flow.getSnapshot().discovery.status).toBe('ambiguous');
    await expect(name(h)).rejects.toThrow();
  });
  it('rejects a newly matching record before atomic save', async () => {
    const h = await harness();
    await discover(h);
    await name(h);
    await h.mutate((db) => {
      db.people.push({
        id: 'other',
        displayName: 'Other',
        employeeCode: 'other',
        normalizedEmployeeCode: 'other',
        companyId: 'company',
        acknowledgedAt: new Date().toISOString(),
        enrollmentRevision: 1,
      });
      db.templates.push({
        id: 'other',
        personId: 'other',
        companyId: 'company',
        version: 1,
        label: 'Face',
        embedding: probe,
        modelIdentity: manifest,
        preprocessingVersion: 'v1',
        enrollmentSource: 'live_camera',
        enrollmentLiveness: 'passed_basic',
      });
    });
    for (const t of [1000, 1400, 1800]) await h.step(t);
    expect(h.flow.getSnapshot().status).toBe('save_failed');
    expect(h.repository.getSnapshot().database.people).toHaveLength(1);
  });
  it('stop during delayed initialization cannot bind a draft to a later session', async () => {
    const h = await harness();
    await discover(h);
    let release;
    h.liveness.initialize = () => new Promise((r) => (release = r));
    const pending = name(h);
    await new Promise((r) => setTimeout(r, 0));
    h.flow.stop();
    release();
    await pending;
    expect(h.flow.getSnapshot().enrollmentPerson).toBeNull();
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { createEnrollmentDiscovery } from '@/utils/hooks/faceRecognition/recognition/enrollmentDiscovery';
import { createDatabase } from '@/utils/hooks/faceRecognition/repositories/databaseSchema';

const context = { environment: 'test', companyId: 'company', storeId: null };
const manifest = {
  detector: { sha256: 'd' },
  recognizer: { sha256: 'r' },
  embeddingDimension: 128,
  preprocessingVersion: 'v1',
};
const vector = (n) => Array.from({ length: 128 }, (_, i) => (i === n ? 1 : 0));
const first = {
  trackId: 11,
  detectionId: 0,
  box: [10, 10, 120, 140],
  confidence: 0.99,
  reasonCode: null,
};
const second = { ...first, trackId: 22, detectionId: 1, box: [220, 10, 120, 140] };
function harness() {
  let db = createDatabase(context),
    clock = 0;
  for (let n = 0; n < 2; n++) {
    db.people.push({
      id: `p${n}`,
      companyId: 'company',
      displayName: `Person ${n}`,
      employeeCode: `e${n}`,
      acknowledgedAt: new Date().toISOString(),
      enrollmentRevision: 1,
    });
    db.templates.push({
      id: `t${n}`,
      personId: `p${n}`,
      companyId: 'company',
      version: 1,
      label: `Reference ${n}`,
      embedding: vector(n),
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
      enrollmentSource: 'live_camera',
      enrollmentLiveness: 'passed_basic',
      thumbnailDataUrl: n ? 'data:image/jpeg;base64,AQ==' : null,
    });
  }
  const flow = createEnrollmentDiscovery({
    context,
    engine: { manifest },
    repository: { getSnapshot: () => ({ database: db }) },
    now: () => clock,
  });
  const step = async (
    time,
    faces = [first, second],
    embeddings = [
      { detectionId: 0, embedding: vector(0) },
      { detectionId: 1, embedding: vector(1) },
    ],
  ) => {
    clock = time;
    return flow.observe(faces, null, time, embeddings);
  };
  return {
    flow,
    step,
    mutate: (fn) => {
      db = structuredClone(db);
      fn(db);
    },
  };
}
describe('independent enrollment discovery for every face', () => {
  it('identifies two people with separate scores, evidence and exact thumbnails', async () => {
    const h = harness();
    for (const time of [0, 400, 800]) await h.step(time);
    const result = h.flow.all();
    expect(h.flow.current()).toBeNull();
    expect(result.map((r) => r.personId)).toEqual(['p0', 'p1']);
    expect(result.every((r) => r.status === 'identified')).toBe(true);
    expect(result[0].presentation.closestCandidate.thumbnailDataUrl).toBeNull();
    expect(result[1].presentation.closestCandidate.thumbnailDataUrl).toBe(
      'data:image/jpeg;base64,AQ==',
    );
    await expect(h.flow.claim({ trackId: 11, personId: 'p0' })).rejects.toThrow('single face');
  });
  it('associates embeddings by current detection ID when detection order changes', async () => {
    const h = harness();
    await h.step(0);
    await h.step(400);
    await h.step(
      800,
      [
        { ...second, detectionId: 0 },
        { ...first, detectionId: 1 },
      ],
      [
        { detectionId: 0, embedding: vector(1) },
        { detectionId: 1, embedding: vector(0) },
      ],
    );
    expect(h.flow.all().map((r) => [r.trackId, r.personId])).toEqual([
      [22, 'p1'],
      [11, 'p0'],
    ]);
  });
  it('does not give a face another face’s score or stability observations', async () => {
    const h = harness();
    for (const time of [0, 400, 800])
      await h.step(time, [first, second], [{ detectionId: 0, embedding: vector(0) }]);
    expect(h.flow.all()[0].status).toBe('identified');
    expect(h.flow.all()[1].status).toBe('waiting_for_analysis');
    expect(h.flow.all()[1].similarity).toBeNull();
    await h.step(1200, [first, second], [{ detectionId: 1, embedding: vector(2) }]);
    expect(h.flow.all()[1].status).toBe('checking');
    await h.step(1600, [first, second], [{ detectionId: 1, embedding: vector(2) }]);
    await h.step(2000, [first, second], [{ detectionId: 1, embedding: vector(2) }]);
    expect(h.flow.all()[1].status).toBe('unknown');
    expect(h.flow.all()[1].similarity).toBe(0);
    expect(h.flow.all()[0].personId).toBe('p0');
  });
  it('a low-quality face does not block another face from being identified', async () => {
    const h = harness();
    for (const time of [0, 400, 800])
      await h.step(time, [first, { ...second, reasonCode: 'BLURRED_FACE' }]);
    expect(h.flow.all().map((r) => r.status)).toEqual(['identified', 'quality_blocked']);
    expect(h.flow.all()[1].presentation.closestCandidate).toBeNull();
  });
  it('marks two simultaneous claims to one identity as conflicting', async () => {
    const h = harness();
    for (const time of [0, 400, 800])
      await h.step(
        time,
        [first, second],
        [
          { detectionId: 0, embedding: vector(0) },
          { detectionId: 1, embedding: vector(0) },
        ],
      );
    expect(h.flow.all().every((r) => r.status === 'identity_conflict' && r.personId === null)).toBe(
      true,
    );
    expect(h.flow.all().every((r) => r.presentation.closestCandidate.personId === 'p0')).toBe(true);
  });
  it('keeps an already confirmed owner when a new face selects the same identity', async () => {
    const h = harness();
    for (const time of [0, 400, 800])
      await h.step(time, [first], [{ detectionId: 0, embedding: vector(0) }]);
    await h.step(1200, [first, second], [{ detectionId: 1, embedding: vector(0) }]);
    expect(h.flow.all().map((r) => r.status)).toEqual(['identified', 'identity_conflict']);
  });
  it('expires only stale unconfirmed results and clears disappeared references', async () => {
    const h = harness();
    await h.step(0);
    await h.step(400);
    await h.step(2000, [first, second], []);
    expect(h.flow.all().every((r) => r.similarity === null)).toBe(true);
    for (const time of [2400, 2800, 3200]) await h.step(time);
    await h.step(3600, [second], []);
    expect(h.flow.all()).toHaveLength(1);
    expect(h.flow.current().trackId).toBe(22);
    h.mutate((db) => (db.templates = []));
    await h.step(4000, [second], []);
    expect(h.flow.current().presentation.closestCandidate).toBeNull();
  });
  it('never reuses a single embedding for several detected faces', async () => {
    const h = harness();
    await h.flow.observe([first, second], vector(0), 0);
    expect(h.flow.all().every((r) => r.similarity === null && r.personId === null)).toBe(true);
  });
});

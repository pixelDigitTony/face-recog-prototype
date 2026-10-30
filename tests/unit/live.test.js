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
  it('requires ordered turns and retains completion until explicitly reset', () => {
    const c = createActiveChallenge({ random: () => 1 });
    const { state, time } = drive(c, motion);
    expect(state.status).toBe('passed_basic');
    expect(state.steps).toHaveLength(4);
    expect(state.steps.every((s) => Number.isFinite(s.completedAt))).toBe(true);
    for (let t = time; t < time + 10000; t += 150) c.update({ yaw: 0, timestamp: t });
    expect(c.snapshot().status).toBe('passed_basic');
    expect(c.snapshot().expiresAt).toBeNull();
    c.reset();
    expect(c.snapshot().challengeId).toBeNull();
  });
  it('does not pass a still photo, wrong turn or stale frames', () => {
    const c = createActiveChallenge({ random: () => 1 });
    let { time } = drive(c, [...Array(8).fill(0), ...Array(12).fill(-25)]);
    expect(c.snapshot().status).not.toBe('passed_basic');
    expect(c.snapshot().step).toBe(0);
    expect(c.update({ yaw: 0, timestamp: time + 2000 })).toMatchObject({
      status: 'checking',
      step: 0,
      paused: true,
      lastValidatedAt: null,
    });
  });
  it('waits on the current instruction without failing on time or abrupt movement', () => {
    const c = createActiveChallenge({ random: () => 1 });
    drive(c, Array(80).fill(0));
    expect(c.snapshot()).toMatchObject({ status: 'checking', step: 0 });
    c.reset();
    drive(c, Array(8).fill(0));
    expect(c.update({ yaw: 39, timestamp: 1200 })).toMatchObject({ status: 'checking', step: 0 });
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
      enrollmentRevision: 1,
      primaryTemplateId: null,
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
    expect(next.schemaVersion).toBe(4);
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
      enrollmentRevision: 1,
      primaryTemplateId: null,
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
async function liveHarness({ recognitionMs = 0, poseMs = 0, purpose = 'verify' } = {}) {
  let raw = null,
    time = 0,
    yaw = 0,
    faces = [face],
    currentEmbedding = embedding;
  let live;
  function work(duration) {
    const end = time + duration;
    while (time < end) {
      time = Math.min(end, time + 100);
      live?.stale();
    }
  }
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
    label: 'Original sample',
    version: 1,
    modelIdentity: manifest,
    preprocessingVersion: 'v1',
    embedding,
    enrollmentSource: 'live_camera',
  });
  db.people[0].primaryTemplateId = 't';
  db.people[0].enrollmentRevision = 1;
  raw = JSON.stringify(db);
  await repo.refresh();
  const engine = {
    manifest,
    initialize: async () => manifest,
    analyzeFrame: vi.fn(async (_f, options) => {
      work(recognitionMs);
      return {
        faces,
        embedding: options.includeEmbedding ? currentEmbedding : null,
        modelIdentity: manifest,
        preprocessingVersion: 'v1',
        quality: { faceCount: faces.length },
        timingsMs: {},
      };
    }),
  };
  const liveness = {
    manifest: { sha256: 'liveness' },
    initialize: async () => {},
    observe: vi.fn(async () => {
      work(poseMs);
      return { yaw, box: face.box };
    }),
  };
  const workflow = createFaceWorkflow({ repository: repo, engine, context: scope });
  live = createLiveFaceWorkflow({
    repository: repo,
    engine,
    liveness,
    workflow,
    context: scope,
    now: () => time,
  });
  await live.start({ personId: 'p', purpose });
  return {
    live,
    repo,
    engine,
    liveness,
    step: async (nextYaw, nextFaces = [face]) => {
      yaw = nextYaw;
      faces = nextFaces;
      time += 150;
      await live.process({ width: 640, height: 480, data: new Uint8ClampedArray() }, time);
    },
    advance: (delta) => (time += delta),
    setEmbedding: (value) => (currentEmbedding = value),
  };
}
async function completeMotion(h, neutral = 0) {
  for (let i = 0; i < 10 && !h.live.getSnapshot().liveness.challengeId; i++) await h.step(neutral);
  let previousYaw = neutral;
  for (let i = 0; i < 4; i++) {
    const direction = h.live.getSnapshot().liveness.steps[i].direction;
    const yaw = neutral + (direction === 'left' ? 25 : direction === 'right' ? -25 : 0);
    await h.step((previousYaw + yaw) / 2);
    for (let j = 0; j < 6 && h.live.getSnapshot().liveness.step === i; j++) await h.step(yaw);
    expect(h.live.getSnapshot().liveness.step).toBe(i + 1);
    previousYaw = yaw;
  }
}
async function readyEnrollment() {
  const h = await liveHarness({ purpose: 'enroll' });
  await completeMotion(h);
  for (let i = 0; i < 4 && h.live.getSnapshot().status !== 'ready_to_enroll'; i++) await h.step(0);
  expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
  return h;
}

describe('live session orchestration', () => {
  it('retains completed enrollment readiness with advisory lighting warnings', async () => {
    const h = await readyEnrollment();
    const warningFace = {
      ...face,
      quality: { lighting: { warnings: ['LOW_LIGHT', 'UNEVEN_LIGHTING'] } },
    };
    for (let i = 0; i < 8; i++) await h.step(0, [warningFace]);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    expect(h.live.getSnapshot().liveness.status).toBe('passed_basic');
    await h.live.enroll();
    await h.step(0, [warningFace]);
    expect(h.repo.getSnapshot().database.attempts.at(-1)?.outcome).toBe('ENROLLED');
    h.repo.dispose();
  });
  it('uses the challenge neutral pose consistently for the completed capture', async () => {
    const h = await liveHarness({ purpose: 'enroll' });
    await completeMotion(h, 8);
    for (let i = 0; i < 4; i++) await h.step(16);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    await h.live.enroll();
    await h.step(16);
    expect(h.repo.getSnapshot().database.attempts.at(-1)?.outcome).toBe('ENROLLED');
  });
  it('stops continuous pose/identity verification once enrollment is ready', async () => {
    const h = await readyEnrollment();
    const poseCalls = h.liveness.observe.mock.calls.length;
    h.setEmbedding(embedding.map((v) => -v));
    for (let i = 0; i < 12; i++)
      await h.step(15, [{ ...face, reasonCode: i % 2 ? 'BLURRED_FACE' : null }]);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    expect(h.liveness.observe).toHaveBeenCalledTimes(poseCalls);
    expect(
      h.engine.analyzeFrame.mock.calls
        .slice(-12)
        .every(([, options]) => options.includeEmbedding === false),
    ).toBe(true);
  });
  it('matches the saved template without an unrelated before/after challenge similarity gate', async () => {
    const h = await liveHarness();
    const side = embedding.map((v, i) => (i < 64 ? v : -v));
    h.setEmbedding(embedding.map((v, i) => 0.9 * v + Math.sqrt(0.19) * side[i]));
    await completeMotion(h);
    h.setEmbedding(embedding.map((v, i) => 0.9 * v - Math.sqrt(0.19) * side[i]));
    for (let i = 0; i < 12; i++) await h.step(0);
    expect(h.repo.getSnapshot().database.attempts.at(-1)?.outcome).toBe('MATCH');
    expect(h.repo.getSnapshot().database.attempts.at(-1)?.similarity).toBeCloseTo(0.9, 5);
  });
  it('reports a real below-threshold result instead of staying blocked indefinitely', async () => {
    const h = await liveHarness();
    await completeMotion(h);
    const side = embedding.map((v, i) => (i < 64 ? v : -v));
    h.setEmbedding(embedding.map((v, i) => 0.8 * v + 0.6 * side[i]));
    for (let i = 0; i < 12; i++) await h.step(0);
    expect(h.repo.getSnapshot().database.attempts.at(-1)?.outcome).toBe('NO_MATCH');
    expect(h.repo.getSnapshot().database.attempts.at(-1)?.similarity).toBeCloseTo(0.8, 5);
  });
  it('waits for the first instruction without timing out while the same face remains visible', async () => {
    const h = await liveHarness({ purpose: 'enroll' });
    for (let i = 0; i < 400; i++) await h.step(15);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    expect(h.live.getSnapshot().status).toBe('challenging');
    for (let i = 0; i < 10; i++) await h.step(0);
    expect(h.live.getSnapshot().liveness.challengeId).toBeTruthy();
  });
  it('retains a completed enrollment challenge beyond both old reset deadlines', async () => {
    const h = await readyEnrollment();
    const passed = structuredClone(h.live.getSnapshot().liveness);
    for (let i = 0; i < 800; i++) await h.step(0);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    expect(h.live.getSnapshot().liveness.challengeId).toBe(passed.challengeId);
    expect(h.live.getSnapshot().liveness.steps).toEqual(passed.steps);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    await h.live.enroll();
    for (let i = 0; i < 5; i++) await h.step(0);
    expect(h.repo.getSnapshot().database.attempts.at(-1)).toMatchObject({
      outcome: 'ENROLLED',
      livenessStatus: 'passed_basic',
      liveness: { validity: 'continuous_session', expiresAt: null },
    });
  });
  it('retains passed steps when the same face follows the wrong instruction or takes longer', async () => {
    const h = await liveHarness({ purpose: 'enroll' });
    for (let i = 0; i < 10 && !h.live.getSnapshot().liveness.challengeId; i++) await h.step(0);
    const initial = h.live.getSnapshot().liveness;
    const firstYaw = initial.steps[0].direction === 'left' ? 25 : -25;
    await h.step(firstYaw / 2);
    for (let i = 0; i < 6 && h.live.getSnapshot().liveness.step === 0; i++) await h.step(firstYaw);
    expect(h.live.getSnapshot().liveness.step).toBe(1);
    const completed = structuredClone(h.live.getSnapshot().liveness.steps[0]);
    for (let i = 0; i < 400; i++) await h.step(firstYaw);
    expect(h.live.getSnapshot().liveness.step).toBe(1);
    expect(h.live.getSnapshot().liveness.steps[0]).toEqual(completed);
    expect(h.live.getSnapshot().liveness.challengeId).toBe(initial.challengeId);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    await h.step(firstYaw / 2);
    for (let i = 0; i < 4; i++) await h.step(0);
    expect(h.live.getSnapshot().liveness.step).toBe(2);
  });
  it('keeps enrollment ready across detection-only frames after a completed challenge', async () => {
    const h = await liveHarness({ purpose: 'enroll' });
    await completeMotion(h);
    for (let i = 0; i < 4 && h.live.getSnapshot().status !== 'ready_to_enroll'; i++)
      await h.step(0);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    const states = [];
    const unsubscribe = h.live.subscribe(() => states.push(h.live.getSnapshot().status));
    for (let i = 0; i < 5; i++) await h.step(0);
    unsubscribe();
    expect(new Set(states)).toEqual(new Set(['ready_to_enroll']));
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
  });
  it('latches the enrollment click until a fresh capture saves once', async () => {
    const h = await readyEnrollment();
    await h.live.enroll();
    expect(h.live.getSnapshot().status).toBe('capturing_enrollment');
    await expect(h.live.enroll()).rejects.toThrow();
    const states = [];
    const unsubscribe = h.live.subscribe(() => states.push(h.live.getSnapshot().status));
    for (let i = 0; i < 5; i++) await h.step(0);
    unsubscribe();
    expect(states).not.toContain('ready_to_enroll');
    expect(states).not.toContain('comparing');
    const attempts = h.repo.getSnapshot().database.attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('ENROLLED');
    expect(h.live.getSnapshot().status).toBe('completed');
  });
  it('revokes a queued enrollment if another face enters before capture', async () => {
    const h = await readyEnrollment();
    await h.live.enroll();
    await h.step(0, [face, { ...face, box: [300, 20, 100, 120] }]);
    expect(h.live.getSnapshot().status).toBe('multiple_faces');
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    await expect(h.live.enroll()).rejects.toThrow();
  });
  it('checks pose only on capture while actual lost tracking disables enrollment', async () => {
    const turned = await readyEnrollment();
    const completed = structuredClone(turned.live.getSnapshot().liveness);
    await turned.step(15);
    expect(turned.live.getSnapshot().status).toBe('ready_to_enroll');
    await turned.live.enroll();
    await turned.step(15);
    expect(turned.live.getSnapshot().status).toBe('ready_to_enroll');
    expect(turned.live.getSnapshot().error).toMatch(/Look straight ahead/);
    expect(turned.repo.getSnapshot().database.attempts).toHaveLength(0);
    for (let i = 0; i < 60; i++) await turned.step(15);
    expect(turned.live.getSnapshot().liveness.challengeId).toBe(completed.challengeId);
    expect(turned.live.getSnapshot().liveness.steps).toEqual(completed.steps);
    for (let i = 0; i < 4; i++) await turned.step(0);
    expect(turned.live.getSnapshot().status).toBe('ready_to_enroll');
    const expired = await readyEnrollment();
    expired.advance(5100);
    await expired.step(0);
    expect(expired.live.getSnapshot().status).not.toBe('ready_to_enroll');
    await expect(expired.live.enroll()).rejects.toThrow();
    expect(expired.repo.getSnapshot().database.attempts.some((a) => a.outcome === 'ENROLLED')).toBe(
      false,
    );
  });
  it('preserves steps through temporary quality failures and a brief missed detection for the same track', async () => {
    const h = await readyEnrollment();
    const completed = structuredClone(h.live.getSnapshot().liveness);
    await h.step(0, [{ ...face, reasonCode: 'BLURRED_FACE' }]);
    expect(h.live.getSnapshot().liveness.steps).toEqual(completed.steps);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    await h.live.enroll();
    await h.step(0, [{ ...face, reasonCode: 'BLURRED_FACE' }]);
    expect(h.live.getSnapshot().error).toMatch(/Capture quality/);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    await h.step(0, []);
    expect(h.live.getSnapshot().liveness.steps).toEqual(completed.steps);
    for (let i = 0; i < 4; i++) await h.step(0);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    expect(h.live.getSnapshot().liveness.challengeId).toBe(completed.challengeId);
  });
  it('validates capture identity on click and retains readiness after a failed capture', async () => {
    const h = await readyEnrollment(),
      passed = structuredClone(h.live.getSnapshot().liveness);
    h.setEmbedding(embedding.map((v) => -v));
    for (let i = 0; i < 3; i++) await h.step(0);
    expect(h.live.getSnapshot().liveness.steps).toEqual(passed.steps);
    expect(h.live.getSnapshot().liveness.challengeId).toBe(passed.challengeId);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    await h.live.enroll();
    await h.step(0);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    expect(h.live.getSnapshot().error).toMatch(/capture differs/);
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    h.setEmbedding(embedding);
    for (let i = 0; i < 4; i++) await h.step(0);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    expect(h.live.getSnapshot().liveness.challengeId).toBe(passed.challengeId);
    await h.live.enroll();
    await h.step(0);
    expect(h.repo.getSnapshot().database.attempts.at(-1)?.outcome).toBe('ENROLLED');
  });
  it('validates fresh session binding for retained completion and preserves old timed records', async () => {
    const h = await readyEnrollment();
    await h.live.enroll();
    for (let i = 0; i < 4; i++) await h.step(0);
    const original = h.repo.getSnapshot().database;
    expect(original.attempts.at(-1).outcome).toBe('ENROLLED');
    for (const corrupt of [
      (a) => (a.liveness.lastValidatedAt = a.decisionTimestamp - 1600),
      (a) => (a.liveness.sessionId = 'another-session'),
      (a) => (a.liveness.trackId = 999),
    ]) {
      const db = structuredClone(original);
      corrupt(db.attempts.at(-1));
      expect(() => validateDatabase(db, scope)).toThrow(/liveness evidence/i);
    }
    const legacy = structuredClone(original),
      attempt = legacy.attempts.at(-1);
    attempt.liveness.policyVersion = 'head-turn-v1';
    attempt.liveness.expiresAt = attempt.liveness.passedAt + 5000;
    attempt.decisionTimestamp = attempt.liveness.passedAt + 100;
    expect(() => validateDatabase(legacy, scope)).not.toThrow();
    attempt.decisionTimestamp = attempt.liveness.expiresAt + 1;
    expect(() => validateDatabase(legacy, scope)).toThrow(/expired/);
  });
  it.each([
    { recognitionMs: 411, poseMs: 25 },
    { recognitionMs: 411, poseMs: 150 },
    { recognitionMs: 700, poseMs: 300 },
  ])('progresses liveness on a slower CPU with %o and watchdog ticks', async (timing) => {
    const h = await liveHarness(timing);
    for (let i = 0; i < 8; i++) await h.step(0);
    expect(h.live.getSnapshot().liveness.status).toBe('checking');
    expect(h.live.getSnapshot().status).toBe('challenging');
    expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
  });
  it.each([
    { recognitionMs: 0, poseMs: 0 },
    { recognitionMs: 411, poseMs: 150 },
    { recognitionMs: 700, poseMs: 300 },
  ])(
    'completes ordered liveness and stable comparisons at %o, then deduplicates',
    async (timing) => {
      const h = await liveHarness(timing);
      for (let i = 0; i < 10 && !h.live.getSnapshot().liveness.challengeId; i++) await h.step(0);
      let previousYaw = 0;
      for (let i = 0; i < 4; i++) {
        const direction = h.live.getSnapshot().liveness.steps[i].direction;
        const yaw = direction === 'left' ? 25 : direction === 'right' ? -25 : 0;
        await h.step((previousYaw + yaw) / 2);
        for (let j = 0; j < 6 && h.live.getSnapshot().liveness.step === i; j++) await h.step(yaw);
        expect(h.live.getSnapshot().liveness.step).toBe(i + 1);
        previousYaw = yaw;
      }
      for (let i = 0; i < 14; i++) await h.step(0);
      const attempts = h.repo.getSnapshot().database.attempts;
      expect(attempts).toHaveLength(1);
      expect(attempts[0].outcome).toBe('MATCH');
      expect(attempts[0].livenessStatus).toBe('passed_basic');
      expect(attempts[0].stableSampleCount).toBe(3);
      for (let i = 0; i < 10; i++) await h.step(0);
      expect(h.repo.getSnapshot().database.attempts).toHaveLength(1);
    },
  );
  it.each([{ recognitionMs: 1600 }, { recognitionMs: 411, poseMs: 1200 }])(
    'rejects a frame older than the bounded processing budget at %o',
    async (timing) => {
      const h = await liveHarness(timing);
      await h.step(0);
      expect(h.live.getSnapshot().status).toBe('analysis_delayed');
      expect(h.live.getSnapshot().faces).toHaveLength(0);
      expect(h.live.getSnapshot().liveness.status).toBe('not_checked');
      expect(h.repo.getSnapshot().database.attempts).toHaveLength(0);
    },
  );
  it('clears evidence when the analysis loop genuinely stops delivering results', async () => {
    const h = await liveHarness({ recognitionMs: 411, poseMs: 150 });
    for (let i = 0; i < 6; i++) await h.step(0);
    expect(h.live.getSnapshot().liveness.challengeId).toBeTruthy();
    h.advance(1600);
    h.live.stale();
    expect(h.live.getSnapshot().status).toBe('analysis_delayed');
    expect(h.live.getSnapshot().liveness.challengeId).toBeNull();
    expect(h.live.getSnapshot().similarity).toBeNull();
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

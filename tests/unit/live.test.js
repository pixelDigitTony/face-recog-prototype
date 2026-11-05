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
import { harness, bind, perform, fixtureFaces, vector } from './enrollmentFixtures';

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
    expect(next.schemaVersion).toBe(5);
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
// Migration mapping: the retired manual-ready tests now exercise automatic capture,
// quality/pose and consistency holds, continuous-session retention, loss, and history.
// Multi-face isolation and independent failed-save retry are additionally covered in
// multiEnrollmentCapture.test.js; sealed-review retention is in guidedMeterEnrollment.test.js.
async function gatedEnrollment() {
  const h = await harness();
  await bind(h, 1, 'Alice');
  await h.wait(1450);
  h.yaw[0] = 8;
  await h.wait(500);
  h.yaw[0] = 0;
  await h.wait(500);
  h.eye[0] = 1;
  await h.wait(150);
  // Finish the blink while outside the capture pose so both checks can latch
  // without allowing the automatic capture hold to complete.
  h.eye[0] = 0;
  await h.wait(200);
  h.yaw[0] = 15;
  await h.wait(600);
  expect(h.flow.getSnapshot().sessions[0].liveness.status).toBe('passed_basic');
  expect(h.flow.getSnapshot().sessions[0].meter.status).toBe('passed_basic');
  expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
  return h;
}

describe('current per-face enrollment orchestration', () => {
  it('rejects legacy enrollment with a clear per-face workflow direction', async () => {
    await expect(liveHarness({ purpose: 'enroll' })).rejects.toThrow(
      /per-face enrollment workflow.*motion evidence/i,
    );
  });
  it('waits indefinitely for motion and preserves passed challenge steps while the meter remains incomplete', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await h.wait(12000);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
    expect(h.flow.getSnapshot().sessions[0].liveness.status).toBe('checking');
    h.eye[0] = 1;
    await h.wait(150);
    h.eye[0] = 0;
    await h.wait(400);
    const passed = structuredClone(h.flow.getSnapshot().sessions[0].liveness);
    expect(passed.status).toBe('passed_basic');
    await h.wait(12000);
    const current = h.flow.getSnapshot().sessions[0];
    expect(current.liveness.steps).toEqual(passed.steps);
    expect(current.liveness.challengeId).toBe(passed.challengeId);
    expect(current.meter.status).not.toBe('passed_basic');
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
  });
  it('latches both checks during quiet and out-of-pose frames, then captures once with advisory lighting', async () => {
    const h = await gatedEnrollment();
    const session = h.flow.getSnapshot().sessions[0];
    const proof = structuredClone(session.meter.accepted);
    const steps = structuredClone(session.liveness.steps);
    const warning = {
      ...fixtureFaces[0],
      quality: { lighting: { warnings: ['LOW_LIGHT', 'UNEVEN_LIGHTING'] } },
    };
    h.faces([warning, fixtureFaces[1]]);
    await h.wait(12000);
    expect(h.flow.getSnapshot().sessions[0].meter.accepted).toEqual(proof);
    expect(h.flow.getSnapshot().sessions[0].liveness.steps).toEqual(steps);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
    h.yaw[0] = 0;
    await h.wait(1500);
    const attempts = h.repository.getSnapshot().database.attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      outcome: 'ENROLLED',
      livenessStatus: 'passed_basic',
      livenessMeter: { status: 'passed_basic' },
    });
    await h.wait(2500);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(1);
  });
  it('captures relative to a nonzero challenge neutral pose', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    h.yaw[0] = 7;
    await h.wait(1450);
    h.yaw[0] = 15;
    await h.wait(500);
    h.yaw[0] = 7;
    await h.wait(500);
    h.eye[0] = 1;
    await h.wait(150);
    h.eye[0] = 0;
    await h.wait(1500);
    const attempts = h.repository.getSnapshot().database.attempts;
    expect(attempts).toHaveLength(1);
    const attempt = attempts[0];
    expect(attempt.outcome).toBe('ENROLLED');
    expect(attempt.neutralYaw).toBeCloseTo(7);
    expect(attempt.captureYaw).toBeCloseTo(7);
    expect(Math.abs(attempt.captureYaw - attempt.neutralYaw)).toBeLessThanOrEqual(10);
    expect(attempt.liveness.status).toBe('passed_basic');
    expect(attempt.livenessMeter.status).toBe('passed_basic');
    expect(attempt.livenessMeter.events.map((event) => event.family)).toEqual(
      expect.arrayContaining(['blink', 'head']),
    );
  });
  it('keeps enrollment checks ready when transient activity goes idle', async () => {
    const h = await gatedEnrollment();
    const before = structuredClone(h.flow.getSnapshot().sessions[0]);
    expect(before.meter.activity.score).toBeGreaterThan(0);
    await h.wait(16000);
    const after = h.flow.getSnapshot().sessions[0];
    expect(after.meter.activity).toMatchObject({ score: 0, idle: true });
    expect(after.meter.status).toBe('passed_basic');
    expect(after.meter.accepted).toEqual(before.meter.accepted);
    expect(after.liveness.status).toBe('passed_basic');
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
    h.yaw[0] = 0;
    await h.wait(1500);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(1);
  });
  it('blocks poor capture quality, retains same-face proof, and captures after quality recovers', async () => {
    const h = await gatedEnrollment();
    const before = structuredClone(h.flow.getSnapshot().sessions[0]);
    h.yaw[0] = 0;
    h.faces([{ ...fixtureFaces[0], reasonCode: 'BLURRED_FACE' }, fixtureFaces[1]]);
    await h.wait(1200);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
    expect(h.flow.getSnapshot().sessions[0].liveness.steps).toEqual(before.liveness.steps);
    expect(h.flow.getSnapshot().sessions[0].meter.accepted).toEqual(before.meter.accepted);
    h.faces(fixtureFaces);
    await h.wait(1500);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(1);
  });
  it('rejects an inconsistent capture embedding and retains both passed checks for retry', async () => {
    const h = await gatedEnrollment();
    const before = structuredClone(h.flow.getSnapshot().sessions[0]);
    h.yaw[0] = 0;
    await h.wait(700);
    h.setEmbedding(0, vector(1));
    await h.wait(400);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
    const blocked = h.flow.getSnapshot().sessions[0];
    expect(blocked.error).toMatch(/consistent capture/i);
    expect(blocked.liveness.steps).toEqual(before.liveness.steps);
    expect(blocked.meter.accepted).toEqual(before.meter.accepted);
    h.setEmbedding(0, vector(0));
    await h.wait(1200);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(1);
  });
  it('does not transfer accepted meter evidence through a missed detection or stale stream', async () => {
    const h = await gatedEnrollment();
    const challenge = structuredClone(h.flow.getSnapshot().sessions[0].liveness);
    h.faces([fixtureFaces[1]]);
    await h.step();
    h.faces(fixtureFaces);
    await h.step();
    const returned = h.flow.getSnapshot().sessions[0];
    expect(returned.meter.accepted).toBeNull();
    expect(returned.liveness.steps).toEqual(challenge.steps);
    h.advance(5100);
    h.flow.stale();
    expect(h.flow.getSnapshot().sessions[0].status).toBe('cancelled');
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
  });
  it('keeps a named face independent when a second face is present', async () => {
    const h = await gatedEnrollment();
    expect(h.flow.getSnapshot().faces).toHaveLength(2);
    h.yaw[0] = 0;
    await h.wait(1500);
    const attempts = h.repository.getSnapshot().database.attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      trackId: 1,
      faceCountAtDecision: 2,
      targetFaceCountAtDecision: 1,
    });
  });
  it('validates capture continuity and session bindings on the real stored record', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await perform(h, [1]);
    const db = h.repository.getSnapshot().database;
    expect(db.attempts).toHaveLength(1);
    expect(() => validateDatabase(db, scope)).not.toThrow();
    for (const corrupt of [
      (a) => (a.liveness.sessionId = 'another-session'),
      (a) => (a.liveness.trackId = 999),
      (a) => (a.livenessMeter.capture.poseTimestamp = a.decisionTimestamp - 1600),
    ]) {
      const forged = structuredClone(db);
      corrupt(forged.attempts[0]);
      expect(() => validateDatabase(forged, scope)).toThrow();
    }
  });
  it('preserves historical timed challenge validation', async () => {
    const h = await liveHarness();
    await completeMotion(h);
    for (let i = 0; i < 12; i++) await h.step(0);
    const db = structuredClone(h.repo.getSnapshot().database);
    const attempt = db.attempts.at(-1);
    expect(attempt.outcome).toBe('MATCH');
    attempt.liveness.policyVersion = 'head-turn-v1';
    attempt.liveness.expiresAt = attempt.liveness.passedAt + 5000;
    attempt.decisionTimestamp = attempt.liveness.passedAt + 100;
    expect(() => validateDatabase(db, scope)).not.toThrow();
    attempt.decisionTimestamp = attempt.liveness.expiresAt + 1;
    expect(() => validateDatabase(db, scope)).toThrow(/expired/);
  });
});

describe('live session orchestration', () => {
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

import { describe, it, expect } from 'vitest';
import {
  createDatabase,
  validateDatabase,
} from '../../src/utils/hooks/faceRecognition/repositories/databaseSchema';
import { createLocalStorageRepository } from '../../src/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { createPhysicalEvaluationWorkflow } from '../../src/utils/hooks/faceRecognition/workflows/physicalEvaluationWorkflow';
import {
  summarizePhysicalTrials,
  validatePhysicalTrial,
} from '../../src/utils/hooks/faceRecognition/repositories/physicalTrial';

const context = { environment: 'test', companyId: 'company', storeId: null };
const options = {
  label: 'Trial',
  deviceLabel: 'Camera',
  lighting: 'even',
  appearance: 'glasses',
  expectedGroupSize: 1,
  durationSeconds: 15,
  authorized: true,
};
const hash = 'a'.repeat(64);
async function harness(extraSettings = {}) {
  let time = 0,
    yaw = 0,
    eye = 0,
    faces = [{ box: [10, 10, 100, 100], confidence: 0.99, reasonCode: null }],
    quota = false;
  const initial = createDatabase(context);
  initial.settings.enrollmentLiveness = {
    version: 1,
    turnLeft: false,
    turnRight: false,
    blink: true,
    ...extraSettings,
  };
  let raw = JSON.stringify(initial);
  const repo = createLocalStorageRepository({
    context,
    storage: {
      getItem: () => raw,
      setItem: (_key, v) => {
        if (quota) throw Error('quota');
        raw = v;
      },
    },
    locks: { request: (_n, _o, cb) => cb({}) },
    events: null,
  });
  const engine = {
    manifest: {
      detector: { sha256: hash },
      recognizer: { sha256: hash },
      preprocessingVersion: 'v1',
      embeddingDimension: 128,
    },
    initialize: async () => {},
    detectFrame: async () => ({ faces }),
    releaseFrame: async () => {},
  };
  const liveness = {
    manifest: { sha256: hash },
    generation: 1,
    initialize: async () => {},
    observe: async () => ({
      faces: faces.map((f) => ({
        box: f.box,
        yaw,
        pitch: 0,
        eyeBlinkLeft: eye,
        eyeBlinkRight: eye,
        jawOpen: 0.05,
        mouthSmileLeft: 0.05,
        mouthSmileRight: 0.05,
        jawMotion: 0.1,
        smileMotion: 0.8,
      })),
    }),
  };
  const flow = createPhysicalEvaluationWorkflow({
    context,
    repository: repo,
    engine,
    liveness,
    now: () => time,
  });
  const frame = { width: 640, height: 480 };
  return {
    flow,
    repo,
    engine,
    liveness,
    raw: () => raw,
    quota: (v) => (quota = v),
    faces: (v) => (faces = v),
    time: (v) => (time = v),
    yaw: (v) => (yaw = v),
    eye: (v) => (eye = v),
    async step(ms = 50) {
      time += ms;
      await flow.process(frame, time);
      await flow.observePose(frame, time);
      flow.tick(time);
    },
    async start() {
      await flow.start(options);
      flow.begin({ width: 640, height: 480 });
    },
    async run(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 50) await this.step();
    },
  };
}
describe('physical evaluation', () => {
  it('starts its clock at camera readiness and completes an empty healthy scene without fabricated results', async () => {
    const h = await harness();
    await h.flow.start(options);
    h.time(12000);
    h.faces([]);
    h.flow.begin({ width: 640, height: 480 });
    await h.run(15000);
    expect(h.flow.getSnapshot()).toMatchObject({
      status: 'review',
      elapsedMs: 15000,
      segments: [],
    });
    expect(h.flow.getSnapshot().trial.startTimestamp).toBe(12000);
  });
  it('saves one measured timed segment and retries the exact sealed record after quota failure', async () => {
    const h = await harness();
    await h.start();
    await h.run(15000);
    const state = h.flow.getSnapshot();
    expect(state.status).toBe('review');
    const s = state.segments[0];
    expect(s.observationCount).toBeGreaterThan(10);
    expect(s.endReason).toBe('timed');
    const before = h.raw();
    h.quota(true);
    await h.flow.save({ [s.segmentId]: { label: 'A', truth: 'genuine' } });
    expect(h.flow.getSnapshot().status).toBe('save_failed');
    const sealed = structuredClone(h.flow.getSnapshot().pending.trial);
    expect(h.raw()).toBe(before);
    h.quota(false);
    await h.flow.retry();
    expect(h.repo.getSnapshot().database.physicalTrials).toEqual([sealed]);
    await h.repo.commit({ type: 'savePhysicalTrial', trial: sealed });
    expect(h.repo.getSnapshot().database.physicalTrials).toHaveLength(1);
    expect(summarizePhysicalTrials([sealed]).genuine).toMatchObject({
      denominator: 1,
      combinedPassed: 0,
    });
    await h.repo.commit({ type: 'deletePhysicalTrial', id: sealed.id });
    expect(h.repo.getSnapshot().database.physicalTrials).toHaveLength(0);
    expect(h.repo.getSnapshot().database.people).toHaveLength(0);
    expect(h.repo.getSnapshot().database.identificationEvents).toHaveLength(0);
  });
  it('saves genuinely earned meter and challenge proof with shared segment binding', async () => {
    const h = await harness();
    await h.start();
    await h.run(1450);
    h.yaw(8);
    await h.run(500);
    h.yaw(0);
    await h.run(500);
    h.eye(0.9);
    await h.run(150);
    h.eye(0);
    await h.run(12400);
    const review = h.flow.getSnapshot();
    expect(review.status).toBe('review');
    const segment = review.segments[0];
    expect(segment.meterProof?.status).toBe('passed_basic');
    expect(segment.challenge).not.toBeNull();
    expect(segment.combinedPassedAt).toBe(
      Math.max(segment.meterPassedAt, segment.challengePassedAt),
    );
    expect(segment.meterProof).toMatchObject({
      cameraSessionId: review.trial.cameraSessionId,
      enrollmentSessionId: segment.segmentId,
      trackId: segment.trackId,
      workerGeneration: review.trial.workerGeneration,
      assetIdentity: review.trial.assetIdentity,
    });
    await h.flow.save({ [segment.segmentId]: { label: 'A', truth: 'genuine' } });
    const trial = h.flow.getSnapshot().trial;
    expect(h.flow.getSnapshot().status).toBe('saved');
    expect(() => validatePhysicalTrial(trial, context)).not.toThrow();
    const invalid = [
      (t) => {
        t.segments[0].observationCount = NaN;
      },
      (t) => {
        t.segments[0].maxGapMs = Infinity;
      },
      (t) => {
        t.segments[0].gapCount = -1;
      },
      (t) => {
        t.segments[0].peakActivity = 101;
      },
      (t) => {
        t.segments[0].firstObservationAt = t.segments[0].lastObservationAt + 1;
      },
      (t) => {
        t.segments[0].combinedPassedAt = null;
      },
      (t) => {
        t.segments[0].meterProof.assetIdentity = 'b'.repeat(64);
      },
      (t) => {
        t.segments[0].meterProof.enrollmentSessionId = 'different';
      },
      (t) => {
        t.segments[0].meterProof.trackId = 999;
      },
      (t) => {
        t.segments[0].truth = 'attack';
        t.segments[0].attackSubtype = 'unknown';
      },
      (t) => {
        t.segments.push(structuredClone(t.segments[0]));
      },
      (t) => {
        t.companyId = 'other';
      },
      (t) => {
        t.segments[0].rawFrames = [];
      },
      (t) => {
        t.configuration.rawFrames = [];
      },
    ];
    for (const mutate of invalid) {
      const forged = structuredClone(trial);
      mutate(forged);
      expect(() => validatePhysicalTrial(forged, context)).toThrow();
    }
  });
  it('excludes interrupted, unscored and unmeasured segments while separating attack subtypes', async () => {
    const h = await harness();
    await h.start();
    await h.run(15000);
    const segment = h.flow.getSnapshot().segments[0];
    await h.flow.save({
      [segment.segmentId]: { label: 'A', truth: 'attack', attackSubtype: 'display_photo' },
    });
    const trial = h.flow.getSnapshot().trial;
    const interrupted = structuredClone(trial);
    interrupted.completion = 'interrupted';
    interrupted.segments[0].endReason = 'interrupted';
    const unscored = structuredClone(trial);
    unscored.segments[0].truth = 'unscored';
    const unmeasured = structuredClone(trial);
    unmeasured.segments[0].observationCount = 0;
    const report = summarizePhysicalTrials([trial, interrupted, unscored, unmeasured]);
    expect(report).toMatchObject({
      incomplete: 1,
      unscored: 1,
      unmeasured: 1,
      attack: { denominator: 1 },
      bySubtype: { display_photo: { denominator: 1 } },
    });
    expect(summarizePhysicalTrials([trial], { lighting: 'dim' }).attack.denominator).toBe(0);
  });
  it('marks disappearing segments incomplete and keeps returned track evidence separate', async () => {
    const h = await harness();
    await h.start();
    await h.run(500);
    h.faces([]);
    await h.step();
    h.faces([{ box: [10, 10, 100, 100], confidence: 0.99, reasonCode: null }]);
    await h.run(14500);
    const state = h.flow.getSnapshot();
    expect(state.status).toBe('review');
    expect(state.segments).toHaveLength(2);
    expect(state.segments[0].endReason).toBe('lost');
    const rows = Object.fromEntries(
      state.segments.map((s) => [s.segmentId, { label: 'A', truth: 'genuine' }]),
    );
    await h.flow.save(rows);
    const report = summarizePhysicalTrials([h.flow.getSnapshot().trial]);
    expect(report.incomplete).toBe(1);
    expect(report.genuine.denominator).toBe(1);
  });
  it('interrupts a stale detection rather than recording a timed rejection', async () => {
    const h = await harness();
    await h.start();
    await h.run(500);
    h.time(2200);
    h.flow.tick(2200);
    expect(h.flow.getSnapshot().trial).toMatchObject({
      completion: 'interrupted',
      reason: 'analysis_stale',
    });
  });
  it('does not initialize liveness after cancellation while the detector initializes', async () => {
    const h = await harness();
    let release,
      called = 0;
    h.engine.initialize = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    h.liveness.initialize = async () => {
      called++;
    };
    const pending = h.flow.start(options);
    for (let i = 0; i < 20 && !release; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(release).toBeTypeOf('function');
    h.flow.interrupt('Navigation');
    release();
    await pending;
    expect(h.flow.getSnapshot().status).toBe('idle');
    expect(called).toBe(0);
  });
  it('allows a first face after a long healthy empty period before declaring stale pose', async () => {
    const h = await harness();
    h.faces([]);
    await h.start();
    await h.run(10000);
    h.faces([{ box: [10, 10, 100, 100], confidence: 0.99, reasonCode: null }]);
    await h.step();
    expect(h.flow.getSnapshot().status).toBe('running');
    await h.run(5000);
    expect(h.flow.getSnapshot().trial.completion).toBe('timed');
  });
  it('fences a late in-flight detection at the protocol deadline', async () => {
    const h = await harness();
    await h.start();
    await h.run(14000);
    let release;
    h.engine.detectFrame = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    h.time(14950);
    const pending = h.flow.process({ width: 640, height: 480 }, 14950);
    h.time(15000);
    release({ faces: [] });
    await pending;
    expect(h.flow.getSnapshot().trial.endTimestamp).toBe(15000);
    expect(h.flow.getSnapshot().trial.completion).toBe('timed');
    expect(h.flow.getSnapshot().segments.every((s) => s.lastSeenAt <= 15000)).toBe(true);
  });
  it('preserves legacy extra settings while storing only canonical challenge configuration', async () => {
    const h = await harness({ legacyHint: 'retained' });
    await h.start();
    await h.run(15000);
    const segment = h.flow.getSnapshot().segments[0];
    await h.flow.save({ [segment.segmentId]: { label: 'A', truth: 'genuine' } });
    expect(h.flow.getSnapshot().status).toBe('saved');
    expect(h.flow.getSnapshot().trial.configuration).toEqual({
      version: 1,
      turnLeft: false,
      turnRight: false,
      blink: true,
    });
    expect(h.repo.getSnapshot().database.settings.enrollmentLiveness.legacyHint).toBe('retained');
  });
  it('loads old schema 5 without the optional collection and rejects malformed records', async () => {
    const db = createDatabase(context);
    delete db.physicalTrials;
    expect(() => validateDatabase(db, context)).not.toThrow();
    expect(() => validatePhysicalTrial({ id: 'bad' }, context)).toThrow();
    expect(summarizePhysicalTrials([]).genuine.denominator).toBe(0);
  });
});

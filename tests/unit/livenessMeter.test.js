import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createLivenessMeter } from '../../src/utils/hooks/faceRecognition/liveness/livenessMeter';
import {
  meterScore,
  meterQualifies,
} from '../../src/utils/hooks/faceRecognition/liveness/livenessMeterPolicy';

const makeMeter = () =>
  createLivenessMeter({
    cameraSessionId: 'camera',
    enrollmentSessionId: 'session',
    trackId: 1,
    workerGeneration: 2,
    assetIdentity: 'asset',
  });
const observation = (timestamp, fields = {}) => ({
  timestamp,
  sequence: timestamp + 1,
  sourceTrackId: 1,
  workerGeneration: 2,
  fresh: true,
  exclusive: true,
  yaw: 0,
  pitch: 0,
  eyeBlinkLeft: 0.1,
  eyeBlinkRight: 0.1,
  jawOpen: 0.05,
  mouthSmileLeft: 0.05,
  mouthSmileRight: 0.05,
  jawMotion: 0.1,
  smileMotion: 0.8,
  ...fields,
});

describe('per-face motion evidence', () => {
  it('uses the exact boundary and completed families', () => {
    expect(meterScore({ blink: 0, head: 3, expression: 3 })).toBe(60);
    expect(meterQualifies({ blink: 0, head: 3, expression: 3 })).toBe(true);
    expect(meterQualifies({ blink: 2, head: 2, expression: 2 })).toBe(false);
  });
  it('accepts head and bilateral smile, then latches during stillness', () => {
    const meter = makeMeter();
    for (let t = 0; t <= 4000; t += 100) {
      const smile = t >= 500 && t <= 1100;
      const head = t >= 2000 && t <= 2600;
      meter.update(
        observation(t, {
          yaw: head ? 8 : 0,
          mouthSmileLeft: smile ? 0.65 : 0.05,
          mouthSmileRight: smile ? 0.65 : 0.05,
          smileMotion: smile ? 0.87 : 0.8,
        }),
      );
    }
    const passed = meter.snapshot();
    expect(passed.status).toBe('passed_basic');
    expect(passed.accepted.events.find((e) => e.family === 'expression').channel).toBe('smile');
    for (let t = 4100; t <= 16000; t += 100) meter.update(observation(t));
    expect(meter.snapshot().accepted).toEqual(passed.accepted);
  });
  it('does not grant stationary or wrong-track observations', () => {
    const meter = makeMeter();
    for (let t = 0; t <= 3000; t += 100) meter.update(observation(t));
    expect(meter.snapshot().status).toBe('collecting');
    meter.update(observation(3100, { sourceTrackId: 3 }));
    expect(meter.snapshot().status).toBe('insufficient_quality');
    expect(meter.snapshot().accepted).toBeNull();
  });
});

describe('production worker landmark distances', () => {
  it('normalizes rectangular frames and rigid transforms', () => {
    const source = readFileSync(
      new URL('../../src/workers/liveness.worker.js', import.meta.url),
      'utf8',
    );
    const context = { self: {}, Math, Number, Array };
    runInNewContext(source, context);
    const points = Array.from({ length: 292 }, () => ({ x: 0, y: 0, z: 0 }));
    Object.assign(points, {
      33: { x: 0.2, y: 0.4, z: 0 },
      263: { x: 0.4, y: 0.4, z: 0 },
      13: { x: 0.3, y: 0.5, z: 0 },
      14: { x: 0.3, y: 0.52, z: 0 },
      61: { x: 0.25, y: 0.5, z: 0 },
      291: { x: 0.35, y: 0.5, z: 0 },
    });
    const base = context.expressionMotionFeatures(points, 640, 480);
    expect(base.jawMotion).toBeCloseTo(0.075);
    const transformed = points.map((p) => ({
      x: p.x * 1.2 + 0.1,
      y: p.y * 1.2 + 0.2,
      z: p.z * 1.2,
    }));
    expect(context.expressionMotionFeatures(transformed, 640, 480).jawMotion).toBeCloseTo(
      base.jawMotion,
    );
  });
});

it('validates a session-bound passed proof and rejects forged totals or bindings', async () => {
  const { validateLivenessMeter } = await import(
    '../../src/utils/hooks/faceRecognition/liveness/validateLivenessMeter'
  );
  const meter = makeMeter();
  for (let t = 0; t <= 4000; t += 100) {
    const smile = t >= 500 && t <= 1100,
      head = t >= 2000 && t <= 2600;
    meter.update(
      observation(t, {
        yaw: head ? 8 : 0,
        mouthSmileLeft: smile ? 0.65 : 0.05,
        mouthSmileRight: smile ? 0.65 : 0.05,
        smileMotion: smile ? 0.87 : 0.8,
      }),
    );
  }
  const proof = {
    ...meter.snapshot().accepted,
    capture: {
      captureTimestamp: 4000,
      poseTimestamp: 4000,
      decisionTimestamp: 4001,
      exclusive: true,
    },
  };
  const binding = {
    cameraSessionId: 'camera',
    sessionId: 'session',
    trackId: 1,
    workerGeneration: 2,
    assetIdentity: 'asset',
    captureTimestamp: 4000,
    poseTimestamp: 4000,
    decisionTimestamp: 4001,
    exclusive: true,
  };
  expect(() => validateLivenessMeter(proof, binding)).not.toThrow();
  expect(() => validateLivenessMeter({ ...proof, acceptedScore: 100 }, binding)).toThrow();
  expect(() => validateLivenessMeter(proof, { ...binding, trackId: 2 })).toThrow();
  expect(() =>
    validateLivenessMeter({ ...proof, events: [proof.events[0], proof.events[0]] }, binding),
  ).toThrow();
});

it('reports insufficient sampling without granting a pass', () => {
  const meter = makeMeter();
  for (let t = 0; t <= 4000; t += 250) meter.update(observation(t));
  expect(meter.snapshot().status).toBe('insufficient_quality');
  expect(meter.snapshot().reason).toBe('insufficient_sampling');
  expect(meter.snapshot().accepted).toBeNull();
});

it('recognizes a real event after a long neutral baseline', async () => {
  const meter = makeMeter();
  for (let t = 0; t <= 15000; t += 100) {
    const head = t >= 12000 && t <= 12600;
    const smile = t >= 13500 && t <= 14100;
    meter.update(
      observation(t, {
        yaw: head ? 8 : 0,
        mouthSmileLeft: smile ? 0.65 : 0.05,
        mouthSmileRight: smile ? 0.65 : 0.05,
        smileMotion: smile ? 0.87 : 0.8,
      }),
    );
  }
  const proof = meter.snapshot().accepted;
  expect(proof?.status).toBe('passed_basic');
  const { validateLivenessMeter } = await import(
    '../../src/utils/hooks/faceRecognition/liveness/validateLivenessMeter'
  );
  expect(() => validateLivenessMeter(proof)).not.toThrow();
});

it('rejects malformed counts, gaps, returns, extra payloads, and stale capture evidence', async () => {
  const { validateLivenessMeter } = await import(
    '../../src/utils/hooks/faceRecognition/liveness/validateLivenessMeter'
  );
  const meter = makeMeter();
  for (let t = 0; t <= 4000; t += 100) {
    const smile = t >= 500 && t <= 1100,
      head = t >= 2000 && t <= 2600;
    meter.update(
      observation(t, {
        yaw: head ? 8 : 0,
        mouthSmileLeft: smile ? 0.65 : 0.05,
        mouthSmileRight: smile ? 0.65 : 0.05,
        smileMotion: smile ? 0.87 : 0.8,
      }),
    );
  }
  const proof = {
    ...meter.snapshot().accepted,
    capture: {
      captureTimestamp: 4000,
      poseTimestamp: 4000,
      decisionTimestamp: 4001,
      exclusive: true,
    },
  };
  const binding = {
    cameraSessionId: 'camera',
    sessionId: 'session',
    trackId: 1,
    workerGeneration: 2,
    assetIdentity: 'asset',
    captureTimestamp: 4000,
    poseTimestamp: 4000,
    decisionTimestamp: 4001,
    exclusive: true,
  };
  expect(() => validateLivenessMeter(proof, binding)).not.toThrow();
  for (const mutation of [
    (p) => {
      delete p.events[0].holdCount;
    },
    (p) => {
      p.events[0].holdCount = NaN;
    },
    (p) => {
      p.events[0].maxGapMs = 201;
    },
    (p) => {
      p.events[0].returnDelta = 99;
    },
    (p) => {
      p.events[0].returnCount = null;
    },
    (p) => {
      p.events[0].rawLandmarks = Array(400).fill(0);
    },
    (p) => {
      p.capture.poseTimestamp = 2000;
    },
    (p) => {
      p.assetIdentity = 'x'.repeat(129);
    },
    (p) => {
      p.events.push(structuredClone(p.events[0]));
    },
  ]) {
    const forged = structuredClone(proof);
    mutation(forged);
    expect(() => validateLivenessMeter(forged, binding)).toThrow();
  }
});

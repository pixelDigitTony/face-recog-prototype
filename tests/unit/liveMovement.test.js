import { describe, it, expect } from 'vitest';
import { createLiveMovement } from '../../src/utils/hooks/faceRecognition/liveness/liveMovement';
import { createLivenessMeter } from '../../src/utils/hooks/faceRecognition/liveness/livenessMeter';

const obs = (t, fields = {}) => ({
  timestamp: t,
  sequence: t + 1,
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
const make = () => createLiveMovement({ trackId: 1, workerGeneration: 2 });
function frames(m, from, to, fields = {}) {
  for (let t = from; t <= to; t += 50) m.update(obs(t, fields));
}

describe('transient live movement', () => {
  it('gives no baseline, rigid translation, coefficient-only or jitter credit', () => {
    const a = make();
    for (let t = 0; t <= 4000; t += 50)
      a.update(
        obs(t, { yaw: t % 100 ? 0.8 : -0.8, jawOpen: t % 100 ? 0.8 : 0.05, box: [t, t, 100, 100] }),
      );
    expect(a.snapshot()).toMatchObject({ score: 0, lastMovementAt: null, idle: false });
  });
  it('shares 50 for blink and facial motion, independently of another track', () => {
    const a = make(),
      b = make();
    frames(a, 0, 400);
    frames(a, 450, 550, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 });
    frames(a, 600, 800);
    expect(a.snapshot()).toMatchObject({ faceScore: 50, headScore: 0, score: 50 });
    frames(a, 850, 1200, { jawOpen: 0.6, jawMotion: 0.16 });
    expect(a.snapshot().faceScore).toBe(50);
    expect(b.snapshot().score).toBe(0);
  });
  it('credits large rotations and refreshes on subsequent movements but not on held poses', () => {
    const a = make();
    frames(a, 0, 400);
    frames(a, 450, 800, { yaw: 25 });
    expect(a.snapshot()).toMatchObject({ headScore: 50, score: 50 });
    const first = a.snapshot().lastMovementAt;
    frames(a, 850, 14000, { yaw: 25 });
    expect(a.snapshot().lastMovementAt).toBe(first);
    frames(a, 14050, 14400, { yaw: 32 });
    expect(a.snapshot().lastMovementAt).toBeGreaterThan(first);
    const refreshed = a.snapshot().lastMovementAt;
    frames(a, 14450, 20000, { yaw: 32 });
    expect(a.snapshot()).toMatchObject({ score: 50, lastMovementAt: refreshed });
    expect(a.tick(refreshed + 14999).score).toBe(50);
    expect(a.tick(refreshed + 15000)).toMatchObject({ score: 0, idle: true, lastMovementAt: null });
    frames(a, 30000, 30500, { yaw: 32 });
    frames(a, 30550, 30900, { yaw: 25 });
    expect(a.snapshot()).toMatchObject({ score: 50, idle: false });
  });
  it('refreshes facial motion in a full bucket without refreshing a held expression', () => {
    const a = make();
    frames(a, 0, 400);
    frames(a, 450, 800, { jawOpen: 0.4, jawMotion: 0.14 });
    const first = a.snapshot().lastMovementAt;
    frames(a, 850, 12000, { jawOpen: 0.4, jawMotion: 0.14 });
    expect(a.snapshot().lastMovementAt).toBe(first);
    frames(a, 12050, 12400, { jawOpen: 0.7, jawMotion: 0.19 });
    expect(a.snapshot().lastMovementAt).toBeGreaterThan(first);
    expect(a.snapshot().faceScore).toBe(50);
  });
  it('ignores invalid, stale, duplicate and out-of-order observations', () => {
    const a = make();
    frames(a, 0, 400);
    frames(a, 450, 800, { yaw: 25 });
    const before = a.snapshot();
    a.update(obs(750, { yaw: 50 }));
    a.update(obs(800, { yaw: 50, sequence: 801 }));
    a.update(obs(850, { yaw: NaN }));
    a.update(obs(900, { yaw: 50, fresh: false }));
    a.update(obs(950, { yaw: 50, sourceTrackId: 2 }));
    expect(a.snapshot()).toEqual(before);
    a.pause();
    expect(a.snapshot()).toEqual(before);
  });
  it('combines independent buckets and does not mutate accepted proof after idle reset', () => {
    const m = createLivenessMeter({
      cameraSessionId: 'c',
      enrollmentSessionId: 'e',
      trackId: 1,
      workerGeneration: 2,
      assetIdentity: 'asset',
    });
    for (let t = 0; t <= 4000; t += 50) {
      const smile = t >= 500 && t <= 1100,
        head = t >= 2000 && t <= 2600;
      m.update(
        obs(t, {
          yaw: head ? 8 : 0,
          mouthSmileLeft: smile ? 0.65 : 0.05,
          mouthSmileRight: smile ? 0.65 : 0.05,
          smileMotion: smile ? 0.87 : 0.8,
        }),
      );
    }
    const passed = m.snapshot();
    expect(passed.status).toBe('passed_basic');
    expect(passed.activity).toMatchObject({ score: 100, faceScore: 50, headScore: 50 });
    m.tick(passed.activity.lastMovementAt + 15000);
    const idle = m.snapshot();
    expect(idle.activity).toMatchObject({ score: 0, idle: true });
    expect(idle.status).toBe('passed_basic');
    expect(idle.accepted).toEqual(passed.accepted);
    expect(idle.score).toBe(passed.score);
  });
});

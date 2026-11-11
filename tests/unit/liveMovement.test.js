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
  it('calculates blink and expression magnitude independently of another track', () => {
    const a = make(),
      b = make();
    frames(a, 0, 400);
    frames(a, 450, 550, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 });
    frames(a, 600, 800);
    // Closure 0.9 maps to (0.9 - 0.6) / 0.4 = 0.75.
    expect(a.snapshot().score).toBe(75);
    frames(a, 850, 1200, { jawOpen: 0.8, jawMotion: 0.2 });
    // A larger expression replaces the weaker blink in the face term and fills the meter.
    expect(a.snapshot().score).toBe(100);
    frames(a, 1250, 1600);
    frames(a, 1650, 2000, { jawOpen: 0.45, jawMotion: 0.15 });
    frames(a, 2050, 2400);
    // The smaller expression leaves the stronger blink, so the meter falls to 75.
    expect(a.snapshot().score).toBe(75);
    expect(b.snapshot().score).toBe(0);
  });
  it('raises and lowers the meter from head magnitude and does not reset on a timer', () => {
    const a = make();
    frames(a, 0, 400);
    frames(a, 450, 800, { yaw: 25 });
    expect(a.snapshot().score).toBe(100);
    const first = a.snapshot().lastMovementAt;
    frames(a, 850, 20000, { yaw: 25 });
    expect(a.snapshot()).toMatchObject({ score: 100, lastMovementAt: first, idle: false });
    expect(a.tick(first + 15000)).toMatchObject({
      score: 100,
      idle: false,
      lastMovementAt: first,
    });
    frames(a, 20050, 20500, { yaw: 0 });
    frames(a, 20550, 21000, { yaw: 8 });
    frames(a, 21050, 21400, { yaw: 0 });
    // 8° / 25° is 32, and that completed turn replaces the earlier full turn.
    expect(a.snapshot().score).toBe(32);
    expect(a.tick(a.snapshot().lastMovementAt + 20000).score).toBe(32);
  });
  it('increases a held expression when the movement itself gets larger', () => {
    const a = make();
    frames(a, 0, 400);
    frames(a, 450, 800, { jawOpen: 0.4, jawMotion: 0.14 });
    // Coefficient change 0.35 and geometry change 0.04 → min(0.7, 0.4) = 0.4.
    expect(a.snapshot().score).toBe(40);
    const first = a.snapshot().lastMovementAt;
    frames(a, 850, 12000, { jawOpen: 0.4, jawMotion: 0.14 });
    expect(a.snapshot()).toMatchObject({ score: 40, lastMovementAt: first });
    frames(a, 12050, 12400, { jawOpen: 0.7, jawMotion: 0.19 });
    expect(a.snapshot().score).toBe(90);
    expect(a.snapshot().lastMovementAt).toBeGreaterThan(first);
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
  it('keeps the calculated score and does not mutate accepted proof while the face is still', () => {
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
    // Smile magnitude 0.7 and a later 8° turn (0.32) combine to 77.
    expect(passed.activity.score).toBe(77);
    expect(passed.activity.idle).toBe(false);
    m.tick(passed.activity.lastMovementAt + 15000);
    const still = m.snapshot();
    expect(still.activity).toMatchObject({ score: 77, idle: false });
    expect(still.status).toBe('passed_basic');
    expect(still.accepted).toEqual(passed.accepted);
    expect(still.score).toBe(passed.score);
  });
});

import { describe, it, expect } from 'vitest';
import { createFaceTracker } from '@/utils/hooks/faceRecognition/recognition/faceTracker';

const detection = (x, extra = {}) => ({ box: [x, 20, 100, 120], confidence: 0.99, ...extra });

describe('face track recovery', () => {
  it('recovers after a shifted box overlaps a recently lost track instead of creating endless ghosts', () => {
    const tracker = createFaceTracker();
    tracker.update([detection(20)], 0);
    tracker.update([detection(100)], 100);
    const ids = [],
      uncertain = [];
    for (let i = 2; i < 35; i++) {
      const tracked = tracker.update([detection(60 + (i % 2))], i * 100);
      ids.push(tracked.faces[0].trackId);
      uncertain.push(tracked.faces[0].ambiguous);
    }
    expect(new Set(ids.slice(1)).size).toBe(1);
    expect(uncertain.slice(1).every((v) => !v)).toBe(true);
  });
  it('marks both sides of a shared old association regardless of detection order', () => {
    for (const xs of [
      [20, 70],
      [70, 20],
    ]) {
      const tracker = createFaceTracker();
      tracker.update([detection(20)], 0);
      const result = tracker.update(
        xs.map((x) => detection(x)),
        100,
      );
      expect(result.ambiguous).toBe(true);
      expect(result.faces.every((f) => f.ambiguous)).toBe(true);
      expect(new Set(result.faces.map((f) => f.trackId)).size).toBe(2);
    }
  });
  it('recovers after two nearby faces separate and preserves IDs when detection order changes', () => {
    const tracker = createFaceTracker();
    tracker.update([detection(20), detection(180)], 0);
    tracker.update([detection(70), detection(120)], 100);
    const stable = tracker.update([detection(20), detection(180)], 200);
    for (let i = 3; i < 20; i++) {
      const next = tracker.update([detection(180), detection(20)], i * 100);
      expect(next.faces.map((f) => f.trackId)).toEqual(
        [...stable.faces].reverse().map((f) => f.trackId),
      );
      expect(next.ambiguous).toBe(false);
    }
  });
  it('reuses one recent missed track but retires an expired track', () => {
    const tracker = createFaceTracker();
    const first = tracker.update([detection(20)], 0).faces[0].trackId;
    tracker.update([], 100);
    expect(tracker.update([detection(21)], 200).faces[0].trackId).toBe(first);
    expect(tracker.update([detection(21)], 2000).faces[0].trackId).not.toBe(first);
  });
});

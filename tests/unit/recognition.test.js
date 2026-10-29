import { describe, it, expect } from 'vitest';
import {
  normalizeEmbedding,
  cosineSimilarity,
} from '@/utils/hooks/faceRecognition/recognition/cosineSimilarity';
import {
  similarityTransform,
  canonicalLandmarks,
} from '@/utils/hooks/faceRecognition/recognition/alignFace';
import { filterAndSortRecords } from '@/utils/hooks/faceRecognition/tableFormatting';

describe('recognition math', () => {
  it('normalizes embeddings and compares without mutating them', () => {
    const a = normalizeEmbedding(Array(128).fill(1));
    const copy = [...a];
    expect(Math.hypot(...a)).toBeCloseTo(1, 12);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 12);
    expect(a).toEqual(copy);
  });
  it('rejects nonfinite, zero-norm and wrong-sized vectors', () => {
    for (const vector of [Array(128).fill(0), Array(128).fill(NaN), [1, 2]])
      expect(() => normalizeEmbedding(vector)).toThrow();
  });
  it('recovers a known rotated/scaled similarity transform', () => {
    const points = canonicalLandmarks.map(([x, y]) => [(x - 12) / 2, (y + 8) / 2]);
    const matrix = similarityTransform(points);
    expect(matrix[0]).toBeCloseTo(2);
    expect(matrix[2]).toBeCloseTo(12);
    expect(matrix[5]).toBeCloseTo(-8);
  });
  it('returns identity for canonical points and rejects degenerate points', () => {
    const matrix = similarityTransform(canonicalLandmarks);
    expect(matrix[0]).toBeCloseTo(1);
    expect(matrix[4]).toBeCloseTo(1);
    expect(() => similarityTransform(Array(5).fill([1, 1]))).toThrow();
  });
  it('compares at the exact threshold using unrounded scores', () => {
    const threshold = 0.363,
      a = [1, 0],
      b = [threshold, Math.sqrt(1 - threshold ** 2)];
    expect(cosineSimilarity(a, b) >= threshold).toBe(true);
    const below = threshold - 1e-8;
    expect(cosineSimilarity(a, [below, Math.sqrt(1 - below ** 2)]) >= threshold).toBe(false);
  });
});
describe('database queries', () => {
  it('filters capture dates in Manila and sorts with stable ID ties', () => {
    const rows = [
      { id: 'b', completedAt: '2026-10-27T16:30:00.000Z', outcome: 'MATCH' },
      { id: 'a', completedAt: '2026-10-27T16:30:00.000Z', outcome: 'MATCH' },
      { id: 'c', completedAt: '2026-10-26T15:30:00.000Z', outcome: 'NO_FACE' },
    ];
    expect(
      filterAndSortRecords(rows, {
        from: '2026-10-28',
        to: '2026-10-28',
        orderBy: 'completedAt',
        direction: 'asc',
      }).map((r) => r.id),
    ).toEqual(['a', 'b']);
  });
});

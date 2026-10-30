import { describe, it, expect } from 'vitest';
import { assessLighting } from '@/utils/hooks/faceRecognition/recognition/lightingQuality';

describe('advisory lighting statistics', () => {
  const solid = (value) => assessLighting(new Uint8Array(400).fill(value), 20, 20);
  it.each([
    [30, ['LOW_LIGHT']],
    [230, ['OVEREXPOSED']],
    [100, []],
    [60, []],
    [200, []],
  ])('classifies uniform brightness %s', (value, warnings) => {
    expect(solid(value).warnings).toEqual(warnings);
  });
  it('detects uneven light and uses a strict difference boundary', () => {
    const data = new Uint8Array(400).fill(100);
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) data[y * 20 + x] = 140;
    expect(assessLighting(data, 20, 20).warnings).toEqual([]);
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) data[y * 20 + x] = 141;
    expect(assessLighting(data, 20, 20).warnings).toEqual(['UNEVEN_LIGHTING']);
  });
  it.each([
    [5, 'LOW_LIGHT'],
    [250, 'OVEREXPOSED'],
  ])('checks clipped pixels %s with a strict 20 percent boundary', (value, code) => {
    const data = new Uint8Array(250).fill(120);
    const indices = [];
    for (let y = 1; y < 4; y++) for (let x = 5; x < 45; x++) indices.push(y * 50 + x);
    indices.slice(0, 24).forEach((i) => {
      data[i] = value;
    });
    expect(assessLighting(data, 50, 5).warnings).not.toContain(code);
    data[indices[24]] = value;
    expect(assessLighting(data, 50, 5).warnings).toContain(code);
  });
  it('ignores background and outer face pixels, clips regions and omits an odd middle column from the side comparison', () => {
    const data = new Uint8Array(400).fill(120);
    const before = assessLighting(data, 20, 20);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) if (x < 2 || x >= 18 || y < 2 || y >= 18) data[y * 20 + x] = 0;
    expect(assessLighting(data, 20, 20)).toEqual(before);
    expect(assessLighting(data, 20, 20, [-5, -5, 30, 30])).not.toBeNull();
    const odd = new Uint8Array(100).fill(100);
    for (let y = 0; y < 10; y++) odd[y * 10 + 4] = 200;
    expect(assessLighting(odd, 10, 10, [0, 0, 10, 10]).leftRightDifference).toBeGreaterThan(0);
    expect(assessLighting(odd, 10, 10, [0, 0, 9, 10]).leftRightDifference).toBe(0);
  });
  it('returns no fabricated measurement for invalid, empty or tiny regions', () => {
    expect(assessLighting([], 0, 0)).toBeNull();
    expect(assessLighting([100], 1, 1)).toBeNull();
    expect(assessLighting(new Uint8Array(400), 20, 20, null)).toBeNull();
    expect(assessLighting([NaN, 0, 0, 0], 2, 2)).toBeNull();
    expect(assessLighting(new Uint8Array(400), 20, 20, [50, 50, 10, 10])).toBeNull();
  });
});

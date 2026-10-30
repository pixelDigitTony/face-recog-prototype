export const LIGHTING_FEEDBACK = Object.freeze({
  LOW_LIGHT: {
    label: 'Low light',
    guidance: 'Face a soft light source; avoid a bright window behind you.',
  },
  OVEREXPOSED: {
    label: 'Overexposed',
    guidance: 'Reduce direct light or glare so facial details remain visible.',
  },
  UNEVEN_LIGHTING: {
    label: 'Uneven lighting',
    guidance: 'Use more even frontal light to reduce strong side shadows.',
  },
});

// Advisory only: never used for recognition decisions or challenge progress.
export function assessLighting(data, width, height, box = [0, 0, width, height]) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    data?.length !== width * height ||
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    box[2] <= 0 ||
    box[3] <= 0
  )
    return null;
  const [x, y, w, h] = box;
  const left = Math.max(0, Math.ceil(x + w * 0.1));
  const right = Math.min(width, Math.floor(x + w * 0.9));
  const top = Math.max(0, Math.ceil(y + h * 0.1));
  const bottom = Math.min(height, Math.floor(y + h * 0.9));
  const half = Math.floor((right - left) / 2);
  if (half < 1 || bottom <= top) return null;
  let total = 0,
    dark = 0,
    bright = 0,
    leftSum = 0,
    rightSum = 0;
  const count = (right - left) * (bottom - top);
  for (let row = top; row < bottom; row++) {
    for (let col = left; col < right; col++) {
      const value = data[row * width + col];
      if (!Number.isFinite(value) || value < 0 || value > 255) return null;
      total += value;
      if (value <= 5) dark++;
      if (value >= 250) bright++;
      if (col < left + half) leftSum += value;
      if (col >= right - half) rightSum += value;
    }
  }
  const meanBrightness = total / count,
    nearBlackFraction = dark / count,
    nearWhiteFraction = bright / count,
    leftRightDifference = Math.abs(leftSum - rightSum) / (half * (bottom - top));
  const warnings = [];
  if (meanBrightness < 60 || nearBlackFraction > 0.2) warnings.push('LOW_LIGHT');
  if (meanBrightness > 200 || nearWhiteFraction > 0.2) warnings.push('OVEREXPOSED');
  if (leftRightDifference > 40) warnings.push('UNEVEN_LIGHTING');
  return {
    version: 'lighting-feedback-v1',
    meanBrightness,
    nearBlackFraction,
    nearWhiteFraction,
    leftRightDifference,
    warnings,
  };
}

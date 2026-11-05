export const LIVENESS_METER_POLICY = Object.freeze({
  version: 'motion-evidence-v1',
  enrollmentPolicy: 'enrollment-per-face-meter-v3',
  weights: Object.freeze({ blink: 40, head: 25, expression: 35 }),
  threshold: 60,
  minimumObservations: 12,
  minimumSpanMs: 2000,
  maximumGapMs: 200,
  collectionWindowMs: 10000,
  captureFreshnessMs: 1500,
  maxObservations: 200,
  filterTimeConstantMs: 80,
  landmarks: Object.freeze({
    leftEye: 33,
    rightEye: 263,
    upperLip: 13,
    lowerLip: 14,
    leftMouth: 61,
    rightMouth: 291,
  }),
  expressionLandmarkDelta: 0.025,
  blink: Object.freeze({ open: 0.3, closed: 0.6, minimumMs: 80, maximumMs: 1500 }),
  movement: Object.freeze({
    baselineMs: 300,
    holdMs: 150,
    maximumMs: 4000,
    headMin: 4,
    headMax: 15,
    headReturn: 3,
    frontal: 15,
    expressionDelta: 0.2,
    expressionPeak: 0.35,
    expressionReturn: 0.1,
  }),
});

export function meterScore(progress) {
  const weights = LIVENESS_METER_POLICY.weights;
  return Object.keys(weights).reduce(
    (sum, family) => sum + (weights[family] * progress[family]) / 3,
    0,
  );
}
export function meterQualifies(progress) {
  const completed = Object.keys(LIVENESS_METER_POLICY.weights).filter((key) => progress[key] === 3);
  return (
    meterScore(progress) >= 60 &&
    completed.length >= 2 &&
    (completed.includes('blink') || completed.includes('expression'))
  );
}

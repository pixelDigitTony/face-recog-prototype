// Transient display policy; does not alter persisted enrollment evidence.
export const LIVE_MOVEMENT_POLICY = Object.freeze({
  version: 'live-movement-v1',
  bucketMaximum: 50,
  idleMs: 15000,
  maxGapMs: 200,
  holdMs: 150,
  headThreshold: 4,
  expressionDelta: 0.2,
  expressionPeak: 0.35,
  expressionGeometry: 0.025,
  frontal: 15,
  eyeOpen: 0.3,
  eyeClosed: 0.6,
  blinkMinMs: 80,
  blinkMaxMs: 1500,
});

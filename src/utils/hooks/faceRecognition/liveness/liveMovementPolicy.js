// Transient display policy. It does not alter persisted enrollment evidence.
// A qualified movement contributes its measured magnitude. Blink and expression
// share the face term (the stronger one), then combine with head rotation into
// one 0-100 score. Nothing expires on a timer.
export const DEFAULT_LIVENESS_PASS_RATE = 90;

export function livenessPassRate(value) {
  return Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_LIVENESS_PASS_RATE;
}

export function livenessMeterReady(score, rate) {
  return Number.isFinite(score) && score >= livenessPassRate(rate);
}

export const LIVE_MOVEMENT_POLICY = Object.freeze({
  version: 'live-movement-v2',
  maxGapMs: 200,
  headFloorDeg: 4,
  headFullDeg: 25,
  expressionDelta: 0.2,
  expressionFull: 0.5,
  expressionPeak: 0.35,
  expressionGeometry: 0.025,
  expressionGeometryFull: 0.1,
  frontal: 15,
  eyeOpen: 0.3,
  eyeClosed: 0.6,
  blinkMinMs: 80,
  blinkMaxMs: 1500,
});

export function liveMovementScore(head, expression, blink) {
  const face = Math.max(expression, blink);
  return Math.round(Math.min(1, Math.hypot(head, face)) * 100);
}

export const SCHEMA_VERSION = 2;
export const OUTCOMES = [
  'ENROLLED',
  'MATCH',
  'NO_MATCH',
  'NO_FACE',
  'MULTIPLE_FACES',
  'LOW_QUALITY',
  'NOT_ENROLLED',
  'MODEL_MISMATCH',
  'CAMERA_ERROR',
  'MODEL_ERROR',
  'INFERENCE_ERROR',
  'LIVENESS_FAILED',
  'LIVENESS_EXPIRED',
  'INCONCLUSIVE',
  'DIAGNOSTIC_ONLY',
];
export const defaultSettings = Object.freeze({
  matchThreshold: 0.85,
  saveThumbnails: true,
  maxPeople: 50,
  maxAttempts: 200,
  maxEstimatedBytes: 3145728,
  displayTimeZone: 'Asia/Manila',
});

export const SCHEMA_VERSION = 1;
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
];
export const defaultSettings = Object.freeze({
  matchThreshold: 0.363,
  saveThumbnails: true,
  maxPeople: 50,
  maxAttempts: 200,
  maxEstimatedBytes: 3145728,
  displayTimeZone: 'Asia/Manila',
});

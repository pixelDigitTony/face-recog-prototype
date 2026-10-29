import { LIVE_TIMING } from './liveTiming';

export const LIVE_POLICY = 'live-85-strict-v1';
export const SCORE_MAPPING = 'cosine-positive-percent-v1';
export function percentage(score) {
  if (score === null || score === undefined) return null;
  if (!Number.isFinite(score) || Math.abs(score) > 1.00001)
    throw new Error('Invalid cosine score.');
  return 100 * Math.max(0, Math.min(1, score));
}
export function similarityPassed(score) {
  return percentage(score) !== null && score > 0.85;
}
export function formatPercentage(score) {
  const value = percentage(score);
  return value === null ? '—' : `${value.toFixed(2)}%`;
}
export function createStableWindow() {
  let samples = [];
  return {
    reset() {
      samples = [];
    },
    observe(score, timestamp) {
      percentage(score);
      const passed = similarityPassed(score);
      const prior = samples.at(-1);
      if (
        prior &&
        (timestamp <= prior.timestamp ||
          timestamp - prior.timestamp > LIVE_TIMING.maxObservationGapMs ||
          passed !== prior.passed)
      )
        samples = [];
      samples.push({ score, timestamp, passed });
      samples = samples.slice(-3);
      const duration = samples.at(-1).timestamp - samples[0].timestamp;
      return {
        count: samples.length,
        duration,
        outcome: samples.length === 3 && duration >= 600 ? (passed ? 'MATCH' : 'NO_MATCH') : null,
        score: passed ? Math.min(...samples.map((s) => s.score)) : score,
      };
    },
  };
}

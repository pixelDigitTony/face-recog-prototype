import { cosineSimilarity } from './cosineSimilarity';
import { percentage } from './matchPolicy';
import { LIVE_TIMING } from './liveTiming';

export const IDENTIFICATION_POLICY = 'identify-85-strict-v1';
export const MIN_MARGIN = 0.05;
export function classifyRanking(score, runnerUpSimilarity, aboveThresholdCount) {
  percentage(score);
  if (runnerUpSimilarity !== null) percentage(runnerUpSimilarity);
  if (score <= 0.85) return 'UNKNOWN';
  return aboveThresholdCount === 1 &&
    (runnerUpSimilarity === null || score - runnerUpSimilarity >= MIN_MARGIN)
    ? 'IDENTIFIED'
    : 'AMBIGUOUS';
}
export function rankEmbedding(embedding, entries) {
  if (!entries.length) return null;
  const ranked = entries
    .map((entry) => ({ entry, score: cosineSimilarity(embedding, entry.embedding) }))
    .sort((a, b) => b.score - a.score || a.entry.personId.localeCompare(b.entry.personId));
  const { entry, score } = ranked[0],
    runnerUpSimilarity = ranked[1]?.score ?? null;
  const aboveThresholdCount = ranked.filter((r) => r.score > 0.85).length;
  const classification = classifyRanking(score, runnerUpSimilarity, aboveThresholdCount);
  return {
    classification,
    similarity: score,
    runnerUpSimilarity,
    margin: runnerUpSimilarity === null ? null : score - runnerUpSimilarity,
    aboveThresholdCount,
    personId: classification === 'IDENTIFIED' ? entry.personId : null,
    templateId: classification === 'IDENTIFIED' ? entry.templateId : null,
    templateVersion: classification === 'IDENTIFIED' ? entry.templateVersion : null,
  };
}
export function createIdentificationWindow() {
  let samples = [],
    binding;
  return {
    reset() {
      samples = [];
      binding = null;
    },
    observe(result, timestamp, contextKey) {
      const key = JSON.stringify([
        contextKey,
        result.classification,
        result.personId,
        result.templateId,
        result.templateVersion,
      ]);
      const prior = samples.at(-1);
      if (prior && timestamp <= prior.timestamp) return null;
      if (
        key !== binding ||
        (prior && timestamp - prior.timestamp > LIVE_TIMING.maxObservationGapMs)
      )
        samples = [];
      binding = key;
      samples.push({ ...result, timestamp });
      samples = samples.slice(-3);
      const duration = timestamp - samples[0].timestamp;
      if (samples.length !== 3 || duration < 600) return null;
      const summary =
        result.classification === 'IDENTIFIED'
          ? samples.reduce((a, b) => (a.similarity <= b.similarity ? a : b))
          : samples.at(-1);
      return {
        ...summary,
        outcome: result.classification,
        samples: structuredClone(samples),
        stableSampleCount: 3,
        stableDurationMs: duration,
        scoreAggregation: result.classification === 'IDENTIFIED' ? 'minimum' : 'last',
      };
    },
  };
}

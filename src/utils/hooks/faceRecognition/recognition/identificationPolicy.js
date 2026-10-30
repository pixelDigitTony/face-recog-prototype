import { cosineSimilarity } from './cosineSimilarity';
import { percentage } from './matchPolicy';
import { LIVE_TIMING } from './liveTiming';

export const LEGACY_IDENTIFICATION_POLICY = 'identify-85-strict-v1';
export const PREVIOUS_IDENTIFICATION_POLICY = 'identify-85-inclusive-v2';
export const IDENTIFICATION_POLICY = 'identify-85-multisample-v3';
export const identificationOperator = (policy) => {
  if ([IDENTIFICATION_POLICY, PREVIOUS_IDENTIFICATION_POLICY].includes(policy)) return '>=';
  if (policy === LEGACY_IDENTIFICATION_POLICY) return '>';
  throw new Error('Unknown identification policy.');
};
export function identificationPassed(score, policy = IDENTIFICATION_POLICY) {
  if (!Number.isFinite(score)) throw new Error('Invalid cosine score.');
  percentage(score);
  return identificationOperator(policy) === '>=' ? score >= 0.85 : score > 0.85;
}
export const MIN_MARGIN = 0.05;
export function classifyRanking(
  score,
  runnerUpSimilarity,
  aboveThresholdCount,
  policy = IDENTIFICATION_POLICY,
) {
  const passed = identificationPassed(score, policy);
  if (runnerUpSimilarity !== null) percentage(runnerUpSimilarity);
  if (!passed) return 'UNKNOWN';
  return aboveThresholdCount === 1 &&
    (runnerUpSimilarity === null || score - runnerUpSimilarity >= MIN_MARGIN)
    ? 'IDENTIFIED'
    : 'AMBIGUOUS';
}
export function rankEmbedding(embedding, entries, threshold = 0.85) {
  return rankScores(
    entries.map((entry) => ({ entry, score: cosineSimilarity(embedding, entry.embedding) })),
    threshold,
  );
}
export function rankScores(input, threshold = 0.85) {
  if (!input.length) return null;
  const scored = [...input].sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.personId.localeCompare(b.entry.personId) ||
      a.entry.templateId.localeCompare(b.entry.templateId),
  );
  const winners = new Map();
  for (const result of scored)
    if (!winners.has(result.entry.personId)) winners.set(result.entry.personId, result);
  const ranked = [...winners.values()];
  const { entry, score } = ranked[0],
    runnerUpSimilarity = ranked[1]?.score ?? null;
  const aboveThresholdCount = ranked.filter((r) => r.score >= threshold).length;
  const classification =
    score < threshold
      ? 'UNKNOWN'
      : aboveThresholdCount === 1 &&
          (runnerUpSimilarity === null || score - runnerUpSimilarity >= MIN_MARGIN)
        ? 'IDENTIFIED'
        : 'AMBIGUOUS';
  return {
    classification,
    similarity: score,
    runnerUpSimilarity,
    margin: runnerUpSimilarity === null ? null : score - runnerUpSimilarity,
    aboveThresholdCount,
    closestCandidate: {
      personId: entry.personId,
      templateId: entry.templateId,
      templateVersion: entry.templateVersion,
      similarity: score,
    },
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
      const key = JSON.stringify([contextKey, result.classification, result.personId]);
      const prior = samples.at(-1);
      if (prior && timestamp <= prior.timestamp) return null;
      if (
        key !== binding ||
        (prior && timestamp - prior.timestamp > LIVE_TIMING.maxObservationGapMs)
      )
        samples = [];
      binding = key;
      // Presentation candidates must never enter persisted decision evidence.
      const { closestCandidate, ...evidence } = result;
      samples.push({ ...evidence, timestamp });
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

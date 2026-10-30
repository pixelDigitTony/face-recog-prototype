import {
  classifyRanking,
  IDENTIFICATION_POLICY,
  MIN_MARGIN,
} from '../recognition/identificationPolicy';
import { percentage, SCORE_MAPPING } from '../recognition/matchPolicy';

export function validateIdentificationEvent(event, scope) {
  const fail = () => {
    throw new Error('Invalid identification evidence.');
  };
  if (
    !event ||
    event.purpose !== 'identify' ||
    !['IDENTIFIED', 'UNKNOWN', 'AMBIGUOUS'].includes(event.outcome) ||
    event.environment !== scope.environment ||
    event.companyId !== scope.companyId ||
    (scope.storeId != null && event.storeId !== scope.storeId) ||
    event.decisionPolicyVersion !== IDENTIFICATION_POLICY ||
    event.scoreMappingVersion !== SCORE_MAPPING ||
    event.source !== 'live_camera' ||
    event.authoritative !== false ||
    event.livenessStatus !== 'not_checked' ||
    event.liveness !== null ||
    event.probeEmbedding !== null ||
    event.thumbnailDataUrl !== null ||
    event.thresholdSnapshot !== 0.85 ||
    event.comparisonOperator !== '>' ||
    event.minMargin !== MIN_MARGIN ||
    ![event.id, event.sessionId, event.encounterId, event.galleryVersion].every(
      (s) => typeof s === 'string' && s.length > 0,
    ) ||
    !Number.isInteger(event.trackId) ||
    event.trackId < 1 ||
    !Number.isInteger(event.eligibleCount) ||
    event.eligibleCount < 1 ||
    event.eligibleCount > 50 ||
    !Number.isInteger(event.faceCountAtDecision) ||
    event.faceCountAtDecision < 1 ||
    !Number.isFinite(Date.parse(event.startedAt)) ||
    !Number.isFinite(Date.parse(event.completedAt)) ||
    Date.parse(event.completedAt) < Date.parse(event.startedAt) ||
    !Number.isFinite(event.decisionTimestamp) ||
    !event.modelIdentity?.detector?.sha256 ||
    !event.modelIdentity?.recognizer?.sha256 ||
    !event.preprocessingVersion ||
    !event.qualityPolicyVersion ||
    event.samples?.length !== 3 ||
    event.stableSampleCount !== 3
  )
    fail();
  const identified = event.outcome === 'IDENTIFIED';
  if (
    identified
      ? !event.personId ||
        !event.templateId ||
        !Number.isInteger(event.templateVersion) ||
        event.templateVersion < 1 ||
        !event.personSnapshot?.displayName ||
        !event.personSnapshot?.employeeCode
      : [event.personId, event.templateId, event.templateVersion, event.personSnapshot].some(
          (v) => v !== null,
        )
  )
    fail();
  for (let i = 0; i < 3; i++) {
    const sample = event.samples[i],
      previous = event.samples[i - 1];
    if (
      !Number.isFinite(sample.similarity) ||
      !Number.isFinite(sample.timestamp) ||
      sample.timestamp > event.decisionTimestamp ||
      !Number.isInteger(sample.aboveThresholdCount) ||
      sample.aboveThresholdCount < 0 ||
      sample.aboveThresholdCount > event.eligibleCount ||
      (event.eligibleCount === 1
        ? sample.runnerUpSimilarity !== null
        : !Number.isFinite(sample.runnerUpSimilarity)) ||
      (sample.runnerUpSimilarity !== null && sample.runnerUpSimilarity > sample.similarity) ||
      sample.margin !==
        (sample.runnerUpSimilarity === null
          ? null
          : sample.similarity - sample.runnerUpSimilarity) ||
      sample.classification !== event.outcome ||
      classifyRanking(sample.similarity, sample.runnerUpSimilarity, sample.aboveThresholdCount) !==
        event.outcome ||
      (sample.similarity <= 0.85
        ? sample.aboveThresholdCount !== 0
        : sample.aboveThresholdCount < 1) ||
      (sample.runnerUpSimilarity > 0.85 && sample.aboveThresholdCount < 2) ||
      (sample.runnerUpSimilarity <= 0.85 &&
        sample.similarity > 0.85 &&
        sample.aboveThresholdCount !== 1) ||
      (previous &&
        (sample.timestamp <= previous.timestamp || sample.timestamp - previous.timestamp > 1500)) ||
      sample.personId !== event.personId ||
      sample.templateId !== event.templateId ||
      sample.templateVersion !== event.templateVersion
    )
      fail();
  }
  const duration = event.samples[2].timestamp - event.samples[0].timestamp;
  const summary = identified
    ? event.samples.reduce((a, b) => (a.similarity <= b.similarity ? a : b))
    : event.samples[2];
  if (
    duration < 600 ||
    event.stableDurationMs !== duration ||
    event.scoreAggregation !== (identified ? 'minimum' : 'last') ||
    event.recognitionAgeMs !== event.decisionTimestamp - event.samples[2].timestamp ||
    event.recognitionAgeMs < 0 ||
    event.recognitionAgeMs > 1500 ||
    event.similarity !== summary.similarity ||
    event.runnerUpSimilarity !== summary.runnerUpSimilarity ||
    event.margin !== summary.margin ||
    event.matchPercentage !== percentage(event.similarity)
  )
    fail();
}

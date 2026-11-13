import { LIVENESS_METER_POLICY } from './livenessMeterPolicy';
import { LIVE_MOVEMENT_POLICY } from './liveMovementPolicy';
import { validateLivenessMeter } from './validateLivenessMeter';
import { boxIoU } from '../recognition/faceTracker';
export const ENROLLMENT_POLICY = 'enrollment-configurable-liveness-v1';
export const MULTI_ENROLLMENT_POLICY = 'enrollment-per-face-liveness-v2';
export const CHALLENGE_POLICY = 'configurable-challenge-v1';
export const DEFAULT_LIVENESS = Object.freeze({
  version: 1,
  turnLeft: true,
  turnRight: true,
  blink: false,
});
export function validateLivenessSettings(config) {
  if (
    config?.version !== 1 ||
    ['turnLeft', 'turnRight', 'blink'].some((k) => typeof config[k] !== 'boolean')
  )
    throw new Error('Invalid enrollment liveness settings.');
  return config;
}
export const livenessDisabled = (config) => !config.turnLeft && !config.turnRight && !config.blink;
export const challengeReady = (live) =>
  live?.status === 'passed_basic' ||
  (live?.status === 'not_checked' && live.reason === 'disabled_in_settings');
export const livenessLabel = (live) =>
  live?.reason === 'disabled_in_settings'
    ? 'Not checked — disabled in Settings'
    : (live?.status ?? 'not_checked');

export function validateEnrollmentEvidence(attempt) {
  if (
    attempt.authoritative !== false ||
    attempt.source !== 'live_camera' ||
    attempt.purpose !== 'enroll' ||
    attempt.thresholdSnapshot !== 0.85 ||
    attempt.comparisonOperator !== '>' ||
    attempt.percentageThresholdSnapshot !== 85 ||
    attempt.matchPercentage !== null ||
    ![
      'ENROLLED',
      'NO_FACE',
      'MULTIPLE_FACES',
      'LOW_QUALITY',
      'INCONCLUSIVE',
      'LIVENESS_FAILED',
      'LIVENESS_EXPIRED',
    ].includes(attempt.outcome)
  )
    throw new Error('Invalid configurable enrollment policy.');
  if (attempt.outcome !== 'ENROLLED') return;
  const live = attempt.liveness;
  const meterPolicy = attempt.decisionPolicyVersion === LIVENESS_METER_POLICY.enrollmentPolicy;
  const multiple = meterPolicy || attempt.decisionPolicyVersion === MULTI_ENROLLMENT_POLICY;
  if (
    multiple &&
    (live?.method !== 'per_face_enrollment' ||
      !Number.isInteger(attempt.faceCountAtDecision) ||
      attempt.faceCountAtDecision < 1 ||
      attempt.targetFaceCountAtDecision !== 1 ||
      attempt.associationPolicy !== 'exclusive-iou-v1' ||
      attempt.sourceTrackId !== attempt.trackId ||
      !Number.isInteger(attempt.detectionId) ||
      attempt.detectionId < 0 ||
      !Number.isFinite(attempt.captureFrameTimestamp) ||
      !Number.isFinite(attempt.poseTimestamp) ||
      Math.abs(attempt.captureFrameTimestamp - attempt.poseTimestamp) > 1500 ||
      attempt.decisionTimestamp - attempt.captureFrameTimestamp > 1500 ||
      attempt.decisionTimestamp < attempt.captureFrameTimestamp ||
      (Number.isFinite(live.passedAt) && attempt.captureFrameTimestamp < live.passedAt) ||
      !(attempt.poseAssociationIoU >= 0.35 && attempt.poseAssociationIoU <= 1) ||
      attempt.associationAmbiguous !== false ||
      attempt.trackId < 1 ||
      attempt.poseTrackId !== attempt.trackId ||
      [attempt.targetBox, attempt.poseBox].some(
        (box) =>
          !Array.isArray(box) ||
          box.length !== 4 ||
          !box.every(Number.isFinite) ||
          box[2] <= 0 ||
          box[3] <= 0,
      ) ||
      Math.abs(boxIoU(attempt.targetBox, attempt.poseBox) - attempt.poseAssociationIoU) > 1e-9)
  )
    throw new Error('Per-face enrollment association evidence is incomplete.');
  const config = validateLivenessSettings(live?.configuration);
  const rateMet = attempt.livenessMeter?.policyVersion === LIVE_MOVEMENT_POLICY.version;
  if (
    live.policyVersion !== CHALLENGE_POLICY ||
    !live.sessionId ||
    live.sessionId !== attempt.sessionId ||
    live.trackId !== attempt.trackId ||
    !Number.isInteger(live.trackId) ||
    (!multiple && attempt.faceCountAtDecision !== 1) ||
    !Number.isFinite(attempt.decisionTimestamp) ||
    (!rateMet &&
      (!Number.isFinite(live.lastValidatedAt) ||
        attempt.decisionTimestamp < live.lastValidatedAt ||
        attempt.decisionTimestamp - live.lastValidatedAt > 1500)) ||
    live.validity !== 'continuous_session' ||
    live.expiresAt !== null ||
    !(attempt.captureConsistency > 0.85) ||
    attempt.captureConsistency > 1.00001
  )
    throw new Error('Enrollment liveness evidence is incomplete.');
  if (meterPolicy) {
    if (livenessDisabled(config))
      throw new Error('Enable at least one enrollment challenge in Settings');
    validateLivenessMeter(attempt.livenessMeter, {
      sessionId: attempt.sessionId,
      cameraSessionId: attempt.cameraSessionId,
      trackId: attempt.trackId,
      workerGeneration: attempt.workerGeneration,
      assetIdentity: live.assetIdentity,
      captureTimestamp: attempt.captureFrameTimestamp,
      poseTimestamp: attempt.poseTimestamp,
      decisionTimestamp: attempt.decisionTimestamp,
      exclusive: attempt.associationAmbiguous === false,
    });
  }
  if (livenessDisabled(config)) {
    if (
      attempt.livenessStatus !== 'not_checked' ||
      live.status !== 'not_checked' ||
      live.reason !== 'disabled_in_settings' ||
      live.steps?.length !== 0 ||
      live.passedAt != null
    )
      throw new Error('Disabled liveness must remain not checked.');
  } else if (!rateMet) {
    const directions = [
      config.turnLeft && 'left',
      config.turnRight && 'right',
      config.blink && 'blink',
    ].filter(Boolean);
    const expected = directions.flatMap((d) => (d === 'blink' ? [d] : [d, 'neutral'])).sort();
    if (
      attempt.livenessStatus !== 'passed_basic' ||
      live.status !== 'passed_basic' ||
      !live.challengeId ||
      !live.assetIdentity ||
      !Number.isFinite(live.passedAt) ||
      live.passedAt > live.lastValidatedAt ||
      JSON.stringify(live.steps?.map((s) => s.direction).sort()) !== JSON.stringify(expected) ||
      live.steps.some(
        (s, i) =>
          !Number.isFinite(s.completedAt) ||
          s.completedAt > live.passedAt ||
          (i > 0 && s.completedAt <= live.steps[i - 1].completedAt),
      )
    )
      throw new Error('Enabled liveness test evidence is incomplete.');
  }
}

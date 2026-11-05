import { LIVENESS_METER_POLICY as P, meterQualifies, meterScore } from './livenessMeterPolicy';

// This validates internal consistency, not camera authenticity.
export function validateLivenessMeter(proof, binding) {
  const invalid = () => {
    throw new Error('Invalid motion evidence.');
  };
  if (
    !proof ||
    typeof proof !== 'object' ||
    JSON.stringify(proof).length > 4096 ||
    Object.keys(proof).some(
      (k) =>
        ![
          'policyVersion',
          'cameraSessionId',
          'enrollmentSessionId',
          'trackId',
          'workerGeneration',
          'assetIdentity',
          'status',
          'acceptedScore',
          'progress',
          'partials',
          'threshold',
          'observationCount',
          'startedAt',
          'passedAt',
          'events',
          'capture',
        ].includes(k),
    )
  )
    invalid();
  if (
    !proof ||
    proof.policyVersion !== P.version ||
    proof.status !== 'passed_basic' ||
    proof.threshold !== P.threshold ||
    typeof proof.assetIdentity !== 'string' ||
    !proof.assetIdentity ||
    proof.assetIdentity.length > 128 ||
    typeof proof.cameraSessionId !== 'string' ||
    !proof.cameraSessionId ||
    proof.cameraSessionId.length > 128 ||
    typeof proof.enrollmentSessionId !== 'string' ||
    !proof.enrollmentSessionId ||
    proof.enrollmentSessionId.length > 128 ||
    !Number.isInteger(proof.trackId) ||
    proof.trackId < 1 ||
    !Number.isInteger(proof.workerGeneration) ||
    proof.workerGeneration < 0 ||
    !Number.isInteger(proof.observationCount) ||
    proof.observationCount < P.minimumObservations ||
    proof.observationCount > P.maxObservations ||
    !Number.isFinite(proof.startedAt) ||
    !Number.isFinite(proof.passedAt) ||
    proof.passedAt - proof.startedAt < P.minimumSpanMs ||
    proof.passedAt - proof.startedAt > P.collectionWindowMs ||
    !Array.isArray(proof.events) ||
    proof.events.length < 2 ||
    proof.events.length > 3
  )
    invalid();
  if (
    proof.capture &&
    (typeof proof.capture !== 'object' ||
      Object.keys(proof.capture).sort().join(',') !==
        'captureTimestamp,decisionTimestamp,exclusive,poseTimestamp' ||
      !Number.isFinite(proof.capture.captureTimestamp) ||
      !Number.isFinite(proof.capture.poseTimestamp) ||
      !Number.isFinite(proof.capture.decisionTimestamp) ||
      proof.capture.captureTimestamp < proof.passedAt ||
      proof.capture.decisionTimestamp < proof.capture.captureTimestamp ||
      proof.capture.decisionTimestamp - proof.capture.captureTimestamp > P.captureFreshnessMs ||
      Math.abs(proof.capture.captureTimestamp - proof.capture.poseTimestamp) >
        P.captureFreshnessMs ||
      proof.capture.decisionTimestamp < proof.capture.poseTimestamp ||
      proof.capture.decisionTimestamp - proof.capture.poseTimestamp > P.captureFreshnessMs ||
      proof.capture.exclusive !== true)
  )
    invalid();
  if (
    binding &&
    (!proof.capture ||
      proof.capture.captureTimestamp !== binding.captureTimestamp ||
      proof.capture.poseTimestamp !== binding.poseTimestamp ||
      proof.capture.decisionTimestamp !== binding.decisionTimestamp ||
      proof.enrollmentSessionId !== binding.sessionId ||
      proof.trackId !== binding.trackId ||
      proof.cameraSessionId !== binding.cameraSessionId ||
      proof.workerGeneration !== binding.workerGeneration ||
      proof.assetIdentity !== binding.assetIdentity ||
      !Number.isFinite(binding.captureTimestamp) ||
      !Number.isFinite(binding.poseTimestamp) ||
      !Number.isFinite(binding.decisionTimestamp) ||
      binding.captureTimestamp < proof.passedAt ||
      binding.decisionTimestamp < binding.captureTimestamp ||
      binding.decisionTimestamp - binding.captureTimestamp > P.captureFreshnessMs ||
      Math.abs(binding.captureTimestamp - binding.poseTimestamp) > P.captureFreshnessMs ||
      binding.exclusive !== true)
  )
    invalid();
  const families = ['blink', 'head', 'expression'],
    seen = new Set();
  if (
    !proof.progress ||
    !proof.partials ||
    Object.keys(proof.progress).length !== 3 ||
    families.some(
      (f) => !Number.isInteger(proof.progress[f]) || proof.progress[f] < 0 || proof.progress[f] > 3,
    ) ||
    !meterQualifies(proof.progress) ||
    !Number.isFinite(proof.acceptedScore) ||
    Math.abs(meterScore(proof.progress) - proof.acceptedScore) > 1e-9
  )
    invalid();
  for (const e of proof.events) {
    if (
      !e ||
      Object.keys(e).some(
        (k) =>
          ![
            'family',
            'openFirstAt',
            'baselineAt',
            'startedAt',
            'changedAt',
            'changedEndAt',
            'returnAt',
            'completedAt',
            'openBefore',
            'closedCount',
            'openAfter',
            'maxGapMs',
            'peak',
            'holdCount',
            'returnCount',
            'returnDelta',
            'channel',
            'baseline',
            'peakCoefficient',
            'peakMotionDelta',
          ].includes(k),
      ) ||
      !Number.isFinite(e.maxGapMs) ||
      e.maxGapMs < 0 ||
      e.maxGapMs > P.maximumGapMs ||
      !families.includes(e.family) ||
      seen.has(e.family) ||
      proof.progress[e.family] !== 3
    )
      invalid();
    seen.add(e.family);
    if (
      ![e.baselineAt, e.startedAt, e.changedAt, e.returnAt, e.completedAt].every(Number.isFinite) ||
      e.baselineAt < proof.startedAt ||
      e.baselineAt > e.startedAt ||
      e.startedAt > e.changedAt ||
      e.changedAt > e.returnAt ||
      e.returnAt > e.completedAt ||
      e.completedAt > proof.passedAt ||
      proof.passedAt - e.completedAt > P.collectionWindowMs
    )
      invalid();
    if (e.family === 'blink') {
      if (
        !Number.isFinite(e.openFirstAt) ||
        e.openFirstAt < proof.startedAt ||
        e.openFirstAt >= e.baselineAt ||
        !Number.isInteger(e.openBefore) ||
        !Number.isInteger(e.closedCount) ||
        e.closedCount < 1 ||
        !Number.isInteger(e.openAfter) ||
        e.openBefore < 2 ||
        e.openBefore > P.maxObservations ||
        e.closedCount > P.maxObservations ||
        e.openAfter < 2 ||
        e.openAfter > P.maxObservations ||
        e.returnAt - e.startedAt < P.blink.minimumMs ||
        e.returnAt - e.startedAt > P.blink.maximumMs
      )
        invalid();
    } else {
      if (
        !Number.isFinite(e.changedEndAt) ||
        e.startedAt - e.baselineAt < P.movement.baselineMs ||
        e.changedEndAt - e.changedAt < P.movement.holdMs ||
        e.returnAt < e.changedEndAt ||
        e.completedAt - e.returnAt < P.movement.holdMs ||
        e.completedAt - e.startedAt > P.movement.maximumMs ||
        !Number.isInteger(e.holdCount) ||
        e.holdCount < 2 ||
        e.holdCount > P.maxObservations ||
        !Number.isInteger(e.returnCount) ||
        e.returnCount < 2 ||
        e.returnCount > P.maxObservations ||
        !Number.isFinite(e.returnDelta) ||
        e.returnDelta < 0 ||
        e.returnDelta >
          (e.family === 'head' ? P.movement.headReturn : P.movement.expressionReturn) ||
        !Number.isFinite(e.peak)
      )
        invalid();
      if (e.family === 'head' && (e.peak < P.movement.headMin || e.peak > P.movement.headMax))
        invalid();
      if (
        e.family === 'expression' &&
        (!['jaw', 'smile'].includes(e.channel) ||
          !Number.isFinite(e.baseline) ||
          e.baseline < 0 ||
          e.baseline > 1 ||
          e.peak < P.movement.expressionDelta ||
          !Number.isFinite(e.peakCoefficient) ||
          Math.abs(e.peakCoefficient - e.baseline - e.peak) > 1e-9 ||
          e.peakCoefficient < P.movement.expressionPeak ||
          e.peakCoefficient > 1 ||
          !Number.isFinite(e.peakMotionDelta) ||
          e.peakMotionDelta < P.expressionLandmarkDelta)
      )
        invalid();
    }
  }
  for (const family of families) {
    const phase = proof.progress[family],
      partial = proof.partials[family];
    if ((phase === 3) !== seen.has(family)) invalid();
    if (phase > 0 && phase < 3) {
      if (
        !partial ||
        typeof partial !== 'object' ||
        Object.keys(partial).some(
          (k) =>
            ![
              'phase',
              'openCount',
              'openFirstAt',
              'baselineAt',
              'lastOpen',
              'changedAt',
              'returnAt',
              'base',
              'baselineReadyAt',
              'startedAt',
              'holdAt',
              'count',
              'peak',
              'peakCoefficient',
              'peakMotionDelta',
              'changedEndAt',
              'returnDelta',
              'maxGap',
              'lastAt',
              'departed',
            ].includes(k),
        ) ||
        !Number.isFinite(partial.maxGap) ||
        partial.maxGap < 0 ||
        partial.maxGap > P.maximumGapMs ||
        partial.phase !== phase ||
        !Number.isFinite(partial.baselineAt) ||
        partial.baselineAt < proof.startedAt ||
        partial.baselineAt > proof.passedAt
      )
        invalid();
      if (family === 'blink') {
        if (
          !Number.isFinite(partial.openFirstAt) ||
          partial.openFirstAt >= partial.baselineAt ||
          partial.openFirstAt < proof.startedAt ||
          !Number.isFinite(partial.lastOpen) ||
          partial.lastOpen < partial.baselineAt ||
          partial.lastOpen > proof.passedAt ||
          (phase === 2 &&
            (!Number.isFinite(partial.changedAt) ||
              partial.changedAt < partial.lastOpen ||
              partial.changedAt > proof.passedAt))
        )
          invalid();
      } else {
        if (
          !partial.base ||
          !Number.isFinite(partial.baselineReadyAt) ||
          partial.baselineReadyAt - partial.baselineAt < P.movement.baselineMs ||
          partial.baselineReadyAt > proof.passedAt ||
          (partial.startedAt != null &&
            (!Number.isFinite(partial.startedAt) ||
              partial.startedAt < partial.baselineReadyAt ||
              proof.passedAt - partial.startedAt > P.movement.maximumMs))
        )
          invalid();
        if (
          Object.keys(partial.base).some(
            (k) =>
              !(
                family === 'head' ? ['yaw', 'pitch'] : ['channel', 'coefficient', 'motion']
              ).includes(k),
          )
        )
          invalid();
        if (
          family === 'head' &&
          (!Number.isFinite(partial.base.yaw) || !Number.isFinite(partial.base.pitch))
        )
          invalid();
        if (
          family === 'expression' &&
          (!['jaw', 'smile'].includes(partial.base.channel) ||
            !Number.isFinite(partial.base.coefficient) ||
            !Number.isFinite(partial.base.motion))
        )
          invalid();
        if (
          phase === 2 &&
          (!Number.isFinite(partial.changedAt) ||
            !Number.isFinite(partial.changedEndAt) ||
            partial.changedAt < partial.startedAt ||
            partial.changedEndAt - partial.changedAt < P.movement.holdMs ||
            partial.changedEndAt > proof.passedAt ||
            !Number.isFinite(partial.peak) ||
            (family === 'head' &&
              (partial.peak < P.movement.headMin || partial.peak > P.movement.headMax)) ||
            (family === 'expression' &&
              (partial.peak < P.movement.expressionDelta ||
                !Number.isFinite(partial.peakCoefficient) ||
                partial.peakCoefficient < P.movement.expressionPeak ||
                !Number.isFinite(partial.peakMotionDelta) ||
                partial.peakMotionDelta < P.expressionLandmarkDelta)))
        )
          invalid();
      }
    } else if (partial != null) invalid();
  }
  if (Object.keys(proof.partials).some((key) => !families.includes(key))) invalid();
  return proof;
}

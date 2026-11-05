import { validateLivenessMeter } from '../liveness/validateLivenessMeter';
import { validateLivenessSettings, livenessDisabled } from '../liveness/livenessPolicy';

export const PHYSICAL_POLICY = 'physical-motion-evaluation-v1';
export const ATTACK_SUBTYPES = Object.freeze([
  'stationary_print',
  'moved_print',
  'tilted_print',
  'bent_print',
  'display_photo',
  'eye_mouth_cutout',
  'prerecorded_video',
  'camera_motion',
  'other_presentation',
]);
const assert = (condition) => {
  if (!condition) throw new Error('Invalid physical trial evidence.');
};
const str = (value, max = 100) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const finite = (value) => Number.isFinite(value) && value >= 0;
const hash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const exact = (obj, keys) =>
  obj &&
  typeof obj === 'object' &&
  !Array.isArray(obj) &&
  Object.keys(obj).every((key) => keys.includes(key));
export function validatePhysicalTrial(t, scope) {
  assert(
    exact(t, [
      'id',
      'companyId',
      'storeId',
      'policy',
      'label',
      'deviceLabel',
      'lighting',
      'appearance',
      'expectedGroupSize',
      'durationSeconds',
      'authorized',
      'camera',
      'modelIdentity',
      'assetIdentity',
      'livenessIdentity',
      'meterPolicyVersion',
      'activityPolicyVersion',
      'configuration',
      'cameraSessionId',
      'workerGeneration',
      'startedAt',
      'completedAt',
      'startTimestamp',
      'endTimestamp',
      'completion',
      'reason',
      'segments',
    ]),
  );
  assert(
    str(t.id) &&
      t.companyId === scope.companyId &&
      (t.storeId ?? null) === (scope.storeId ?? null) &&
      t.policy === PHYSICAL_POLICY,
  );
  assert(
    str(t.label) &&
      str(t.deviceLabel) &&
      str(t.appearance, 500) &&
      ['even', 'dim', 'backlit', 'uneven', 'other'].includes(t.lighting),
  );
  assert(
    Number.isInteger(t.expectedGroupSize) &&
      t.expectedGroupSize >= 1 &&
      t.expectedGroupSize <= 10 &&
      [15, 30, 60].includes(t.durationSeconds) &&
      t.authorized === true,
  );
  assert(
    str(t.cameraSessionId) &&
      hash(t.assetIdentity) &&
      Number.isInteger(t.workerGeneration) &&
      t.workerGeneration >= 0,
  );
  assert(
    exact(t.camera, ['width', 'height', 'frameRate', 'facingMode', 'deviceLabel', 'userAgent']) &&
      JSON.stringify(t.camera).length <= 1000,
  );
  for (const key of ['width', 'height', 'frameRate'])
    assert(t.camera[key] == null || (finite(t.camera[key]) && t.camera[key] <= 10000));
  for (const key of ['facingMode', 'deviceLabel', 'userAgent'])
    assert(
      t.camera[key] == null || (typeof t.camera[key] === 'string' && t.camera[key].length <= 300),
    );
  assert(
    exact(t.modelIdentity, [
      'detector',
      'recognizer',
      'preprocessingVersion',
      'qualityPolicyVersion',
      'runtimeVersion',
      'opencvVersion',
    ]) &&
      exact(t.modelIdentity.detector, ['sha256']) &&
      exact(t.modelIdentity.recognizer, ['sha256']) &&
      hash(t.modelIdentity.detector.sha256) &&
      hash(t.modelIdentity.recognizer.sha256) &&
      str(t.modelIdentity.preprocessingVersion, 128),
  );
  for (const key of ['qualityPolicyVersion', 'runtimeVersion', 'opencvVersion'])
    assert(t.modelIdentity[key] === null || str(t.modelIdentity[key], 128));
  assert(
    exact(t.livenessIdentity, ['version', 'method', 'sha256', 'assets']) &&
      t.livenessIdentity.sha256 === t.assetIdentity &&
      Array.isArray(t.livenessIdentity.assets) &&
      t.livenessIdentity.assets.length <= 20,
  );
  for (const key of ['version', 'method'])
    assert(t.livenessIdentity[key] === null || str(t.livenessIdentity[key], 128));
  const assetNames = new Set();
  for (const asset of t.livenessIdentity.assets) {
    assert(
      exact(asset, ['name', 'sha256']) &&
        str(asset.name, 128) &&
        hash(asset.sha256) &&
        !assetNames.has(asset.name),
    );
    assetNames.add(asset.name);
  }
  assert(
    t.meterPolicyVersion === 'motion-evidence-v1' && t.activityPolicyVersion === 'live-movement-v1',
  );
  assert(exact(t.configuration, ['version', 'turnLeft', 'turnRight', 'blink']));
  validateLivenessSettings(t.configuration);
  assert(!livenessDisabled(t.configuration));
  assert(
    Number.isFinite(Date.parse(t.startedAt)) &&
      Number.isFinite(Date.parse(t.completedAt)) &&
      Date.parse(t.completedAt) >= Date.parse(t.startedAt),
  );
  assert(
    finite(t.startTimestamp) &&
      finite(t.endTimestamp) &&
      t.endTimestamp >= t.startTimestamp &&
      t.endTimestamp - t.startTimestamp <= t.durationSeconds * 1000 + 1500,
  );
  assert(['timed', 'interrupted'].includes(t.completion));
  assert(
    t.completion === 'timed'
      ? t.reason === 'duration' && t.endTimestamp - t.startTimestamp >= t.durationSeconds * 1000
      : str(t.reason, 80),
  );
  assert(Array.isArray(t.segments) && t.segments.length <= 100);
  const ids = new Set();
  let scored = 0;
  for (const s of t.segments) {
    assert(
      exact(s, [
        'segmentId',
        'trackId',
        'firstSeenAt',
        'lastSeenAt',
        'endReason',
        'observationCount',
        'firstObservationAt',
        'lastObservationAt',
        'maxGapMs',
        'gapCount',
        'peakActivity',
        'meterPassedAt',
        'challengePassedAt',
        'combinedPassedAt',
        'meterProof',
        'challenge',
        'label',
        'truth',
        'attackSubtype',
      ]),
    );
    assert(
      str(s.segmentId) && !ids.has(s.segmentId) && Number.isInteger(s.trackId) && s.trackId >= 1,
    );
    ids.add(s.segmentId);
    assert(
      finite(s.firstSeenAt) &&
        finite(s.lastSeenAt) &&
        s.firstSeenAt >= t.startTimestamp &&
        s.lastSeenAt >= s.firstSeenAt &&
        s.lastSeenAt <= t.endTimestamp &&
        ['timed', 'lost', 'ambiguous', 'interrupted', 'limit', 'error'].includes(s.endReason),
    );
    assert(s.endReason !== 'timed' || t.completion === 'timed');
    assert(
      Number.isInteger(s.observationCount) &&
        s.observationCount >= 0 &&
        s.observationCount <= 10000 &&
        Number.isInteger(s.gapCount) &&
        s.gapCount >= 0 &&
        s.gapCount < Math.max(1, s.observationCount),
    );
    assert(
      finite(s.maxGapMs) && s.maxGapMs <= 61500 && finite(s.peakActivity) && s.peakActivity <= 100,
    );
    if (s.observationCount)
      assert(
        finite(s.firstObservationAt) &&
          finite(s.lastObservationAt) &&
          s.firstObservationAt >= s.firstSeenAt &&
          s.lastObservationAt >= s.firstObservationAt &&
          s.lastObservationAt <= s.lastSeenAt,
      );
    else
      assert(
        s.firstObservationAt === null &&
          s.lastObservationAt === null &&
          s.maxGapMs === 0 &&
          s.gapCount === 0 &&
          s.peakActivity === 0,
      );
    if (s.observationCount === 1)
      assert(s.firstObservationAt === s.lastObservationAt && s.maxGapMs === 0 && s.gapCount === 0);
    if (s.observationCount > 1) {
      const span = s.lastObservationAt - s.firstObservationAt;
      assert(
        span > 0 &&
          s.maxGapMs > 0 &&
          s.maxGapMs <= span &&
          s.maxGapMs * (s.observationCount - 1) >= span &&
          (s.gapCount === 0 ? s.maxGapMs <= 200 : s.maxGapMs > 200) &&
          s.gapCount * 200 < span,
      );
    }
    for (const time of [s.meterPassedAt, s.challengePassedAt, s.combinedPassedAt])
      assert(
        time === null ||
          (finite(time) &&
            s.observationCount > 0 &&
            time >= s.firstObservationAt &&
            time <= s.lastObservationAt),
      );
    if (s.meterProof) {
      validateLivenessMeter(s.meterProof);
      assert(
        s.meterProof.capture == null &&
          s.meterProof.cameraSessionId === t.cameraSessionId &&
          s.meterProof.enrollmentSessionId === s.segmentId &&
          s.meterProof.trackId === s.trackId &&
          s.meterProof.workerGeneration === t.workerGeneration &&
          s.meterProof.assetIdentity === t.assetIdentity &&
          s.meterProof.startedAt >= s.firstObservationAt &&
          s.meterProof.observationCount <= s.observationCount &&
          s.meterProof.passedAt === s.meterPassedAt,
      );
    } else assert(s.meterPassedAt === null);
    if (s.challenge) {
      const c = s.challenge;
      assert(
        exact(c, [
          'challengeId',
          'configuration',
          'startedAt',
          'passedAt',
          'neutralYaw',
          'steps',
        ]) &&
          str(c.challengeId) &&
          JSON.stringify(c.configuration) === JSON.stringify(t.configuration) &&
          finite(c.startedAt) &&
          finite(c.passedAt) &&
          c.startedAt >= s.firstObservationAt &&
          c.startedAt <= c.passedAt &&
          c.passedAt === s.challengePassedAt &&
          finite(Math.abs(c.neutralYaw)) &&
          Math.abs(c.neutralYaw) <= 10 &&
          Array.isArray(c.steps),
      );
      const dirs = [
        t.configuration.turnLeft && 'left',
        t.configuration.turnRight && 'right',
        t.configuration.blink && 'blink',
      ]
        .filter(Boolean)
        .flatMap((d) => (d === 'blink' ? [d] : [d, 'neutral']))
        .sort();
      assert(JSON.stringify(c.steps.map((step) => step.direction).sort()) === JSON.stringify(dirs));
      let last = c.startedAt;
      for (const step of c.steps) {
        assert(
          exact(step, ['direction', 'completedAt']) &&
            finite(step.completedAt) &&
            step.completedAt - last >= (step.direction === 'blink' ? 80 : 300) &&
            step.completedAt <= c.passedAt,
        );
        last = step.completedAt;
      }
      assert(last === c.passedAt);
      for (let i = 0; i < c.steps.length; i++)
        if (['left', 'right'].includes(c.steps[i].direction))
          assert(c.steps[i + 1]?.direction === 'neutral');
    } else assert(s.challengePassedAt === null);
    assert(
      s.combinedPassedAt ===
        (s.meterPassedAt !== null && s.challengePassedAt !== null
          ? Math.max(s.meterPassedAt, s.challengePassedAt)
          : null),
    );
    assert(
      ['unscored', 'genuine', 'attack'].includes(s.truth) &&
        typeof s.label === 'string' &&
        s.label.length <= 100,
    );
    if (s.truth !== 'unscored') {
      scored++;
      assert(str(s.label));
    }
    assert(
      s.truth === 'attack' ? ATTACK_SUBTYPES.includes(s.attackSubtype) : s.attackSubtype === null,
    );
  }
  assert(scored > 0);
  return t;
}
const bucket = () => ({ denominator: 0, meterPassed: 0, challengePassed: 0, combinedPassed: 0 });
export function summarizePhysicalTrials(trials, filters = {}) {
  const report = {
    genuine: bucket(),
    attack: bucket(),
    bySubtype: {},
    incomplete: 0,
    unscored: 0,
    unmeasured: 0,
    observedInterruptedPasses: 0,
  };
  for (const t of trials) {
    if (
      (filters.lighting && t.lighting !== filters.lighting) ||
      (filters.deviceLabel && t.deviceLabel !== filters.deviceLabel) ||
      (filters.expectedGroupSize && t.expectedGroupSize !== filters.expectedGroupSize)
    )
      continue;
    for (const s of t.segments) {
      if (s.truth === 'unscored') {
        report.unscored++;
        continue;
      }
      if (!s.observationCount) {
        report.unmeasured++;
        continue;
      }
      if (t.completion !== 'timed' || s.endReason !== 'timed') {
        report.incomplete++;
        if (s.combinedPassedAt !== null) report.observedInterruptedPasses++;
        continue;
      }
      const destinations = [report[s.truth]];
      if (s.truth === 'attack') destinations.push((report.bySubtype[s.attackSubtype] ??= bucket()));
      for (const b of destinations) {
        b.denominator++;
        if (s.meterPassedAt !== null) b.meterPassed++;
        if (s.challengePassedAt !== null) b.challengePassed++;
        if (s.combinedPassedAt !== null) b.combinedPassed++;
      }
    }
  }
  return report;
}

export function physicalSegmentMetrics(segment) {
  if (!segment.observationCount)
    return {
      observedSpanMs: null,
      meanIntervalMs: null,
      meanHz: null,
      maxGapMs: null,
      gapCount: 0,
      meterTimeMs: null,
      challengeTimeMs: null,
      combinedTimeMs: null,
    };
  const span = segment.lastObservationAt - segment.firstObservationAt;
  const intervals = segment.observationCount - 1;
  return {
    observedSpanMs: span,
    meanIntervalMs: intervals ? span / intervals : null,
    meanHz: intervals && span > 0 ? (intervals * 1000) / span : null,
    maxGapMs: segment.maxGapMs,
    gapCount: segment.gapCount,
    meterTimeMs:
      segment.meterPassedAt === null ? null : segment.meterPassedAt - segment.firstSeenAt,
    challengeTimeMs:
      segment.challengePassedAt === null ? null : segment.challengePassedAt - segment.firstSeenAt,
    combinedTimeMs:
      segment.combinedPassedAt === null ? null : segment.combinedPassedAt - segment.firstSeenAt,
  };
}

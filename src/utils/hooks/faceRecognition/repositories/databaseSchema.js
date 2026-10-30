import { defaultSettings, OUTCOMES } from '@/features/face-recognition/constants';
import { percentage, LIVE_POLICY } from '../recognition/matchPolicy';
import { LIVE_TIMING } from '../recognition/liveTiming';
import { validateIdentificationEvent } from './validateIdentificationEvent';

export function createDatabase(scope) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 3,
    databaseId: crypto.randomUUID(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    scope: { environment: scope.environment, companyId: scope.companyId },
    people: [],
    templates: [],
    attempts: [],
    identificationEvents: [],
    settings: { ...defaultSettings },
  };
}
export function fail(message, code = 'VALIDATION_ERROR') {
  throw Object.assign(new Error(message), { code });
}
export function validateEmbedding(value) {
  if (!Array.isArray(value) || value.length !== 128 || !value.every(Number.isFinite))
    fail('Expected a finite 128-value embedding.');
  const norm = Math.hypot(...value);
  if (Math.abs(norm - 1) > 0.005) fail('Embedding must be normalized.');
}
export function validateDatabase(db, scope, legacy = false) {
  if (!db || db.schemaVersion !== (legacy === true ? 1 : legacy === 2 ? 2 : 3))
    fail(
      'Unsupported database schema. Export the original data or reset this prototype.',
      'SCHEMA_ERROR',
    );
  if (db.scope?.companyId !== scope.companyId || db.scope?.environment !== scope.environment)
    fail('Database scope does not match this application.');
  if (typeof db.databaseId !== 'string' || !Number.isInteger(db.revision) || db.revision < 0)
    fail('Invalid database metadata.');
  for (const key of ['createdAt', 'updatedAt'])
    if (!Number.isFinite(Date.parse(db[key]))) fail('Invalid database timestamp.');
  const settings = db.settings;
  if (legacy !== true && settings?.matchThreshold !== 0.85)
    fail('Live matching requires strictly above 85%.');
  if (
    !settings ||
    !Number.isFinite(settings.matchThreshold) ||
    Math.abs(settings.matchThreshold) > 1 ||
    typeof settings.saveThumbnails !== 'boolean' ||
    settings.displayTimeZone !== 'Asia/Manila'
  )
    fail('Invalid settings.');
  for (const key of ['maxPeople', 'maxAttempts', 'maxEstimatedBytes'])
    if (settings[key] !== defaultSettings[key]) fail('Invalid storage capacity setting.');
  for (const key of [
    'people',
    'templates',
    'attempts',
    ...(db.schemaVersion === 3 ? ['identificationEvents'] : []),
  ]) {
    if (!Array.isArray(db[key])) fail(`Invalid ${key} collection.`);
    const ids = new Set();
    for (const record of db[key]) {
      if (
        !record ||
        typeof record.id !== 'string' ||
        !record.id ||
        ids.has(record.id) ||
        record.companyId !== scope.companyId
      )
        fail(`Invalid or duplicate ${key} record.`);
      ids.add(record.id);
      if (
        record.thumbnailDataUrl &&
        (!/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(record.thumbnailDataUrl) ||
          record.thumbnailDataUrl.length > 4096)
      )
        fail('Invalid or oversized thumbnail.');
    }
  }
  const people = new Map(db.people.map((p) => [p.id, p]));
  const codes = new Set();
  for (const person of db.people) {
    if (
      !person.displayName?.trim() ||
      !person.employeeCode?.trim() ||
      person.normalizedEmployeeCode !== person.employeeCode.trim().toLowerCase() ||
      codes.has(person.normalizedEmployeeCode)
    )
      fail('Invalid or duplicate employee code.');
    codes.add(person.normalizedEmployeeCode);
    if (
      person.activeTemplateId &&
      !db.templates.some((t) => t.id === person.activeTemplateId && t.personId === person.id)
    )
      fail('Person template link is invalid.');
  }
  const templatePeople = new Set();
  for (const template of db.templates) {
    if (
      !people.has(template.personId) ||
      templatePeople.has(template.personId) ||
      !Number.isInteger(template.version) ||
      template.version < 1 ||
      !template.modelIdentity?.recognizer?.sha256 ||
      !template.preprocessingVersion
    )
      fail('Invalid active template.');
    templatePeople.add(template.personId);
    validateEmbedding(template.embedding);
  }
  for (const attempt of db.attempts) {
    if (
      !people.has(attempt.personId) ||
      !OUTCOMES.includes(attempt.outcome) ||
      !['enroll', 'verify'].includes(attempt.purpose) ||
      ![
        'not_implemented',
        'not_checked',
        'checking',
        'passed_basic',
        'failed',
        'expired',
        'unavailable',
      ].includes(attempt.livenessStatus) ||
      !attempt.personSnapshot?.displayName ||
      !Number.isFinite(Date.parse(attempt.startedAt)) ||
      !Number.isFinite(Date.parse(attempt.completedAt))
    )
      fail('Invalid capture attempt.');
    if (attempt.probeEmbedding !== null) validateEmbedding(attempt.probeEmbedding);
    if (
      attempt.similarity !== null &&
      (!Number.isFinite(attempt.similarity) || Math.abs(attempt.similarity) > 1.00001)
    )
      fail('Invalid similarity.');
    if (!Number.isFinite(attempt.thresholdSnapshot) || Math.abs(attempt.thresholdSnapshot) > 1)
      fail('Invalid threshold snapshot.');
    if (attempt.decisionPolicyVersion === LIVE_POLICY) {
      if (['MATCH', 'ENROLLED'].includes(attempt.outcome)) {
        const live = attempt.liveness;
        if (
          attempt.source !== 'live_camera' ||
          attempt.faceCountAtDecision !== 1 ||
          attempt.livenessStatus !== 'passed_basic' ||
          !live?.challengeId ||
          live.steps?.length !== 4 ||
          !live.steps.every((s) => Number.isFinite(s.completedAt)) ||
          !Number.isFinite(live.passedAt) ||
          !Number.isFinite(attempt.decisionTimestamp) ||
          attempt.decisionTimestamp < live.passedAt
        )
          fail('Live match/enrollment evidence is incomplete.');
        if (live.policyVersion === 'head-turn-v2') {
          if (
            live.validity !== 'continuous_session' ||
            live.expiresAt !== null ||
            live.sessionId !== attempt.sessionId ||
            !live.sessionId ||
            live.trackId !== attempt.trackId ||
            !Number.isInteger(live.trackId) ||
            !Number.isFinite(live.lastValidatedAt) ||
            live.lastValidatedAt < live.passedAt ||
            live.lastValidatedAt > attempt.decisionTimestamp ||
            attempt.decisionTimestamp - live.lastValidatedAt > LIVE_TIMING.maxFrameAgeMs
          )
            fail('Continuous-session liveness evidence is incomplete.');
        } else if (
          !Number.isFinite(live.expiresAt) ||
          attempt.decisionTimestamp > live.expiresAt ||
          live.expiresAt - live.passedAt > 5000
        ) {
          fail('Legacy liveness evidence is expired.');
        }
      }
      if (
        attempt.authoritative !== false ||
        attempt.thresholdSnapshot !== 0.85 ||
        attempt.comparisonOperator !== '>' ||
        attempt.percentageThresholdSnapshot !== 85 ||
        attempt.matchPercentage !== percentage(attempt.similarity)
      )
        fail('Invalid live decision policy.');
      if (
        attempt.outcome === 'MATCH' &&
        (attempt.source !== 'live_camera' ||
          attempt.faceCountAtDecision !== 1 ||
          attempt.livenessStatus !== 'passed_basic' ||
          attempt.similarity <= 0.85 ||
          attempt.stableSampleCount !== 3 ||
          attempt.stableDurationMs < 600 ||
          attempt.scoreAggregation !== 'minimum')
      )
        fail('Live match evidence is incomplete.');
      if (
        attempt.source === 'test_image' &&
        (['MATCH', 'NO_MATCH', 'ENROLLED'].includes(attempt.outcome) ||
          attempt.livenessStatus !== 'not_checked')
      )
        fail('Images are diagnostic only.');
    }
  }
  for (const event of db.identificationEvents ?? []) {
    validateIdentificationEvent(event, scope);
    if (event.personId && !people.has(event.personId))
      fail('Identification person link is invalid.');
  }
  return db;
}

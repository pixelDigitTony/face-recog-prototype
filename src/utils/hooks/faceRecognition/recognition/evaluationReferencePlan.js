export const COMPARATIVE_POLICY = 'evaluation-curated-counts-v3';
export const CONDITIONS = Object.freeze({
  lighting: ['normal', 'low_light', 'backlit', 'uneven', 'other'],
  appearance: ['usual', 'makeup', 'no_makeup', 'glasses', 'no_glasses', 'other'],
  pose: ['frontal', 'slight_left', 'slight_right', 'other'],
});
const digest = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
const modelKey = (manifest) => [
  manifest?.detector?.sha256,
  manifest?.recognizer?.sha256,
  manifest?.preprocessingVersion,
];
const scopeKey = (scope) => [scope.environment, scope.companyId, scope.storeId ?? null];
const content = (entry) => [
  entry.personId,
  entry.templateId,
  entry.templateVersion,
  entry.embedding,
  entry.enrollmentSource,
  entry.enrollmentLiveness,
  modelKey(entry.modelIdentity),
  entry.preprocessingVersion,
];
const planContent = (plan) => [
  plan.policy,
  plan.protocolVersion,
  scopeKey(plan.scope),
  modelKey(plan.modelIdentity),
  plan.modes,
  plan.people.map((p) => [
    p.personId,
    p.samples.map((s) => [s.templateId, s.templateVersion, s.fingerprint]),
  ]),
];
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, max) =>
  typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= max;

export function validateReferencePlan(plan, scope) {
  if (
    !plan ||
    plan.policy !== COMPARATIVE_POLICY ||
    plan.protocolVersion !== 1 ||
    !text(plan.id, 100) ||
    !Number.isFinite(Date.parse(plan.createdAt)) ||
    !hex(plan.fingerprint) ||
    JSON.stringify(scopeKey(plan.scope ?? {})) !== JSON.stringify(scopeKey(scope)) ||
    modelKey(plan.modelIdentity).some((v) => !text(v, 200)) ||
    !Array.isArray(plan.people) ||
    !plan.people.length ||
    plan.people.length > 50 ||
    new Set(plan.people.map((p) => p.personId)).size !== plan.people.length
  )
    throw new Error('Invalid reference plan.');
  const ids = new Set();
  for (const person of plan.people) {
    if (
      !text(person.personId, 100) ||
      !Array.isArray(person.samples) ||
      !person.samples.length ||
      person.samples.length > 5
    )
      throw new Error('Invalid reference cohort.');
    for (const sample of person.samples) {
      if (
        !text(sample.templateId, 100) ||
        ids.has(sample.templateId) ||
        !Number.isInteger(sample.templateVersion) ||
        sample.templateVersion < 1 ||
        !hex(sample.fingerprint) ||
        !text(sample.label, 60)
      )
        throw new Error('Invalid reference sample.');
      ids.add(sample.templateId);
    }
  }
  const min = Math.min(...plan.people.map((p) => p.samples.length));
  const modes = [1, 3, 5].filter((n) => n <= min);
  if (JSON.stringify(plan.modes) !== JSON.stringify(modes))
    throw new Error('Invalid comparative sample counts.');
  return plan;
}

export async function createReferencePlan({ selections, gallery, database, manifest, scope }) {
  const people = [];
  for (const [personId, templateIds] of Object.entries(selections).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const person = database.people.find((p) => p.id === personId && p.acknowledgedAt);
    if (!person || !templateIds.length)
      throw new Error('Choose references for every cohort person.');
    const samples = [];
    for (const templateId of templateIds) {
      const entry = gallery.entries.find(
        (e) => e.personId === personId && e.templateId === templateId,
      );
      const sample = database.templates.find((t) => t.id === templateId);
      if (!entry || !sample) throw new Error('Reference is no longer eligible.');
      samples.push({
        templateId,
        templateVersion: entry.templateVersion,
        fingerprint: await digest(content(entry)),
        label: sample.label,
      });
    }
    people.push({ personId, displayName: person.displayName, samples });
  }
  const min = Math.min(...people.map((p) => p.samples.length));
  const plan = {
    id: crypto.randomUUID(),
    policy: COMPARATIVE_POLICY,
    protocolVersion: 1,
    createdAt: new Date().toISOString(),
    scope: structuredClone(scope),
    modelIdentity: structuredClone(manifest),
    people,
    modes: [1, 3, 5].filter((n) => n <= min),
  };
  plan.fingerprint = await digest(planContent(plan));
  return validateReferencePlan(plan, scope);
}

export async function resolveReferencePlan(plan, gallery, manifest, scope) {
  validateReferencePlan(plan, scope);
  if (
    (await digest(planContent(plan))) !== plan.fingerprint ||
    JSON.stringify(modelKey(plan.modelIdentity)) !== JSON.stringify(modelKey(manifest))
  )
    throw new Error('Reference plan or model changed. Create a new experiment.');
  const ordered = [];
  for (const person of plan.people)
    for (const sample of person.samples) {
      const entry = gallery.entries.find(
        (e) => e.personId === person.personId && e.templateId === sample.templateId,
      );
      if (!entry || (await digest(content(entry))) !== sample.fingerprint)
        throw new Error('Historical - reference unavailable/changed. Create a new experiment.');
      ordered.push(entry);
    }
  return Object.fromEntries(
    plan.modes.map((n) => [
      String(n),
      plan.people.flatMap((p) =>
        p.samples.slice(0, n).map((s) => ordered.find((e) => e.templateId === s.templateId)),
      ),
    ]),
  );
}

export function validateComparativeMetadata(trial) {
  if (
    trial.protocolVersion !== 1 ||
    !text(trial.captureSessionLabel, 100) ||
    trial.independentCaptureConfirmed !== true ||
    (trial.personId === null && trial.unknownParticipantConfirmed !== true) ||
    Object.entries(CONDITIONS).some(([key, values]) => !values.includes(trial[key])) ||
    trial.referencePlan?.modes?.length < 2 ||
    (trial.personId && !trial.referencePlan?.people.some((p) => p.personId === trial.personId))
  )
    throw new Error('Complete independent capture conditions and cohort ground truth.');
}

export function assertIndependentProbe(trial, database) {
  const provenance = [trial.sessionId, trial.captureSetId].filter(Boolean);
  const references = [
    ...database.templates,
    ...database.attempts.filter((a) => a.purpose === 'enroll'),
  ];
  if (
    references.some(
      (t) =>
        provenance.some((id) => [t.sessionId, t.captureSetId].includes(id)) ||
        trial.observations.some(
          (o) => JSON.stringify(o.embedding) === JSON.stringify(t.embedding ?? t.probeEmbedding),
        ),
    )
  )
    throw new Error('Enrollment capture reused. Capture a fresh independent test.');
}

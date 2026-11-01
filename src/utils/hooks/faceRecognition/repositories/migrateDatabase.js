import { DEFAULT_LIVENESS } from '../liveness/livenessPolicy';
import { validateDatabase } from './databaseSchema';
import { percentage } from '../recognition/matchPolicy';
export function migrateDatabase(original, scope) {
  if (![1, 2, 3, 4].includes(original.schemaVersion)) return validateDatabase(original, scope);
  validateDatabase(original, scope, original.schemaVersion === 1 ? true : original.schemaVersion);
  const db = structuredClone(original);
  db.schemaVersion = 5;
  db.settings.enrollmentLiveness = { ...DEFAULT_LIVENESS };
  db.identificationEvents ||= [];
  db.evaluationTrials ||= [];
  for (const person of db.people) {
    person.enrollmentRevision ??=
      db.templates.find((t) => t.id === person.activeTemplateId)?.version ?? 0;
    delete person.primaryTemplateId;
    delete person.activeTemplateId;
  }
  if (original.schemaVersion < 4)
    for (const template of db.templates) template.label = 'Original sample';
  db.revision++;
  db.updatedAt = new Date().toISOString();
  if (original.schemaVersion === 1) {
    db.settings.matchThreshold = 0.85;
    db.templates.forEach((t) => {
      t.enrollmentSource = 'legacy_unknown';
      t.enrollmentLiveness = 'not_implemented';
    });
    db.attempts.forEach((a) => {
      a.decisionPolicyVersion = 'legacy-cosine-v1';
      a.comparisonOperator = '>=';
      a.matchPercentage = percentage(a.similarity);
      a.source = 'legacy_unknown';
    });
  }
  return validateDatabase(db, scope);
}

import { validateDatabase } from './databaseSchema';
import { percentage } from '../recognition/matchPolicy';
export function migrateDatabase(original, scope) {
  if (original.schemaVersion !== 1) return validateDatabase(original, scope);
  validateDatabase(original, scope, true);
  const db = structuredClone(original);
  db.schemaVersion = 2;
  db.revision++;
  db.updatedAt = new Date().toISOString();
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
  return validateDatabase(db, scope);
}

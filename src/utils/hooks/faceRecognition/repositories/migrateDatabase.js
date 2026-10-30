import { validateDatabase } from './databaseSchema';
import { percentage } from '../recognition/matchPolicy';
export function migrateDatabase(original, scope) {
  if (![1, 2].includes(original.schemaVersion)) return validateDatabase(original, scope);
  validateDatabase(original, scope, original.schemaVersion === 1 ? true : 2);
  const db = structuredClone(original);
  db.schemaVersion = 3;
  db.identificationEvents = [];
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

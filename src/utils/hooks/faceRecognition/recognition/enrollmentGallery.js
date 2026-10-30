import { compatibleTemplate } from '../workflows/faceWorkflow';

export async function buildEnrollmentGallery(database, manifest, context) {
  const entries = [];
  let excludedCount = 0;
  for (const person of database.people) {
    const template = database.templates.find(
      (t) => t.id === person.activeTemplateId && t.personId === person.id,
    );
    if (!template) continue;
    const vector = template.embedding;
    if (
      !person.acknowledgedAt ||
      person.companyId !== context.companyId ||
      template.companyId !== context.companyId ||
      (context.storeId != null &&
        (person.storeId !== context.storeId || template.storeId !== context.storeId)) ||
      !['live_camera', 'legacy_unknown'].includes(template.enrollmentSource) ||
      !compatibleTemplate(template, manifest) ||
      !Array.isArray(vector) ||
      vector.length !== 128 ||
      !vector.every(Number.isFinite) ||
      Math.abs(Math.hypot(...vector) - 1) > 0.005
    ) {
      excludedCount++;
      continue;
    }
    entries.push({
      personId: person.id,
      personSnapshot: { displayName: person.displayName, employeeCode: person.employeeCode },
      templateId: template.id,
      templateVersion: template.version,
      embedding: [...vector],
      enrollmentSource: template.enrollmentSource,
      enrollmentLiveness: template.enrollmentLiveness,
      modelIdentity: template.modelIdentity,
      preprocessingVersion: template.preprocessingVersion,
    });
  }
  entries.sort((a, b) => a.personId.localeCompare(b.personId));
  const canonical = JSON.stringify([
    context.environment,
    context.companyId,
    context.storeId ?? null,
    manifest?.detector?.sha256 ?? null,
    manifest?.recognizer?.sha256 ?? null,
    manifest?.preprocessingVersion ?? null,
    entries,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return {
    entries,
    excludedCount,
    version: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

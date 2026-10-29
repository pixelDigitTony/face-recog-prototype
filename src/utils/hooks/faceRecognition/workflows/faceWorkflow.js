import { cosineSimilarity } from '../recognition/cosineSimilarity';

export function compatibleTemplate(template, manifest) {
  return Boolean(
    template &&
      manifest &&
      template.modelIdentity.recognizer.sha256 === manifest.recognizer.sha256 &&
      template.modelIdentity.detector.sha256 === manifest.detector.sha256 &&
      template.preprocessingVersion === manifest.preprocessingVersion &&
      template.embedding.length === manifest.embeddingDimension,
  );
}
export function createFaceWorkflow({ repository, engine, context }) {
  const pending = new Map();
  let busy = false;
  async function save(operation) {
    const attempt = operation.attempt;
    try {
      await repository.commit(operation);
      pending.delete(attempt.id);
      return { ...attempt, attemptId: attempt.id, persisted: true, authoritative: false };
    } catch (error) {
      pending.set(attempt.id, operation);
      return {
        ...attempt,
        attemptId: attempt.id,
        persisted: false,
        authoritative: false,
        error: error.message,
        errorCode: error.code,
      };
    }
  }
  async function run(purpose, { personId, capture, signal }) {
    if (busy) throw new Error('A capture is already processing.');
    busy = true;
    try {
      await repository.load();
      const db = repository.getSnapshot().database;
      const person = structuredClone(db?.people.find((p) => p.id === personId));
      if (!person?.acknowledgedAt)
        throw new Error('Select a person and acknowledge browser storage first.');
      const template = structuredClone(db.templates.find((t) => t.id === person.activeTemplateId));
      const settings = { ...db.settings },
        startedAt = new Date().toISOString();
      let extracted = {},
        outcome,
        capturedAt = null;
      if (purpose === 'verify' && !template) outcome = 'NOT_ENROLLED';
      else if (purpose === 'verify' && !compatibleTemplate(template, engine.manifest))
        outcome = 'MODEL_MISMATCH';
      else {
        let frame;
        try {
          frame = await capture();
          capturedAt = new Date().toISOString();
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          outcome = 'CAMERA_ERROR';
          extracted.reasonCode = error.message;
        }
        if (frame) {
          try {
            extracted = await engine.extract(frame, {
              saveThumbnails: settings.saveThumbnails,
              signal,
            });
            outcome = extracted.outcome;
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            outcome = error.code === 'MODEL_ERROR' ? 'MODEL_ERROR' : 'INFERENCE_ERROR';
            extracted.reasonCode = error.message;
          }
        }
      }
      if (signal?.aborted) throw new DOMException('Capture cancelled.', 'AbortError');
      let similarity = null;
      if (extracted.embedding) {
        if (purpose === 'enroll') outcome = 'ENROLLED';
        else {
          const start = performance.now();
          similarity = cosineSimilarity(extracted.embedding, template.embedding);
          outcome = similarity >= settings.matchThreshold ? 'MATCH' : 'NO_MATCH';
          extracted.timingsMs.comparison = performance.now() - start;
        }
      }
      const attempt = {
        id: crypto.randomUUID(),
        purpose,
        personId,
        companyId: context.companyId,
        storeId: context.storeId ?? null,
        personSnapshot: { employeeCode: person.employeeCode, displayName: person.displayName },
        templateId: template?.id ?? null,
        templateVersion: template?.version ?? null,
        startedAt,
        capturedAt,
        completedAt: new Date().toISOString(),
        outcome,
        reasonCode: extracted.reasonCode ?? null,
        similarity,
        thresholdSnapshot: settings.matchThreshold,
        modelIdentity: extracted.modelIdentity ?? engine.manifest ?? null,
        preprocessingVersion: extracted.preprocessingVersion ?? null,
        qualityPolicyVersion: extracted.qualityPolicyVersion ?? null,
        quality: extracted.quality ?? {},
        timingsMs: extracted.timingsMs ?? {},
        probeEmbedding: extracted.embedding ?? null,
        thumbnailDataUrl: extracted.thumbnailDataUrl ?? null,
        livenessStatus: 'not_implemented',
      };
      const operation = {
        type: 'saveAttempt',
        attempt,
        expectedTemplateId: person.activeTemplateId,
      };
      if (outcome === 'ENROLLED') {
        const newTemplate = {
          id: crypto.randomUUID(),
          personId,
          companyId: context.companyId,
          storeId: context.storeId ?? null,
          version: (template?.version ?? 0) + 1,
          embedding: extracted.embedding,
          modelIdentity: extracted.modelIdentity,
          preprocessingVersion: extracted.preprocessingVersion,
          qualityPolicyVersion: extracted.qualityPolicyVersion,
          quality: extracted.quality,
          thumbnailDataUrl: extracted.thumbnailDataUrl ?? null,
          createdAt: attempt.completedAt,
        };
        attempt.templateId = newTemplate.id;
        attempt.templateVersion = newTemplate.version;
        operation.type = 'saveEnrollment';
        operation.template = newTemplate;
      }
      return await save(operation);
    } finally {
      busy = false;
    }
  }
  return {
    enroll: (request) => run('enroll', request),
    verify: (request) => run('verify', request),
    retrySave: async (id) => {
      const operation = pending.get(id);
      if (!operation) throw new Error('This pending result is no longer available.');
      return save(operation);
    },
    discard: (id) => pending.delete(id),
    deletePersonData: ({ personId }) => repository.commit({ type: 'deletePerson', id: personId }),
  };
}

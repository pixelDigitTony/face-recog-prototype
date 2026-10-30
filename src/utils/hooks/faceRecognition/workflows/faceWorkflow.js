import { cosineSimilarity } from '../recognition/cosineSimilarity';
import { percentage, LIVE_POLICY, SCORE_MAPPING } from '../recognition/matchPolicy';

export function compatibleTemplate(template, manifest) {
  return Boolean(
    template &&
      manifest &&
      template.modelIdentity?.recognizer?.sha256 &&
      template.modelIdentity.recognizer.sha256 === manifest.recognizer?.sha256 &&
      template.modelIdentity?.detector?.sha256 &&
      template.modelIdentity.detector.sha256 === manifest.detector?.sha256 &&
      template.preprocessingVersion === manifest.preprocessingVersion &&
      template.embedding?.length === manifest.embeddingDimension,
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
  async function run(purpose, { personId, capture, signal, prepared }) {
    if (busy) throw new Error('A capture is already processing.');
    busy = true;
    try {
      await repository.load();
      const db = repository.getSnapshot().database;
      const person = structuredClone(db?.people.find((p) => p.id === personId));
      if (!person?.acknowledgedAt)
        throw new Error('Select a person and acknowledge browser storage first.');
      if (purpose === 'verify') await engine.initialize?.();
      const eligible = db.templates.filter(
        (t) => t.personId === personId && compatibleTemplate(t, engine.manifest),
      );
      const template = structuredClone(db.templates.find((t) => t.id === person.primaryTemplateId));
      const settings = { ...db.settings },
        startedAt = new Date().toISOString();
      let extracted = {},
        outcome,
        capturedAt = null;
      if (prepared) {
        extracted = prepared.extracted || {};
        capturedAt = new Date().toISOString();
        outcome = prepared.outcome;
        if (person.primaryTemplateId !== prepared.expectedTemplateId)
          throw new Error('Enrollment changed. Start again.');
      } else if (purpose === 'verify' && !template) outcome = 'NOT_ENROLLED';
      else if (purpose === 'verify' && !eligible.length) outcome = 'MODEL_MISMATCH';
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
          const ranked = eligible
            .map((t) => ({ t, score: cosineSimilarity(extracted.embedding, t.embedding) }))
            .sort((a, b) => b.score - a.score);
          similarity = ranked[0]?.score ?? null;
          if (ranked[0]) {
            extracted.winningTemplateId = ranked[0].t.id;
          }
          outcome = 'DIAGNOSTIC_ONLY';
          extracted.timingsMs.comparison = performance.now() - start;
        }
      }
      if (prepared) {
        outcome = prepared.outcome;
        similarity = prepared.similarity ?? similarity;
      } else if (extracted.embedding) outcome = 'DIAGNOSTIC_ONLY';
      const attempt = {
        id: crypto.randomUUID(),
        purpose,
        personId,
        companyId: context.companyId,
        storeId: context.storeId ?? null,
        personSnapshot: { employeeCode: person.employeeCode, displayName: person.displayName },
        templateId: extracted.winningTemplateId ?? template?.id ?? null,
        templateVersion:
          eligible.find((t) => t.id === extracted.winningTemplateId)?.version ??
          template?.version ??
          null,
        startedAt,
        capturedAt,
        completedAt: new Date().toISOString(),
        outcome,
        reasonCode: extracted.reasonCode ?? null,
        similarity,
        modelIdentity: extracted.modelIdentity ?? engine.manifest ?? null,
        preprocessingVersion: extracted.preprocessingVersion ?? null,
        qualityPolicyVersion: extracted.qualityPolicyVersion ?? null,
        quality: extracted.quality ?? {},
        timingsMs: extracted.timingsMs ?? {},
        probeEmbedding: extracted.embedding ?? null,
        thumbnailDataUrl: extracted.thumbnailDataUrl ?? null,
        livenessStatus: prepared?.liveness?.status ?? 'not_checked',
        ...prepared?.metadata,
        sessionId: prepared?.sessionId ?? crypto.randomUUID(),
        source: prepared ? 'live_camera' : 'test_image',
        authoritative: false,
        scoreMappingVersion: SCORE_MAPPING,
        decisionPolicyVersion: LIVE_POLICY,
        matchPercentage: percentage(similarity),
        percentageThresholdSnapshot: 85,
        comparisonOperator: '>',
        thresholdSnapshot: 0.85,
        liveness: prepared?.liveness ?? null,
      };
      const operation = {
        type: 'saveAttempt',
        attempt,
        expectedTemplateId: person.primaryTemplateId,
        expectedEnrollmentRevision:
          prepared?.expectedEnrollmentRevision ?? person.enrollmentRevision,
        replaceTemplateId: prepared?.replaceTemplateId ?? null,
      };
      if (outcome === 'ENROLLED' || (!prepared && purpose === 'enroll' && extracted.embedding)) {
        const newTemplate = {
          id: crypto.randomUUID(),
          personId,
          companyId: context.companyId,
          storeId: context.storeId ?? null,
          version: (person.enrollmentRevision ?? 0) + 1,
          label: prepared?.sampleLabel?.trim() || `Sample ${(person.enrollmentRevision ?? 0) + 1}`,
          embedding: extracted.embedding,
          modelIdentity: extracted.modelIdentity,
          preprocessingVersion: extracted.preprocessingVersion,
          qualityPolicyVersion: extracted.qualityPolicyVersion,
          quality: extracted.quality,
          thumbnailDataUrl: extracted.thumbnailDataUrl ?? null,
          createdAt: attempt.completedAt,
          enrollmentSource: prepared ? 'live_camera' : 'test_image',
          enrollmentLiveness: prepared?.liveness?.status ?? 'not_checked',
        };
        attempt.templateId = newTemplate.id;
        attempt.templateVersion = newTemplate.version;
        operation.type = 'saveEnrollment';
        operation.template = newTemplate;
      }
      operation.signal = signal;
      return await save(operation);
    } finally {
      busy = false;
    }
  }
  return {
    enroll: (request) => run('enroll', request),
    verify: (request) => run('verify', request),
    savePrepared: (purpose, request) => run(purpose, request),
    retrySave: async (id) => {
      const operation = pending.get(id);
      if (!operation) throw new Error('This pending result is no longer available.');
      return save({ ...operation, signal: undefined });
    },
    discard: (id) => pending.delete(id),
    deletePersonData: ({ personId }) => repository.commit({ type: 'deletePerson', id: personId }),
  };
}

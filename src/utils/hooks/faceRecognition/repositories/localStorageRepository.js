import {
  evaluateTrial,
  validateEvaluationTrial,
  compactEvaluationReport,
} from '../recognition/evaluation';
import { createDatabase, validateDatabase, fail } from './databaseSchema';
import { acquireWriterLock } from './writerLock';
import { migrateDatabase } from './migrateDatabase';
import { buildEnrollmentGallery } from '../recognition/enrollmentGallery';
import { IDENTIFICATION_POLICY } from '../recognition/identificationPolicy';

export function createLocalStorageRepository({
  context,
  storage,
  locks,
  events = globalThis.window,
}) {
  const key = `stk:face-prototype:v1:${encodeURIComponent(context.environment)}:${encodeURIComponent(context.companyId)}:db`;
  const listeners = new Set();
  let state = { database: null, mode: 'loading', error: null, raw: null, key, estimatedBytes: 0 };
  let writer;
  let queue = Promise.resolve();
  let initialization;
  const publish = (value) => {
    state = { ...state, ...value };
    listeners.forEach((fn) => fn());
  };
  function read() {
    const raw = storage.getItem(key);
    try {
      const original = raw === null ? null : JSON.parse(raw);
      const database =
        original === null ? createDatabase(context) : migrateDatabase(original, context);
      if (original && original.schemaVersion !== database.schemaVersion && writer?.writable) {
        persist(database);
        return;
      }
      publish({
        database,
        raw,
        mode: writer?.writable ? 'writable' : 'readonly',
        error: writer?.reason,
        estimatedBytes: (raw?.length || 0) * 2,
      });
    } catch (error) {
      publish({ database: null, raw, mode: 'recovery', error: error.message });
    }
  }
  function persist(db) {
    validateDatabase(db, context);
    const raw = JSON.stringify(db);
    if (
      db.people.length > db.settings.maxPeople ||
      db.evaluationTrials.length > 100 ||
      db.attempts.length + db.identificationEvents.length > db.settings.maxAttempts ||
      raw.length * 2 > db.settings.maxEstimatedBytes
    )
      fail(
        'Prototype storage limit reached. Export or delete records before saving.',
        'CAPACITY_ERROR',
      );
    storage.setItem(key, raw);
    publish({ database: db, raw, mode: 'writable', error: null, estimatedBytes: raw.length * 2 });
    return db;
  }
  function schedule(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }
  const api = {
    key,
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load: () =>
      (initialization ||= (async () => {
        try {
          storage ||= globalThis.localStorage;
          writer = await acquireWriterLock(`${key}:writer`, locks);
          read();
          if (state.mode === 'writable' && state.raw === null) persist(state.database);
        } catch (error) {
          publish({
            mode: 'unavailable',
            error: `Browser storage is unavailable: ${error.message}`,
          });
        }
        return state;
      })()),
    refresh: async () => {
      try {
        read();
      } catch (error) {
        publish({ mode: 'unavailable', error: error.message });
      }
      return state;
    },
    query: async (collection) => structuredClone(state.database?.[collection] ?? []),
    commit: (operation) =>
      schedule(async () => {
        await api.load();
        if (operation.signal?.aborted) throw new DOMException('Session cancelled.', 'AbortError');
        if (!writer?.writable || state.mode === 'recovery' || state.mode === 'unavailable')
          fail(state.error || 'Database is read-only.', 'READ_ONLY');
        const raw = storage.getItem(key);
        const db =
          raw === null ? createDatabase(context) : validateDatabase(JSON.parse(raw), context);
        const now = new Date().toISOString();
        if (operation.attempt) {
          if (
            ['MATCH', 'ENROLLED'].includes(operation.attempt.outcome) &&
            operation.attempt.decisionPolicyVersion !== 'live-85-strict-v1'
          )
            fail('New live results require current liveness and similarity policy.');
          const existing = db.attempts.find((a) => a.id === operation.attempt.id);
          if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(operation.attempt))
              fail('Attempt ID conflicts with a saved record.');
            return db;
          }
          const person = db.people.find((p) => p.id === operation.attempt.personId);
          if (
            !person ||
            (operation.expectedEnrollmentRevision !== undefined
              ? person.enrollmentRevision !== operation.expectedEnrollmentRevision
              : person.primaryTemplateId !== operation.expectedTemplateId)
          )
            fail('Enrollment changed. Discard this result and capture again.', 'STALE_CONTEXT');
        }
        switch (operation.type) {
          case 'saveIdentification': {
            const existing = db.identificationEvents.find((e) => e.id === operation.event.id);
            if (existing) {
              if (JSON.stringify(existing) !== JSON.stringify(operation.event))
                fail('Identification ID conflicts with a saved record.');
              return db;
            }
            if (operation.event.decisionPolicyVersion !== IDENTIFICATION_POLICY)
              fail('New identification results require the current scan policy.');
            const gallery = await buildEnrollmentGallery(db, operation.manifest, context);
            if (
              gallery.version !== operation.event.galleryVersion ||
              gallery.eligibleCount !== operation.event.eligibleCount ||
              gallery.entries.length !== operation.event.eligibleSampleCount
            )
              fail(
                'Enrollments changed. Discard this scan result and scan again.',
                'STALE_CONTEXT',
              );
            const winner = gallery.entries.find(
              (e) =>
                e.personId === operation.event.personId &&
                e.templateId === operation.event.templateId,
            );
            if (
              operation.event.outcome === 'IDENTIFIED' &&
              operation.event.samples.some(
                (s) =>
                  !gallery.entries.some(
                    (e) =>
                      e.personId === s.personId &&
                      e.templateId === s.templateId &&
                      e.templateVersion === s.templateVersion,
                  ),
              )
            )
              fail('Supporting sample changed.', 'STALE_CONTEXT');
            if (
              operation.event.outcome === 'IDENTIFIED' &&
              (!winner ||
                winner.templateId !== operation.event.templateId ||
                winner.templateVersion !== operation.event.templateVersion ||
                JSON.stringify(winner.personSnapshot) !==
                  JSON.stringify(operation.event.personSnapshot))
            )
              fail('Enrollment changed before identification could save.', 'STALE_CONTEXT');
            db.identificationEvents.push(operation.event);
            break;
          }
          case 'deleteIdentification':
            db.identificationEvents = db.identificationEvents.filter((e) => e.id !== operation.id);
            break;
          case 'clearIdentifications':
            db.identificationEvents = [];
            break;
          case 'savePerson': {
            const person = {
              ...operation.person,
              employeeCode: operation.person.employeeCode.trim(),
              displayName: operation.person.displayName.trim(),
              normalizedEmployeeCode: operation.person.employeeCode.trim().toLowerCase(),
              companyId: context.companyId,
              storeId: context.storeId ?? null,
              updatedAt: now,
            };
            const prior = db.people.find((p) => p.id === person.id);
            if (prior)
              Object.assign(prior, person, {
                primaryTemplateId: prior.primaryTemplateId,
                enrollmentRevision: prior.enrollmentRevision,
                createdAt: prior.createdAt,
              });
            else
              db.people.push({
                ...person,
                primaryTemplateId: null,
                enrollmentRevision: 0,
                createdAt: now,
              });
            break;
          }
          case 'saveEnrollment': {
            const person = db.people.find((p) => p.id === operation.attempt.personId);
            const samples = db.templates.filter((t) => t.personId === person.id);
            if (
              operation.replaceTemplateId &&
              !samples.some((t) => t.id === operation.replaceTemplateId)
            )
              fail('Sample changed.', 'STALE_CONTEXT');
            if (!operation.replaceTemplateId && samples.length >= 5)
              fail('Five sample limit reached. Replace or delete a sample.', 'CAPACITY_ERROR');
            if (operation.replaceTemplateId)
              db.templates = db.templates.filter((t) => t.id !== operation.replaceTemplateId);
            operation.template.label ||= `Sample ${person.enrollmentRevision + 1}`;
            operation.template.version = person.enrollmentRevision + 1;
            operation.attempt.templateVersion = operation.template.version;
            db.templates.push(operation.template);
            if (
              !person.primaryTemplateId ||
              person.primaryTemplateId === operation.replaceTemplateId
            )
              person.primaryTemplateId = operation.template.id;
            person.enrollmentRevision++;
            person.updatedAt = now;
            db.attempts.push(operation.attempt);
            break;
          }
          case 'deleteSample':
          case 'setPrimarySample':
          case 'renameSample': {
            const sample = db.templates.find(
              (t) => t.id === operation.templateId && t.personId === operation.personId,
            );
            const person = db.people.find((p) => p.id === operation.personId);
            if (
              !sample ||
              !person ||
              person.enrollmentRevision !== operation.expectedEnrollmentRevision
            )
              fail('Sample changed. Refresh and try again.', 'STALE_CONTEXT');
            if (operation.type === 'renameSample') sample.label = operation.label.trim();
            else {
              if (operation.type === 'deleteSample') {
                db.templates = db.templates.filter((t) => t.id !== sample.id);
                if (person.primaryTemplateId === sample.id)
                  person.primaryTemplateId =
                    db.templates
                      .filter((t) => t.personId === person.id)
                      .sort(
                        (a, b) =>
                          (a.createdAt || '').localeCompare(b.createdAt || '') ||
                          a.id.localeCompare(b.id),
                      )[0]?.id ?? null;
              } else person.primaryTemplateId = sample.id;
              person.enrollmentRevision++;
            }
            person.updatedAt = now;
            break;
          }
          case 'saveEvaluation': {
            const prior = db.evaluationTrials.find((t) => t.id === operation.trial.id);
            if (prior) {
              if (JSON.stringify(prior) !== JSON.stringify(operation.trial))
                fail('Evaluation ID conflicts.');
              return db;
            }
            const gallery = await buildEnrollmentGallery(db, operation.manifest, context);
            if (gallery.version !== operation.trial.galleryVersion)
              fail('Gallery changed. Capture again.', 'STALE_CONTEXT');
            validateEvaluationTrial(operation.trial, db, context);
            operation.trial.report = compactEvaluationReport(
              evaluateTrial(operation.trial, gallery, operation.manifest),
            );
            db.evaluationTrials.push(operation.trial);
            break;
          }
          case 'rerunEvaluations': {
            const gallery = await buildEnrollmentGallery(db, operation.manifest, context);
            for (const trial of db.evaluationTrials)
              trial.report = compactEvaluationReport(
                evaluateTrial(trial, gallery, operation.manifest),
              );
            break;
          }
          case 'deleteEvaluation':
            db.evaluationTrials = db.evaluationTrials.filter((t) => t.id !== operation.id);
            break;
          case 'clearEvaluations':
            db.evaluationTrials = [];
            break;
          case 'saveAttempt':
            db.attempts.push(operation.attempt);
            break;
          case 'deleteAttempt':
            db.attempts = db.attempts.filter((a) => a.id !== operation.id);
            break;
          case 'clearAttempts':
            db.attempts = [];
            break;
          case 'deletePerson':
            db.people = db.people.filter((p) => p.id !== operation.id);
            db.templates = db.templates.filter((t) => t.personId !== operation.id);
            db.evaluationTrials = db.evaluationTrials.filter((t) => t.personId !== operation.id);
            db.attempts = db.attempts.filter((a) => a.personId !== operation.id);
            db.identificationEvents = db.identificationEvents.filter(
              (e) => e.personId !== operation.id,
            );
            break;
          case 'settings':
            if (operation.settings.matchThreshold !== 0.85)
              fail('Live matching requires strictly above 85%.');
            db.settings = {
              ...db.settings,
              matchThreshold: operation.settings.matchThreshold,
              saveThumbnails: operation.settings.saveThumbnails,
            };
            break;
          default:
            fail('Unknown database operation.');
        }
        db.revision++;
        db.updatedAt = now;
        if (operation.signal?.aborted) throw new DOMException('Session cancelled.', 'AbortError');
        return persist(db);
      }),
    exportJson: async () =>
      state.database ? JSON.stringify(state.database, null, 2) : state.raw || '',
    reset: () =>
      schedule(async () => {
        await api.load();
        if (!writer?.writable) fail('Only the writer tab can reset the prototype.');
        // Replace only our own key; a denied write preserves the previous content.
        return persist(createDatabase(context));
      }),
    dispose: () => {
      writer?.release();
      if (writer) writer.writable = false;
      events?.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
  const onStorage = (event) => {
    if (event.key === key || event.key === null) api.refresh();
  };
  events?.addEventListener('storage', onStorage);
  return api;
}

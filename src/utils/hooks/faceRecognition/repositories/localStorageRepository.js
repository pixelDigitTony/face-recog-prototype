import { createDatabase, validateDatabase, fail } from './databaseSchema';
import { acquireWriterLock } from './writerLock';
import { migrateDatabase } from './migrateDatabase';

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
      if (original?.schemaVersion === 1 && writer?.writable) {
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
      db.attempts.length > db.settings.maxAttempts ||
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
          if (!person || person.activeTemplateId !== operation.expectedTemplateId)
            fail('Enrollment changed. Discard this result and capture again.', 'STALE_CONTEXT');
        }
        switch (operation.type) {
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
                activeTemplateId: prior.activeTemplateId,
                createdAt: prior.createdAt,
              });
            else db.people.push({ ...person, activeTemplateId: null, createdAt: now });
            break;
          }
          case 'saveEnrollment': {
            const person = db.people.find((p) => p.id === operation.attempt.personId);
            db.templates = db.templates.filter((t) => t.personId !== person.id);
            db.templates.push(operation.template);
            person.activeTemplateId = operation.template.id;
            person.updatedAt = now;
            db.attempts.push(operation.attempt);
            break;
          }
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
            db.attempts = db.attempts.filter((a) => a.personId !== operation.id);
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

import { describe, it, expect } from 'vitest';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { createDatabase } from '@/utils/hooks/faceRecognition/repositories/databaseSchema';

const context = { environment: 'test', companyId: 'stk-prototype', storeId: null };
function harness(options = {}) {
  const values = new Map([['unrelated-stk-key', 'preserve-me']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (options.quota) throw new DOMException('Full', 'QuotaExceededError');
      values.set(key, value);
    },
  };
  const locks = {
    request: async (_name, _options, callback) =>
      callback(options.observer ? null : { name: 'writer' }),
  };
  const repository = createLocalStorageRepository({ context, storage, locks, events: null });
  return { values, storage, repository, options };
}
function person(id = 'p1', code = ' E-001 ') {
  return {
    id,
    employeeCode: code,
    displayName: 'Ada Test',
    acknowledgedAt: new Date().toISOString(),
  };
}
function attempt(id = 'a1') {
  return {
    id,
    purpose: 'verify',
    personId: 'p1',
    companyId: context.companyId,
    personSnapshot: { displayName: 'Ada Test' },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    outcome: 'NO_FACE',
    similarity: null,
    thresholdSnapshot: 0.363,
    probeEmbedding: null,
    thumbnailDataUrl: null,
    livenessStatus: 'not_implemented',
  };
}

describe('localStorage repository', () => {
  it('persists an empty schema and normalizes unique employee codes', async () => {
    const h = harness();
    await h.repository.load();
    await h.repository.commit({ type: 'savePerson', person: person() });
    expect(h.repository.getSnapshot().database.people[0].normalizedEmployeeCode).toBe('e-001');
    await expect(
      h.repository.commit({ type: 'savePerson', person: person('p2', 'e-001') }),
    ).rejects.toThrow(/duplicate/i);
  });
  it('serializes simultaneous mutations without dropping people', async () => {
    const h = harness();
    await h.repository.load();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        h.repository.commit({ type: 'savePerson', person: person(`p${i}`, `E-${i}`) }),
      ),
    );
    expect(h.repository.getSnapshot().database.people).toHaveLength(8);
    expect(h.repository.getSnapshot().database.revision).toBe(8);
  });
  it('recovers only committed data after reload', async () => {
    const h = harness();
    await h.repository.load();
    await h.repository.commit({ type: 'savePerson', person: person() });
    const copy = createLocalStorageRepository({
      context,
      storage: h.storage,
      locks: { request: async (_n, _o, cb) => cb(null) },
      events: null,
    });
    await copy.load();
    expect(copy.getSnapshot().database.people).toHaveLength(1);
    expect(copy.getSnapshot().mode).toBe('readonly');
  });
  it('does not publish a failed quota write or erase existing data', async () => {
    const h = harness();
    await h.repository.load();
    await h.repository.commit({ type: 'savePerson', person: person() });
    const before = h.values.get(h.repository.key);
    h.options.quota = true;
    await expect(
      h.repository.commit({ type: 'saveAttempt', expectedTemplateId: null, attempt: attempt() }),
    ).rejects.toThrow('Full');
    expect(h.values.get(h.repository.key)).toBe(before);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
  });
  it('retries an identical attempt idempotently and rejects changed reuse', async () => {
    const h = harness();
    await h.repository.load();
    await h.repository.commit({ type: 'savePerson', person: person() });
    const operation = { type: 'saveAttempt', expectedTemplateId: null, attempt: attempt() };
    await h.repository.commit(operation);
    await h.repository.commit(operation);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(1);
    await expect(
      h.repository.commit({
        ...operation,
        attempt: { ...operation.attempt, outcome: 'LOW_QUALITY' },
      }),
    ).rejects.toThrow(/conflicts/);
  });
  it('rejects a stale enrollment snapshot', async () => {
    const h = harness();
    await h.repository.load();
    await h.repository.commit({ type: 'savePerson', person: person() });
    await expect(
      h.repository.commit({ type: 'saveAttempt', expectedTemplateId: 'wrong', attempt: attempt() }),
    ).rejects.toThrow(/changed/);
  });
  it('preserves corrupt data for export until explicit scoped reset', async () => {
    const h = harness();
    h.values.set(h.repository.key, '{broken');
    await h.repository.load();
    expect(h.repository.getSnapshot().mode).toBe('recovery');
    expect(await h.repository.exportJson()).toBe('{broken');
    await expect(h.repository.commit({ type: 'clearAttempts' })).rejects.toThrow();
    await h.repository.reset();
    expect(h.repository.getSnapshot().mode).toBe('writable');
    expect(h.values.get('unrelated-stk-key')).toBe('preserve-me');
  });
  it('treats future schemas and cross-company records as recovery errors', async () => {
    for (const change of [
      (db) => (db.schemaVersion = 42),
      (db) => (db.scope.companyId = 'other'),
    ]) {
      const h = harness();
      const db = createDatabase(context);
      change(db);
      h.values.set(h.repository.key, JSON.stringify(db));
      await h.repository.load();
      expect(h.repository.getSnapshot().mode).toBe('recovery');
    }
  });
  it('denies writes from an observer tab', async () => {
    const h = harness({ observer: true });
    await h.repository.load();
    await expect(h.repository.commit({ type: 'savePerson', person: person() })).rejects.toThrow(
      /Another tab/,
    );
  });
  it('enforces the person cap without eviction', async () => {
    const h = harness();
    await h.repository.load();
    for (let i = 0; i < 50; i++)
      await h.repository.commit({ type: 'savePerson', person: person(`p${i}`, `E${i}`) });
    await expect(
      h.repository.commit({ type: 'savePerson', person: person('extra', 'extra') }),
    ).rejects.toThrow(/limit/);
    expect(h.repository.getSnapshot().database.people).toHaveLength(50);
  });
  it('validates thresholds and leaves history snapshots unchanged', async () => {
    const h = harness();
    await h.repository.load();
    await h.repository.commit({ type: 'savePerson', person: person() });
    await h.repository.commit({
      type: 'saveAttempt',
      attempt: attempt(),
      expectedTemplateId: null,
    });
    await h.repository.commit({
      type: 'settings',
      settings: { matchThreshold: 0.85, saveThumbnails: false },
    });
    expect(h.repository.getSnapshot().database.attempts[0].thresholdSnapshot).toBe(0.363);
    await expect(
      h.repository.commit({
        type: 'settings',
        settings: { matchThreshold: NaN, saveThumbnails: true },
      }),
    ).rejects.toThrow();
  });
  it('cascades person deletion and preserves unrelated localStorage keys', async () => {
    const h = harness();
    await h.repository.load();
    await h.repository.commit({ type: 'savePerson', person: person() });
    await h.repository.commit({
      type: 'saveAttempt',
      attempt: attempt(),
      expectedTemplateId: null,
    });
    await h.repository.commit({ type: 'deletePerson', id: 'p1' });
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
    await h.repository.reset();
    expect(h.values.get('unrelated-stk-key')).toBe('preserve-me');
  });
});

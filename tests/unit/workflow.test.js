import { describe, it, expect, vi } from 'vitest';
import { createFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { normalizeEmbedding } from '@/utils/hooks/faceRecognition/recognition/cosineSimilarity';

async function setup() {
  const context = { environment: 'workflow-test', companyId: 'stk-prototype', storeId: null };
  let raw = null,
    denied = false;
  const storage = {
    getItem: () => raw,
    setItem(_key, value) {
      if (denied) throw new Error('Quota exceeded');
      raw = value;
    },
  };
  const repository = createLocalStorageRepository({
    context,
    storage,
    locks: { request: async (_n, _o, callback) => callback({}) },
    events: null,
  });
  await repository.load();
  await repository.commit({
    type: 'savePerson',
    person: {
      id: 'person',
      employeeCode: '001',
      displayName: 'Test Person',
      acknowledgedAt: new Date().toISOString(),
    },
  });
  const manifest = {
    detector: { sha256: 'detector' },
    recognizer: { sha256: 'recognizer' },
    embeddingDimension: 128,
    preprocessingVersion: 'v1',
  };
  const embedding = normalizeEmbedding(Array(128).fill(1));
  const engine = {
    manifest,
    extract: vi.fn(async () => ({
      embedding,
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
      qualityPolicyVersion: 'v1',
      quality: { faceCount: 1 },
      timingsMs: { total: 10 },
      thumbnailDataUrl: null,
    })),
  };
  return {
    workflow: createFaceWorkflow({ repository, engine, context }),
    repository,
    engine,
    setDenied: (value) => (denied = value),
    capture: async () => ({}),
    embedding,
  };
}
describe('face workflow', () => {
  it('atomically enrolls and verifies a single selected person', async () => {
    const h = await setup();
    const enrolled = await h.workflow.enroll({ personId: 'person', capture: h.capture });
    expect(enrolled.outcome).toBe('ENROLLED');
    expect(enrolled.authoritative).toBe(false);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(1);
    const match = await h.workflow.verify({ personId: 'person', capture: h.capture });
    expect(match.outcome).toBe('MATCH');
    expect(match.persisted).toBe(true);
  });
  it('keeps a previous enrollment intact after failed replacement and retries without inference', async () => {
    const h = await setup();
    await h.workflow.enroll({ personId: 'person', capture: h.capture });
    const old = h.repository.getSnapshot().database.templates[0];
    h.setDenied(true);
    const result = await h.workflow.enroll({ personId: 'person', capture: h.capture });
    expect(result.persisted).toBe(false);
    expect(h.repository.getSnapshot().database.templates[0]).toEqual(old);
    const calls = h.engine.extract.mock.calls.length;
    h.setDenied(false);
    const retry = await h.workflow.retrySave(result.attemptId);
    expect(retry.persisted).toBe(true);
    expect(retry.attemptId).toBe(result.attemptId);
    expect(h.engine.extract).toHaveBeenCalledTimes(calls);
    expect(h.repository.getSnapshot().database.templates[0].version).toBe(2);
  });
  it('saves non-match probe vectors and a frozen threshold', async () => {
    const h = await setup();
    await h.workflow.enroll({ personId: 'person', capture: h.capture });
    h.engine.extract.mockImplementationOnce(async () => ({
      embedding: h.embedding.map((n) => -n),
      modelIdentity: h.engine.manifest,
      preprocessingVersion: 'v1',
      quality: {},
      timingsMs: {},
    }));
    const result = await h.workflow.verify({ personId: 'person', capture: h.capture });
    expect(result.outcome).toBe('NO_MATCH');
    expect(result.probeEmbedding).toHaveLength(128);
    expect(result.thresholdSnapshot).toBe(0.363);
  });
  it('records camera errors and rejects incompatible templates without inference', async () => {
    const h = await setup();
    const result = await h.workflow.enroll({
      personId: 'person',
      capture: async () => {
        throw new Error('Camera disconnected');
      },
    });
    expect(result.outcome).toBe('CAMERA_ERROR');
    expect(result.capturedAt).toBeNull();
    await h.workflow.enroll({ personId: 'person', capture: h.capture });
    h.engine.manifest = { ...h.engine.manifest, preprocessingVersion: 'v2' };
    const calls = h.engine.extract.mock.calls.length;
    expect((await h.workflow.verify({ personId: 'person', capture: h.capture })).outcome).toBe(
      'MODEL_MISMATCH',
    );
    expect(h.engine.extract).toHaveBeenCalledTimes(calls);
  });
  it('aborts an extraction without writing a late capture', async () => {
    const h = await setup();
    const controller = new AbortController();
    h.engine.extract.mockImplementationOnce(async () => {
      controller.abort();
      return { embedding: h.embedding };
    });
    await expect(
      h.workflow.enroll({ personId: 'person', capture: h.capture, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(0);
  });
});

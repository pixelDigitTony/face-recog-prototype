import { describe, it, expect, vi } from 'vitest';
import {
  createDatabase,
  validateDatabase,
} from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { migrateDatabase } from '@/utils/hooks/faceRecognition/repositories/migrateDatabase';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { buildEnrollmentGallery } from '@/utils/hooks/faceRecognition/recognition/enrollmentGallery';
import {
  rankEmbedding,
  createIdentificationWindow,
} from '@/utils/hooks/faceRecognition/recognition/identificationPolicy';
import {
  EVALUATION_POLICY,
  evaluateTrial,
  evaluationSummary,
} from '@/utils/hooks/faceRecognition/recognition/evaluation';
import { createEvaluationWorkflow } from '@/utils/hooks/faceRecognition/workflows/evaluationWorkflow';

const context = { environment: 'test', companyId: 'company', storeId: null };
const manifest = {
  detector: { sha256: 'd' },
  recognizer: { sha256: 'r' },
  embeddingDimension: 128,
  preprocessingVersion: 'v1',
};
const vector = (n) => Array.from({ length: 128 }, (_, i) => (i === n ? 1 : 0));
function fixture() {
  const db = createDatabase(context);
  for (let i = 0; i < 2; i++) {
    db.people.push({
      id: `p${i}`,
      companyId: 'company',
      displayName: `Person ${i}`,
      employeeCode: `e${i}`,
      normalizedEmployeeCode: `e${i}`,
      acknowledgedAt: new Date().toISOString(),
      primaryTemplateId: `t${i}`,
      enrollmentRevision: 1,
    });
    db.templates.push({
      id: `t${i}`,
      personId: `p${i}`,
      companyId: 'company',
      version: 1,
      label: 'Everyday',
      createdAt: new Date().toISOString(),
      embedding: vector(i),
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
      enrollmentSource: 'live_camera',
      enrollmentLiveness: 'passed_basic',
    });
  }
  return db;
}
async function harness(db = fixture()) {
  let raw = JSON.stringify(db),
    quota = false;
  const repo = createLocalStorageRepository({
    context,
    storage: {
      getItem: () => raw,
      setItem: (_k, v) => {
        if (quota) throw new Error('quota');
        raw = v;
      },
    },
    locks: { request: (_n, _o, cb) => cb({}) },
    events: null,
  });
  await repo.load();
  return { repo, raw: () => raw, quota: (v) => (quota = v) };
}
function trial(gallery, personId = 'p0', probe = vector(0)) {
  return {
    id: crypto.randomUUID(),
    companyId: 'company',
    personId,
    participantLabel: personId || 'Visitor A',
    notes: 'daylight',
    createdAt: new Date().toISOString(),
    policy: EVALUATION_POLICY,
    source: 'live_camera',
    livenessStatus: 'not_checked',
    galleryVersion: gallery.version,
    modelIdentity: manifest,
    preprocessingVersion: 'v1',
    status: 'completed',
    reason: null,
    observations: [0, 400, 800].map((timestamp) => ({ timestamp, embedding: probe, quality: {} })),
  };
}
describe('multi-sample recognition and migration', () => {
  it('groups samples before counting identities and ranks another person as runner-up', async () => {
    const db = fixture();
    db.templates.push({ ...db.templates[0], id: 'makeup', label: 'With makeup', version: 2 });
    const g = await buildEnrollmentGallery(db, manifest, context),
      r = rankEmbedding(vector(0), g.entries);
    expect(g.eligibleCount).toBe(2);
    expect(g.entries).toHaveLength(3);
    expect(r).toMatchObject({
      classification: 'IDENTIFIED',
      personId: 'p0',
      aboveThresholdCount: 1,
      runnerUpSimilarity: 0,
    });
  });
  it('retains person stability while supporting samples change', () => {
    const w = createIdentificationWindow();
    const entries = [{ personId: 'p0', templateId: 'a', templateVersion: 1, embedding: vector(0) }];
    const a = rankEmbedding(vector(0), entries),
      b = { ...a, templateId: 'b', templateVersion: 2 };
    w.observe(a, 0, 'g');
    w.observe(b, 400, 'g');
    const d = w.observe(a, 800, 'g');
    expect(d.outcome).toBe('IDENTIFIED');
    expect(d.samples.map((s) => s.templateId)).toEqual(['a', 'b', 'a']);
  });
  it('migrates a schema-3 reference and leaves original bytes and historical IDs intact', () => {
    const db = fixture();
    db.schemaVersion = 3;
    delete db.evaluationTrials;
    db.people.forEach((p) => {
      p.activeTemplateId = p.primaryTemplateId;
      delete p.primaryTemplateId;
      delete p.enrollmentRevision;
    });
    const before = JSON.stringify(db),
      next = migrateDatabase(db, context);
    expect(JSON.stringify(db)).toBe(before);
    expect(next.schemaVersion).toBe(4);
    expect(next.people[0]).toMatchObject({ primaryTemplateId: 't0', enrollmentRevision: 1 });
    expect(next.templates[0].label).toBe('Original sample');
    expect(() => validateDatabase(next, context)).not.toThrow();
  });
  it('enforces five slots and preserves bytes on quota failure', async () => {
    const db = fixture();
    for (let i = 2; i <= 5; i++)
      db.templates.push({ ...db.templates[0], id: `extra${i}`, version: i });
    const h = await harness(db),
      before = h.raw();
    await expect(
      h.repo.commit({
        type: 'saveEnrollment',
        expectedEnrollmentRevision: 1,
        attempt: { id: 'a', personId: 'p0' },
        template: { ...db.templates[0], id: 'six' },
      }),
    ).rejects.toThrow(/limit/);
    expect(h.raw()).toBe(before);
    h.quota(true);
    await expect(
      h.repo.commit({
        type: 'deleteSample',
        personId: 'p0',
        templateId: 't0',
        expectedEnrollmentRevision: 1,
      }),
    ).rejects.toThrow('quota');
    expect(h.raw()).toBe(before);
    h.repo.dispose();
  });
  it('deletes individual samples, reassigns primary, rejects stale revisions and leaves person unenrolled', async () => {
    const db = fixture();
    db.templates.push({ ...db.templates[0], id: 'other', version: 2 });
    const h = await harness(db);
    await h.repo.commit({
      type: 'deleteSample',
      personId: 'p0',
      templateId: 't0',
      expectedEnrollmentRevision: 1,
    });
    expect(h.repo.getSnapshot().database.people[0].primaryTemplateId).toBe('other');
    await expect(
      h.repo.commit({
        type: 'deleteSample',
        personId: 'p0',
        templateId: 'other',
        expectedEnrollmentRevision: 1,
      }),
    ).rejects.toThrow(/changed/);
    await h.repo.commit({
      type: 'deleteSample',
      personId: 'p0',
      templateId: 'other',
      expectedEnrollmentRevision: 2,
    });
    expect(h.repo.getSnapshot().database.people[0]).toMatchObject({
      primaryTemplateId: null,
      enrollmentRevision: 3,
    });
    h.repo.dispose();
  });
  it('ranks 50 people with five samples each without extra embedding extraction', async () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({
      personId: `p${Math.floor(i / 5)}`,
      templateId: `t${i}`,
      templateVersion: i + 1,
      embedding: vector(Math.floor(i / 5)),
    }));
    const start = performance.now();
    for (let i = 0; i < 30; i++)
      expect(rankEmbedding(vector(i % 50), entries).personId).toBe(`p${i % 50}`);
    console.info(
      `250-reference ranking: ${((performance.now() - start) / 30).toFixed(2)} ms/probe (synthetic unit fixture)`,
    );
  });
});
describe('independent recognition evaluation', () => {
  it('measures improvement from another appearance without changing thresholds', async () => {
    const db = fixture();
    db.templates.push({ ...db.templates[0], id: 'alternate', embedding: vector(2), version: 2 });
    const g = await buildEnrollmentGallery(db, manifest, context),
      t = trial(g, 'p0', vector(2)),
      r = evaluateTrial(t, g, manifest);
    expect(r.modes.primary.find((x) => x.threshold === 0.85).category).toBe('missed');
    expect(r.modes.all.find((x) => x.threshold === 0.85).category).toBe('correct');
    expect(db.settings.matchThreshold).toBe(0.85);
  });
  it('separates wrong-person, unknown acceptance, missed and zero-denominator metrics', async () => {
    const g = await buildEnrollmentGallery(fixture(), manifest, context);
    const reports = [
      evaluateTrial(trial(g, 'p0', vector(1)), g, manifest),
      evaluateTrial(trial(g, null, vector(0)), g, manifest),
      evaluateTrial(trial(g, 'p0', vector(2)), g, manifest),
    ];
    expect(evaluationSummary(reports, 'all', 0.85)).toMatchObject({
      wrong_person: 1,
      unenrolled_accepted: 1,
      missed: 1,
      enrolled: 2,
      unenrolled: 1,
    });
    expect(evaluationSummary([], 'all', 0.85).enrolled).toBe(0);
  });
  it('excludes incompatible models and unequal paired populations', async () => {
    const db = fixture();
    db.templates[0].enrollmentSource = 'test_image';
    db.templates.push({ ...db.templates[0], id: 'eligible', enrollmentSource: 'live_camera' });
    const g = await buildEnrollmentGallery(db, manifest, context),
      t = trial(g);
    expect(evaluateTrial(t, g, manifest).modes.all[0].category).toBe('excluded');
    expect(evaluateTrial(t, g, { ...manifest, preprocessingVersion: 'v2' }).excluded).toMatch(
      /incompatible/,
    );
  });
  it('stores trials separately, rejects malformed probes, reruns against changed gallery, and deletes linked trials', async () => {
    const h = await harness(),
      g = await buildEnrollmentGallery(h.repo.getSnapshot().database, manifest, context),
      t = trial(g);
    await h.repo.commit({ type: 'saveEvaluation', trial: t, manifest });
    await h.repo.commit({ type: 'saveEvaluation', trial: t, manifest });
    expect(h.repo.getSnapshot().database.evaluationTrials).toHaveLength(1);
    expect(h.repo.getSnapshot().database.identificationEvents).toHaveLength(0);
    const bad = trial(g);
    bad.observations[0].embedding = [1];
    await expect(h.repo.commit({ type: 'saveEvaluation', trial: bad, manifest })).rejects.toThrow(
      /observations/,
    );
    await h.repo.commit({
      type: 'deleteSample',
      personId: 'p1',
      templateId: 't1',
      expectedEnrollmentRevision: 1,
    });
    await h.repo.commit({ type: 'rerunEvaluations', manifest });
    expect(h.repo.getSnapshot().database.evaluationTrials[0].report.galleryVersion).not.toBe(
      g.version,
    );
    await h.repo.commit({ type: 'deletePerson', id: 'p0' });
    expect(h.repo.getSnapshot().database.evaluationTrials).toHaveLength(0);
    h.repo.dispose();
  });
  it('captures fresh observations and records failures without enrollment or identity events', async () => {
    const h = await harness();
    let time = 0;
    const face = {
      box: [20, 20, 100, 120],
      landmarks: [],
      confidence: 0.99,
      quality: {},
      reasonCode: null,
    };
    const engine = {
      manifest,
      initialize: async () => manifest,
      analyzeFrame: vi.fn(async () => ({ faces: [face], embedding: vector(0) })),
    };
    const f = createEvaluationWorkflow({ repository: h.repo, engine, context, now: () => time });
    await f.start({ personId: 'p0' });
    for (const ms of [0, 400, 800]) {
      time = ms;
      await f.process({ width: 640, height: 480 }, ms);
    }
    expect(
      h.repo
        .getSnapshot()
        .database.evaluationTrials[0].report.modes.all.find((r) => r.threshold === 0.85).category,
    ).toBe('correct');
    await f.start({ personId: null, participantLabel: 'Visitor' });
    engine.analyzeFrame.mockResolvedValueOnce({ faces: [], embedding: null });
    time += 400;
    await f.process({ width: 640, height: 480 }, time);
    const db = h.repo.getSnapshot().database;
    expect(db.evaluationTrials[1]).toMatchObject({ status: 'capture_failed', observations: [] });
    expect(db.attempts).toHaveLength(0);
    expect(db.templates).toHaveLength(2);
    h.repo.dispose();
  });
});

describe('evaluation capacity and retry boundaries', () => {
  it('caps trials without eviction or partially writing the next one', async () => {
    const db = fixture(),
      g = await buildEnrollmentGallery(db, manifest, context);
    db.evaluationTrials = Array.from({ length: 100 }, () => trial(g));
    const h = await harness(db),
      before = h.raw();
    await expect(
      h.repo.commit({ type: 'saveEvaluation', trial: trial(g), manifest }),
    ).rejects.toThrow(/limit/);
    expect(h.raw()).toBe(before);
    h.repo.dispose();
  });
  it('retains an immutable trial through storage failure and retries without inference', async () => {
    const h = await harness();
    let time = 0;
    const engine = {
      manifest,
      initialize: async () => manifest,
      analyzeFrame: vi.fn(async () => ({
        faces: [{ box: [20, 20, 100, 120], quality: {}, confidence: 0.99 }],
        embedding: vector(0),
      })),
    };
    const f = createEvaluationWorkflow({ repository: h.repo, engine, context, now: () => time });
    await f.start({ personId: 'p0' });
    h.quota(true);
    for (const ms of [0, 400, 800]) {
      time = ms;
      await f.process({ width: 640, height: 480 }, ms);
    }
    expect(f.getSnapshot().status).toBe('save_failed');
    const id = f.getSnapshot().pending.trial.id;
    h.quota(false);
    await f.retry();
    expect(h.repo.getSnapshot().database.evaluationTrials[0].id).toBe(id);
    expect(engine.analyzeFrame).toHaveBeenCalledTimes(3);
    h.repo.dispose();
  });
  it('records a stalled camera as failure with no partial probe retention', async () => {
    const h = await harness();
    let time = 0;
    const f = createEvaluationWorkflow({
      repository: h.repo,
      engine: { manifest, initialize: async () => manifest },
      context,
      now: () => time,
    });
    await f.start({ personId: 'p0' });
    time = 5100;
    await f.stale();
    expect(h.repo.getSnapshot().database.evaluationTrials[0]).toMatchObject({
      status: 'capture_failed',
      observations: [],
    });
    h.repo.dispose();
  });
});

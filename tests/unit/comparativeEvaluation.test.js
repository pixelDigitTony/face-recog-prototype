import { describe, it, expect } from 'vitest';
import {
  createDatabase,
  validateDatabase,
} from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { buildEnrollmentGallery } from '@/utils/hooks/faceRecognition/recognition/enrollmentGallery';
import {
  createReferencePlan,
  resolveReferencePlan,
  validateReferencePlan,
  COMPARATIVE_POLICY,
  assertIndependentProbe,
} from '@/utils/hooks/faceRecognition/recognition/evaluationReferencePlan';
import {
  evaluateComparativeTrial,
  comparativeSummary,
  exportComparativeTrials,
  validateEvaluationTrial,
} from '@/utils/hooks/faceRecognition/recognition/evaluation';
import { createEvaluationWorkflow } from '@/utils/hooks/faceRecognition/workflows/evaluationWorkflow';
import { rankEmbedding } from '@/utils/hooks/faceRecognition/recognition/identificationPolicy';

const context = { environment: 'test', companyId: 'company', storeId: null };
const manifest = {
  embeddingDimension: 128,
  detector: { sha256: 'd' },
  recognizer: { sha256: 'r' },
  preprocessingVersion: 'v1',
};
const vector = (score, dimension = 1) =>
  Array.from({ length: 128 }, (_, i) =>
    i === 0 ? score : i === dimension ? Math.sqrt(1 - score * score) : 0,
  );
const probe = vector(1);
function fixture(count = 5) {
  const db = createDatabase(context);
  for (let p = 0; p < 2; p++) {
    db.people.push({
      id: `p${p}`,
      companyId: 'company',
      employeeCode: `e${p}`,
      normalizedEmployeeCode: `e${p}`,
      displayName: `Person ${p}`,
      acknowledgedAt: new Date().toISOString(),
      enrollmentRevision: count,
    });
    for (let n = 0; n < count; n++)
      db.templates.push({
        id: `p${p}s${n}`,
        personId: `p${p}`,
        companyId: 'company',
        version: n + 1,
        label: `Reference ${n}`,
        createdAt: new Date().toISOString(),
        embedding: vector(p ? 0.1 : n === 0 ? 0.8 : 0.92, p + 1),
        modelIdentity: manifest,
        preprocessingVersion: 'v1',
        enrollmentSource: 'live_camera',
        enrollmentLiveness: 'passed_basic',
      });
  }
  return db;
}
async function setup(db = fixture()) {
  const gallery = await buildEnrollmentGallery(db, manifest, context);
  const selections = Object.fromEntries(
    db.people.map((p) => [p.id, db.templates.filter((t) => t.personId === p.id).map((t) => t.id)]),
  );
  const plan = await createReferencePlan({
    selections,
    gallery,
    database: db,
    manifest,
    scope: context,
  });
  const subsets = await resolveReferencePlan(plan, gallery, manifest, context);
  return { db, gallery, selections, plan, subsets };
}
function trial(plan, personId = 'p0', embedding = probe) {
  return {
    id: crypto.randomUUID(),
    companyId: 'company',
    storeId: null,
    personId,
    participantLabel: personId ?? 'Visitor',
    notes: '',
    createdAt: new Date().toISOString(),
    policy: COMPARATIVE_POLICY,
    protocolVersion: 1,
    referencePlan: plan,
    modelIdentity: manifest,
    preprocessingVersion: 'v1',
    galleryVersion: 'gallery',
    source: 'live_camera',
    livenessStatus: 'not_checked',
    captureSessionLabel: 'Different day',
    lighting: 'normal',
    appearance: 'no_makeup',
    pose: 'frontal',
    independentCaptureConfirmed: true,
    unknownParticipantConfirmed: true,
    status: 'completed',
    reason: null,
    observations: [0, 400, 800].map((timestamp) => ({
      timestamp,
      embedding: [...embedding],
      quality: {},
    })),
  };
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
  return {
    repo,
    raw: () => raw,
    quota: (v) => (quota = v),
    replace: (value) => (raw = JSON.stringify(value)),
  };
}

describe('curated evaluation reference plans', () => {
  it('creates exact nested counts using a fixed cohort without changing enrollment data', async () => {
    const db = fixture(),
      before = JSON.stringify(db),
      { plan, subsets } = await setup(db);
    expect(plan.modes).toEqual([1, 3, 5]);
    expect(subsets['1']).toHaveLength(2);
    expect(subsets['3']).toHaveLength(6);
    expect(subsets['5']).toHaveLength(10);
    expect(subsets['1'].every((e) => subsets['3'].includes(e))).toBe(true);
    expect(JSON.stringify(db)).toBe(before);
  });
  it('uses equal counts with three-sample and incomplete cohorts', async () => {
    expect((await setup(fixture(3))).plan.modes).toEqual([1, 3]);
    expect((await setup(fixture(1))).plan.modes).toEqual([1]);
    const { db } = await setup();
    db.templates = db.templates.filter((t) => t.personId === 'p0' || t.version <= 3);
    expect((await setup(db)).plan.modes).toEqual([1, 3]);
  });
  it('keeps numerical fingerprint stable on metadata rename but changes it on reference order', async () => {
    const a = await setup(),
      b = await setup(a.db);
    expect(a.plan.id).not.toBe(b.plan.id);
    expect(a.plan.fingerprint).toBe(b.plan.fingerprint);
    a.db.people[0].displayName = 'Renamed';
    a.db.templates[0].label = 'Renamed';
    const g = await buildEnrollmentGallery(a.db, manifest, context);
    await expect(resolveReferencePlan(a.plan, g, manifest, context)).resolves.toBeTruthy();
    a.selections.p0.reverse();
    const c = await createReferencePlan({
      selections: a.selections,
      gallery: g,
      database: a.db,
      manifest,
      scope: context,
    });
    expect(c.fingerprint).not.toBe(a.plan.fingerprint);
  });
  it.each(['embedding', 'version', 'enrollmentSource', 'delete', 'acknowledgment'])(
    'invalidates changed selected %s',
    async (field) => {
      const { db, plan } = await setup();
      if (field === 'delete') db.templates.shift();
      else if (field === 'acknowledgment') db.people[0].acknowledgedAt = null;
      else
        db.templates[0][field] =
          field === 'embedding' ? vector(0.3) : field === 'version' ? 20 : 'diagnostic_image';
      const gallery = await buildEnrollmentGallery(db, manifest, context);
      await expect(resolveReferencePlan(plan, gallery, manifest, context)).rejects.toThrow();
    },
  );
  it('does not invalidate an unused addition and rejects changed scope/model/tampered plans', async () => {
    const { db, plan } = await setup(fixture(3));
    db.templates.push({ ...db.templates[0], id: 'unused', version: 4 });
    const gallery = await buildEnrollmentGallery(db, manifest, context);
    await expect(resolveReferencePlan(plan, gallery, manifest, context)).resolves.toBeTruthy();
    await expect(
      resolveReferencePlan(
        plan,
        gallery,
        { ...manifest, recognizer: { sha256: 'other' } },
        context,
      ),
    ).rejects.toThrow();
    expect(() => validateReferencePlan(plan, { ...context, companyId: 'other' })).toThrow();
    const tampered = structuredClone(plan);
    tampered.people[0].samples.reverse();
    await expect(resolveReferencePlan(tampered, gallery, manifest, context)).rejects.toThrow();
  });
  it('rejects duplicated samples, missing people and fabricated mode counts', async () => {
    const { plan, gallery, db, selections } = await setup();
    for (const change of [
      (p) => (p.modes = [1, 5]),
      (p) => (p.people[0].samples[1] = p.people[0].samples[0]),
      (p) => (p.people = []),
    ]) {
      const p = structuredClone(plan);
      change(p);
      expect(() => validateReferencePlan(p, context)).toThrow();
    }
    await expect(
      createReferencePlan({
        selections: { ...selections, missing: ['x'] },
        gallery,
        database: db,
        manifest,
        scope: context,
      }),
    ).rejects.toThrow();
  });
});

describe('paired recognition evidence and storage', () => {
  it('uses the same observations, corrects misses and preserves separate unknown outcomes', async () => {
    const { plan, subsets, db } = await setup();
    const t = trial(plan);
    t.report = evaluateComparativeTrial(t, subsets);
    expect(t.report.modes['1'][0].category).toBe('missed');
    expect(t.report.modes['3'][0].category).toBe('correct');
    validateEvaluationTrial(t, db, context);
    const unknown = trial(plan, null, vector(-1));
    unknown.report = evaluateComparativeTrial(unknown, subsets);
    const summary = comparativeSummary([t, unknown], [1, 3, 5]);
    expect(summary.totals[3].enrolled).toBe(1);
    expect(summary.totals[3].unenrolled_rejected).toBe(1);
    expect(summary.transitions[0].correctedMisses).toBe(1);
    const exported = JSON.stringify(exportComparativeTrials([t, unknown]));
    expect(exported).not.toContain('"embedding"');
    expect(exported).not.toContain('"observations"');
  });
  it('a competitor can turn a better genuine score into ambiguity', async () => {
    const db = fixture();
    db.templates.find((t) => t.id === 'p0s0').embedding = vector(0.88);
    db.templates.find((t) => t.id === 'p1s1').embedding = vector(0.87, 2);
    const { plan, subsets } = await setup(db),
      t = trial(plan),
      r = evaluateComparativeTrial(t, subsets);
    expect(r.modes['1'][0].category).toBe('correct');
    expect(r.modes['3'][0].category).toBe('missed');
    expect(r.modes['3'][0].scores[0].expected).toBeGreaterThan(r.modes['1'][0].scores[0].expected);
    expect(rankEmbedding(probe, subsets['3']).classification).toBe('AMBIGUOUS');
  });
  it('counts wrong identities and unknown acceptances without also counting them as misses', async () => {
    const db = fixture();
    for (const t of db.templates)
      t.embedding = vector(
        t.personId === 'p1' && t.version > 1 ? 0.95 : 0.2,
        t.personId === 'p1' ? 2 : 1,
      );
    const { plan, subsets } = await setup(db),
      positive = trial(plan),
      negative = trial(plan, null);
    positive.report = evaluateComparativeTrial(positive, subsets);
    negative.report = evaluateComparativeTrial(negative, subsets);
    const s = comparativeSummary([positive, negative], [1, 3, 5]);
    expect(s.totals[3].wrong_person).toBe(1);
    expect(s.totals[3].missed).toBe(0);
    expect(s.transitions[0].newlyAcceptedUnknown).toBe(1);
  });
  it('validates exact 85%, near ties and unstable winners under the unchanged policy', async () => {
    const db = fixture();
    for (const t of db.templates)
      t.embedding = vector(t.personId === 'p0' ? 0.85 : 0.1, t.personId === 'p1' ? 2 : 1);
    const { plan, subsets } = await setup(db);
    expect(evaluateComparativeTrial(trial(plan), subsets).modes['1'][0].category).toBe('correct');
    const unstable = trial(plan);
    unstable.observations[1].embedding = vector(-1);
    expect(evaluateComparativeTrial(unstable, subsets).modes['1'][0].category).toBe('missed');
  });
  it('rejects bad conditions, ground truth, timing, scores and altered outcomes', async () => {
    const { plan, subsets, db } = await setup();
    for (const mutate of [
      (t) => (t.independentCaptureConfirmed = false),
      (t) => (t.lighting = 'unknown'),
      (t) => (t.captureSessionLabel = ''),
      (t) => (t.personId = 'outside'),
      (t) => (t.observations[2].timestamp = 300),
    ]) {
      const t = trial(plan);
      mutate(t);
      expect(() => validateEvaluationTrial(t, db, context)).toThrow();
    }
    const t = trial(plan);
    t.report = evaluateComparativeTrial(t, subsets);
    t.report.modes['3'][0].category = 'missed';
    expect(() => validateEvaluationTrial(t, db, context)).toThrow();
    t.report = evaluateComparativeTrial(t, subsets);
    t.report.modes['3'][0].scores[0].similarity = NaN;
    expect(() => validateEvaluationTrial(t, db, context)).toThrow();
    const unknown = trial(plan, null);
    unknown.unknownParticipantConfirmed = false;
    expect(() => validateEvaluationTrial(unknown, db, context)).toThrow();
  });
  it('rejects reused enrollment embeddings and capture provenance', async () => {
    const { plan, db } = await setup();
    const t = trial(plan);
    t.observations[0].embedding = db.templates[0].embedding;
    expect(() => assertIndependentProbe(t, db)).toThrow('reused');
    t.observations = [];
    t.sessionId = 'same';
    db.attempts = [{ purpose: 'enroll', sessionId: 'same' }];
    expect(() => assertIndependentProbe(t, db)).toThrow('reused');
  });
  it('saves schema 5 atomically, retries idempotently and retains reports after reference deletion', async () => {
    const { db, plan } = await setup(),
      h = await harness(db),
      t = trial(plan),
      operation = { type: 'saveEvaluation', trial: t, manifest };
    h.quota(true);
    const before = h.raw();
    await expect(h.repo.commit(operation)).rejects.toThrow('quota');
    expect(h.raw()).toBe(before);
    h.quota(false);
    await h.repo.commit(operation);
    await h.repo.commit(operation);
    expect(h.repo.getSnapshot().database.evaluationTrials).toHaveLength(1);
    const bad = structuredClone(operation);
    bad.trial.notes = 'changed';
    await expect(h.repo.commit(bad)).rejects.toThrow('conflicts');
    await h.repo.commit({
      type: 'deleteSample',
      personId: 'p0',
      templateId: 'p0s0',
      expectedEnrollmentRevision: 5,
    });
    const saved = h.repo.getSnapshot().database;
    expect(saved.schemaVersion).toBe(5);
    expect(saved.evaluationTrials[0].report).toEqual(t.report);
    validateDatabase(saved, context);
    await h.repo.commit({ type: 'rerunEvaluations', manifest });
    expect(h.repo.getSnapshot().database.evaluationTrials[0].report).toEqual(t.report);
  });
  it('rejects changed references and capacity without partially saving', async () => {
    const { db, plan } = await setup(),
      h = await harness(db);
    await h.repo.commit({
      type: 'deleteSample',
      personId: 'p0',
      templateId: 'p0s0',
      expectedEnrollmentRevision: 5,
    });
    const before = h.raw();
    await expect(
      h.repo.commit({ type: 'saveEvaluation', trial: trial(plan), manifest }),
    ).rejects.toThrow('reference');
    expect(h.raw()).toBe(before);
    const full = fixture();
    const s = await setup(full);
    const t = trial(s.plan);
    t.report = evaluateComparativeTrial(t, s.subsets);
    full.evaluationTrials = Array.from({ length: 100 }, () => ({
      ...structuredClone(t),
      id: crypto.randomUUID(),
    }));
    const cap = await harness(full);
    await expect(
      cap.repo.commit({ type: 'saveEvaluation', trial: trial(s.plan), manifest }),
    ).rejects.toThrow('limit');
    expect(JSON.parse(cap.raw()).evaluationTrials).toHaveLength(100);
  });
  it('captures once per observation and saves a complete independent paired workflow', async () => {
    const { db, plan } = await setup(),
      h = await harness(db);
    let clock = 0,
      calls = 0;
    const engine = {
      manifest,
      initialize: async () => {},
      analyzeFrame: async () => {
        calls++;
        return {
          faces: [{ box: [10, 10, 100, 100], confidence: 0.99 }],
          embedding: probe,
          quality: {},
        };
      },
    };
    const flow = createEvaluationWorkflow({
      repository: h.repo,
      engine,
      context,
      now: () => clock,
    });
    await flow.start({ ...trial(plan), referencePlan: plan });
    for (const n of [0, 400, 800]) {
      clock = n;
      await flow.process({ width: 640, height: 480 }, n);
    }
    expect(calls).toBe(3);
    expect(flow.getSnapshot().status).toBe('completed');
    expect(h.repo.getSnapshot().database.evaluationTrials[0].report.modes['3'][0].category).toBe(
      'correct',
    );
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  rankEmbedding,
  createIdentificationWindow,
  classifyRanking,
  LEGACY_IDENTIFICATION_POLICY,
  IDENTIFICATION_POLICY,
} from '@/utils/hooks/faceRecognition/recognition/identificationPolicy';
import { buildEnrollmentGallery } from '@/utils/hooks/faceRecognition/recognition/enrollmentGallery';
import {
  createDatabase,
  validateDatabase,
} from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { createLiveIdentificationWorkflow } from '@/utils/hooks/faceRecognition/workflows/liveIdentificationWorkflow';
import { compatibleTemplate } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';

const context = { environment: 'test', companyId: 'c', storeId: null };
const manifest = {
  detector: { sha256: 'detector' },
  recognizer: { sha256: 'recognizer' },
  embeddingDimension: 128,
  preprocessingVersion: 'rgb-v1',
  qualityPolicyVersion: 'quality-v1',
};
const vector = (index) => Array.from({ length: 128 }, (_, i) => (i === index ? 1 : 0));
const face = (id, extra = {}) => ({
  detectionId: id,
  box: [id * 180 + 20, 20, 100, 120],
  landmarks: [],
  confidence: 0.99,
  quality: {},
  reasonCode: null,
  ...extra,
});
function database() {
  const db = createDatabase(context);
  for (let i = 0; i < 2; i++) {
    db.people.push({
      id: `p${i}`,
      companyId: 'c',
      storeId: null,
      acknowledgedAt: new Date().toISOString(),
      employeeCode: `E${i}`,
      normalizedEmployeeCode: `e${i}`,
      displayName: `Person ${i}`,
      activeTemplateId: `t${i}`,
    });
    db.templates.push({
      id: `t${i}`,
      personId: `p${i}`,
      companyId: 'c',
      storeId: null,
      version: 1,
      embedding: vector(i),
      modelIdentity: manifest,
      preprocessingVersion: manifest.preprocessingVersion,
      qualityPolicyVersion: manifest.qualityPolicyVersion,
      enrollmentSource: 'live_camera',
      enrollmentLiveness: 'passed_basic',
    });
  }
  return db;
}
async function harness(initial = database()) {
  let raw = JSON.stringify(initial),
    quota = false,
    time = 0,
    faces = [face(0)],
    probes = [vector(0), vector(1)],
    callback;
  const storage = {
    getItem: () => raw,
    setItem(_k, value) {
      if (quota) throw new Error('quota');
      raw = value;
    },
  };
  const repo = createLocalStorageRepository({
    context,
    storage,
    locks: { request: (_n, _o, cb) => cb({}) },
    events: null,
  });
  let gallery;
  const engine = {
    manifest,
    initialize: vi.fn(async () => manifest),
    dispose: vi.fn(),
    releaseFrame: vi.fn(async () => {}),
    setGallery: vi.fn(async (g) => {
      gallery = g;
    }),
    detectFrame: vi.fn(async () => ({ faces })),
    extractFaces: vi.fn(async (frameId, detectionIds, galleryVersion) => {
      await callback?.();
      return {
        frameId,
        galleryVersion,
        results: detectionIds.map((id) => ({
          detectionId: id,
          ranking: rankEmbedding(probes[id], gallery.entries),
        })),
      };
    }),
  };
  const flow = createLiveIdentificationWorkflow({
    repository: repo,
    engine,
    context,
    now: () => time,
  });
  await flow.start();
  return {
    repo,
    flow,
    engine,
    storage,
    raw: () => raw,
    step: async (ms = 400) => {
      time += ms;
      await flow.process({ width: 640, height: 480 }, time);
    },
    setFaces: (value) => {
      faces = value;
    },
    setProbes: (value) => {
      probes = value;
    },
    quota: (value) => {
      quota = value;
    },
    duringExtraction: (fn) => {
      callback = fn;
    },
    advance: (ms) => {
      time += ms;
    },
    time: () => time,
    events: () => repo.getSnapshot().database.identificationEvents,
  };
}
describe('automatic identity policy and gallery', () => {
  it.each([
    [0.849999, null, 0, 'UNKNOWN'],
    [0.85, null, 1, 'IDENTIFIED'],
    [0.85001, null, 1, 'IDENTIFIED'],
    [0.92, 0.87, 2, 'AMBIGUOUS'],
    [0.88, 0.84, 1, 'AMBIGUOUS'],
    [0.92, 0.7, 1, 'IDENTIFIED'],
    [0.9, 0.85, 2, 'AMBIGUOUS'],
  ])('classifies %s and runner-up %s', (score, next, count, result) => {
    expect(classifyRanking(score, next, count)).toBe(result);
  });
  it('rejects nonfinite scores and ranks the entire gallery independent of order', async () => {
    expect(() => classifyRanking(NaN, null, 0)).toThrow();
    const g = await buildEnrollmentGallery(database(), manifest, context);
    expect(rankEmbedding(vector(1), g.entries).personId).toBe('p1');
    expect(rankEmbedding(vector(1), [...g.entries].reverse()).personId).toBe('p1');
  });
  it('does not combine different identities or stale observations into a match', () => {
    const window = createIdentificationWindow();
    const a = {
      classification: 'IDENTIFIED',
      similarity: 0.95,
      personId: 'a',
      templateId: 'ta',
      templateVersion: 1,
    };
    const b = { ...a, personId: 'b', templateId: 'tb' };
    expect(window.observe(a, 0, 'track')).toBeNull();
    expect(window.observe(b, 400, 'track')).toBeNull();
    expect(window.observe(a, 800, 'track')).toBeNull();
    expect(window.observe(a, 1200, 'track')).toBeNull();
    expect(window.observe(a, 1600, 'track').personId).toBe('a');
    expect(window.observe(a, 4000, 'track')).toBeNull();
    expect(window.observe(a, 4400, 'newgallery')).toBeNull();
  });
  it('versions gallery content, not history or ordering, and handles missing detector metadata', async () => {
    const db = database(),
      a = await buildEnrollmentGallery(db, manifest, context);
    db.people.reverse();
    db.templates.reverse();
    db.revision++;
    db.settings.saveThumbnails = false;
    expect((await buildEnrollmentGallery(db, manifest, context)).version).toBe(a.version);
    db.people[0].displayName = 'Renamed';
    expect((await buildEnrollmentGallery(db, manifest, context)).version).not.toBe(a.version);
    db.templates[0].modelIdentity = { recognizer: { sha256: 'recognizer' } };
    expect(compatibleTemplate(db.templates[0], manifest)).toBe(false);
  });
  it('excludes diagnostic and wrong-store templates while preserving compatible legacy entries', async () => {
    const db = database();
    db.templates[0].enrollmentSource = 'test_image';
    db.templates[1].enrollmentSource = 'legacy_unknown';
    expect(
      (await buildEnrollmentGallery(db, manifest, context)).entries.map((e) => e.personId),
    ).toEqual(['p1']);
    expect(
      (await buildEnrollmentGallery(db, manifest, { ...context, storeId: 'other' })).entries,
    ).toHaveLength(0);
  });
});
describe('continuous identification and persistence', () => {
  it('previews independent closest records below cutoff without persisting candidate identities', async () => {
    const db = database();
    db.templates[0].thumbnailDataUrl = 'data:image/jpeg;base64,YQ==';
    const h = await harness(db);
    h.setFaces([face(0), face(1)]);
    const probe = (index) =>
      vector(index).map((v, i) => v * 0.7 + (i === 3 ? Math.sqrt(1 - 0.49) : 0));
    h.setProbes([probe(0), probe(1)]);
    await h.step();
    const previews = h.flow.getSnapshot().faces.map((f) => f.identification);
    expect(previews.map((p) => p.closestCandidate.personId)).toEqual(['p0', 'p1']);
    expect(previews[0].closestCandidate.thumbnailDataUrl).toBe(db.templates[0].thumbnailDataUrl);
    expect(previews[1].closestCandidate.thumbnailDataUrl).toBeNull();
    expect(previews.every((p) => p.person === null)).toBe(true);
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.events()).toHaveLength(2);
    for (const e of h.events()) {
      expect(e).toMatchObject({ outcome: 'UNKNOWN', personId: null, thumbnailDataUrl: null });
      expect(JSON.stringify(e)).not.toContain('closestCandidate');
    }
    h.repo.dispose();
  });
  it('keeps candidate photos fresh without changing the gallery or resetting stability', async () => {
    const h = await harness();
    await h.step();
    const db = structuredClone(h.repo.getSnapshot().database);
    db.templates[0].thumbnailDataUrl = 'data:image/jpeg;base64,YQ==';
    h.storage.setItem('db', JSON.stringify(db));
    await h.repo.refresh();
    await h.step();
    expect(h.flow.getSnapshot().faces[0].identification.closestCandidate.thumbnailDataUrl).toBe(
      db.templates[0].thumbnailDataUrl,
    );
    await h.step();
    expect(h.events()).toHaveLength(1);
    expect(h.engine.setGallery).toHaveBeenCalledTimes(1);
    h.advance(1501);
    h.flow.stale();
    expect(h.flow.getSnapshot().faces).toHaveLength(0);
    h.repo.dispose();
  });
  it('clears a preview on quality failure, uncertain association, deletion and Stop', async () => {
    const h = await harness();
    await h.step();
    expect(h.flow.getSnapshot().faces[0].identification.closestCandidate.personId).toBe('p0');
    h.setFaces([face(0, { reasonCode: 'POOR_EXPOSURE' })]);
    await h.step();
    expect(h.flow.getSnapshot().faces[0].identification.closestCandidate).toBeNull();
    h.setFaces([face(0)]);
    await h.step();
    await h.repo.commit({ type: 'deletePerson', id: 'p0' });
    await h.step();
    expect(h.flow.getSnapshot().faces[0].identification.closestCandidate?.personId).not.toBe('p0');
    h.flow.stop();
    expect(h.flow.getSnapshot().faces).toHaveLength(0);
    h.repo.dispose();
  });
  it('validates exact-85 inclusive decisions and loads mixed strict/inclusive history without reinterpretation', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) await h.step();
    const db = structuredClone(h.repo.getSnapshot().database);
    const inclusive = db.identificationEvents[0];
    inclusive.similarity = 0.85;
    inclusive.matchPercentage = 85;
    inclusive.margin = 0.85;
    inclusive.samples.forEach((s) => {
      s.similarity = 0.85;
      s.margin = 0.85;
    });
    expect(() => validateDatabase(db, context)).not.toThrow();
    const legacy = structuredClone(inclusive);
    Object.assign(legacy, {
      id: 'old',
      outcome: 'UNKNOWN',
      decisionPolicyVersion: LEGACY_IDENTIFICATION_POLICY,
      comparisonOperator: '>',
      personId: null,
      templateId: null,
      templateVersion: null,
      personSnapshot: null,
      scoreAggregation: 'last',
    });
    legacy.samples.forEach((s) =>
      Object.assign(s, {
        classification: 'UNKNOWN',
        aboveThresholdCount: 0,
        personId: null,
        templateId: null,
        templateVersion: null,
      }),
    );
    db.identificationEvents.push(legacy);
    expect(() => validateDatabase(db, context)).not.toThrow();
    h.storage.setItem('db', JSON.stringify(db));
    await h.repo.refresh();
    expect(h.repo.getSnapshot().mode).toBe('writable');
    await expect(
      h.repo.commit({ type: 'saveIdentification', event: legacy, manifest }),
    ).resolves.toBeDefined();
    await expect(
      h.repo.commit({ type: 'saveIdentification', event: { ...legacy, id: 'new-old' }, manifest }),
    ).rejects.toThrow(/current scan policy/);
    for (const policy of ['unknown-policy', IDENTIFICATION_POLICY]) {
      const bad = structuredClone(db);
      bad.identificationEvents[1].decisionPolicyVersion = policy;
      expect(() => validateDatabase(bad, context)).toThrow();
    }
    h.repo.dispose();
  });
  it('identifies two people independently without liveness and deduplicates continuous frames', async () => {
    const h = await harness();
    h.setFaces([face(0), face(1)]);
    for (let i = 0; i < 12; i++) await h.step();
    expect(h.events().map((e) => e.personId)).toEqual(['p0', 'p1']);
    expect(
      h
        .events()
        .every(
          (e) =>
            e.livenessStatus === 'not_checked' &&
            e.faceCountAtDecision === 2 &&
            e.probeEmbedding === null,
        ),
    ).toBe(true);
    expect(h.flow.getSnapshot().faces.map((f) => f.identification.person.personId)).toEqual([
      'p0',
      'p1',
    ]);
    expect(h.engine.setGallery).toHaveBeenCalledTimes(1);
    h.repo.dispose();
  });
  it('records Unknown with no person then identifies automatically when evidence improves', async () => {
    const h = await harness();
    h.setProbes([vector(3)]);
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.events()[0]).toMatchObject({
      outcome: 'UNKNOWN',
      personId: null,
      personSnapshot: null,
    });
    h.setProbes([vector(0)]);
    for (let i = 0; i < 4; i++) await h.step();
    expect(h.events().map((e) => e.outcome)).toEqual(['UNKNOWN', 'IDENTIFIED']);
    h.repo.dispose();
  });
  it('does not let a low-quality second face block another person', async () => {
    const h = await harness();
    h.setFaces([face(0), face(1, { reasonCode: 'BLURRED_FACE' })]);
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.events().map((e) => e.personId)).toEqual(['p0']);
    expect(h.flow.getSnapshot().faces[1].identification.status).toBe('quality_blocked');
    h.repo.dispose();
  });
  it('withholds two tracks competing for the same identity', async () => {
    const h = await harness();
    h.setFaces([face(0), face(1)]);
    h.setProbes([vector(0), vector(0)]);
    for (let i = 0; i < 5; i++) await h.step();
    expect(h.events()).toHaveLength(0);
    expect(
      h.flow.getSnapshot().faces.every((f) => f.identification.status === 'identity_conflict'),
    ).toBe(true);
    h.repo.dispose();
  });
  it('saves one immutable event after quota recovery and validates gallery before retry', async () => {
    const h = await harness();
    h.quota(true);
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.flow.getSnapshot().status).toBe('save_failed');
    const id = h.flow.getSnapshot().pending.event.id;
    await h.step();
    expect(h.events()).toHaveLength(0);
    h.quota(false);
    await h.flow.retry();
    await h.flow.retry();
    expect(h.events().map((e) => e.id)).toEqual([id]);
    await h.repo.commit({
      type: 'savePerson',
      person: { ...h.repo.getSnapshot().database.people[0], displayName: 'New Name' },
    });
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.events()).toHaveLength(2);
    h.repo.dispose();
  });
  it('discards gallery-stale extraction replies and stops late writes', async () => {
    const h = await harness();
    await h.step();
    await h.step();
    h.duringExtraction(async () => {
      h.duringExtraction(null);
      await h.repo.commit({ type: 'deletePerson', id: 'p0' });
    });
    await h.step();
    expect(h.events()).toHaveLength(0);
    h.duringExtraction(() => h.flow.stop());
    await h.step();
    expect(h.events()).toHaveLength(0);
    h.repo.dispose();
  });
  it('rejects forged identification evidence without weakening enrollment validation', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) await h.step();
    const db = structuredClone(h.repo.getSnapshot().database);
    for (const mutate of [
      (e) => {
        e.livenessStatus = 'passed_basic';
      },
      (e) => {
        e.samples[1].personId = 'p1';
      },
      (e) => {
        e.similarity = 0.85;
      },
      (e) => {
        e.recognitionAgeMs = 2000;
      },
    ]) {
      const forged = structuredClone(db);
      mutate(forged.identificationEvents[0]);
      expect(() => validateDatabase(forged, context)).toThrow();
    }
    h.repo.dispose();
  });
  it('migrates v2 on disk, retains records on reload, and deletes linked scan history only', async () => {
    const old = database();
    old.schemaVersion = 2;
    delete old.identificationEvents;
    const h = await harness(old);
    expect(JSON.parse(h.raw()).schemaVersion).toBe(3);
    for (let i = 0; i < 3; i++) await h.step();
    const readOnly = createLocalStorageRepository({
      context,
      storage: h.storage,
      locks: { request: (_n, _o, cb) => cb(null) },
      events: null,
    });
    await readOnly.load();
    expect(readOnly.getSnapshot().database.identificationEvents).toHaveLength(1);
    await h.repo.commit({ type: 'deletePerson', id: 'p0' });
    expect(h.events()).toHaveLength(0);
    expect(h.repo.getSnapshot().database.people).toHaveLength(1);
    h.repo.dispose();
    readOnly.dispose();
  });
  it('draws detection only for an empty gallery and terminates a stalled operation', async () => {
    const h = await harness(createDatabase(context));
    await h.step();
    expect(h.events()).toHaveLength(0);
    expect(h.engine.extractFaces).not.toHaveBeenCalled();
    h.advance(5100);
    h.flow.stale();
    expect(h.flow.getSnapshot().status).toBe('error');
    expect(h.engine.dispose).toHaveBeenCalled();
    h.repo.dispose();
  });
  it('fairly recognizes three tracks against 50 enrollments without starving the third face', async () => {
    const db = database();
    for (let i = 2; i < 50; i++) {
      db.people.push({
        ...db.people[0],
        id: `p${i}`,
        employeeCode: `E${i}`,
        normalizedEmployeeCode: `e${i}`,
        activeTemplateId: `t${i}`,
      });
      db.templates.push({
        ...db.templates[0],
        id: `t${i}`,
        personId: `p${i}`,
        embedding: vector(i),
      });
    }
    const h = await harness(db);
    h.setFaces([face(0), face(1), face(2)]);
    h.setProbes([vector(0), vector(1), vector(2)]);
    for (let i = 0; i < 12; i++) await h.step();
    expect(
      h
        .events()
        .map((e) => e.personId)
        .sort(),
    ).toEqual(['p0', 'p1', 'p2']);
    expect(h.engine.extractFaces.mock.calls.every((c) => c[1].length <= 2)).toBe(true);
    h.repo.dispose();
  });
  it('records ambiguous candidates without exposing a guessed identity', async () => {
    const db = database();
    db.templates[1].embedding = [...db.templates[0].embedding];
    const h = await harness(db);
    for (let i = 0; i < 4; i++) await h.step();
    expect(h.events()[0]).toMatchObject({
      outcome: 'AMBIGUOUS',
      personId: null,
      personSnapshot: null,
    });
    expect(h.events()[0].samples.every((s) => s.aboveThresholdCount === 2)).toBe(true);
    h.repo.dispose();
  });
  it('uses the combined 200-record limit without altering stored bytes on capacity failure', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) await h.step();
    const db = structuredClone(h.repo.getSnapshot().database),
      event = db.identificationEvents[0];
    db.identificationEvents = Array.from({ length: 200 }, (_, i) => ({
      ...event,
      id: `event${i}`,
      encounterId: `encounter${i}`,
    }));
    h.storage.setItem('db', JSON.stringify(db));
    await h.repo.refresh();
    const before = h.raw();
    await expect(
      h.repo.commit({ type: 'saveIdentification', event: { ...event, id: 'overflow' }, manifest }),
    ).rejects.toThrow(/limit/);
    expect(h.raw()).toBe(before);
    h.repo.dispose();
  });
  it('blocks a pending retry after a template was removed, and suppresses a discarded encounter', async () => {
    const h = await harness();
    h.quota(true);
    for (let i = 0; i < 3; i++) await h.step();
    h.quota(false);
    await h.repo.commit({ type: 'deletePerson', id: 'p0' });
    await h.flow.retry();
    expect(h.flow.getSnapshot().error).toMatch(/changed/);
    h.flow.discard();
    for (let i = 0; i < 4; i++) await h.step();
    expect(h.events().map((e) => e.outcome)).toEqual(['UNKNOWN']);
    h.repo.dispose();
  });
  it('resets current identity on missed detection and re-identifies without duplicate writes', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) await h.step();
    h.setFaces([]);
    await h.step();
    expect(h.flow.getSnapshot().faces).toHaveLength(0);
    h.setFaces([face(0)]);
    await h.step();
    expect(h.flow.getSnapshot().faces[0].identification.person).toBeNull();
    await h.step();
    await h.step();
    expect(h.flow.getSnapshot().faces[0].identification.person.personId).toBe('p0');
    expect(h.events()).toHaveLength(1);
    h.repo.dispose();
  });
  it('suppresses short track churn but records a new encounter after the cooldown', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) await h.step();
    h.setFaces([]);
    await h.step(1600);
    h.setFaces([face(0)]);
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.events()).toHaveLength(1);
    h.setFaces([]);
    await h.step(11000);
    h.setFaces([face(0)]);
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.events()).toHaveLength(2);
    h.repo.dispose();
  });
  it('retains encounter deduplication when the gallery changes and returns to an earlier version', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) await h.step();
    const person = structuredClone(h.repo.getSnapshot().database.people[0]);
    await h.repo.commit({ type: 'savePerson', person: { ...person, displayName: 'Renamed' } });
    for (let i = 0; i < 3; i++) await h.step();
    await h.repo.commit({ type: 'savePerson', person });
    for (let i = 0; i < 3; i++) await h.step();
    expect(h.events()).toHaveLength(2);
    expect(new Set(h.events().map((e) => e.encounterId)).size).toBe(1);
    h.repo.dispose();
  });
});

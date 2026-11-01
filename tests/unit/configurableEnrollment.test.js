import { describe, it, expect, vi } from 'vitest';
import { createActiveChallenge } from '@/utils/hooks/faceRecognition/liveness/activeChallenge';
import {
  DEFAULT_LIVENESS,
  challengeReady,
} from '@/utils/hooks/faceRecognition/liveness/livenessPolicy';
import {
  createDatabase,
  validateDatabase,
} from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { migrateDatabase } from '@/utils/hooks/faceRecognition/repositories/migrateDatabase';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { createLiveFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/liveFaceWorkflow';
import { createFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';

const context = { environment: 'test', companyId: 'company', storeId: null };
const manifest = {
  detector: { sha256: 'd' },
  recognizer: { sha256: 'r' },
  embeddingDimension: 128,
  preprocessingVersion: 'v1',
};
const vector = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0));
const face = { box: [10, 10, 120, 140], confidence: 0.99, reasonCode: null };
const off = { version: 1, turnLeft: false, turnRight: false, blink: false };

describe('configurable enrollment challenges', () => {
  it.each(Array.from({ length: 8 }, (_, n) => n))(
    'requires exactly the enabled tests for configuration %i',
    (n) => {
      const configuration = {
        version: 1,
        turnLeft: !!(n & 1),
        turnRight: !!(n & 2),
        blink: !!(n & 4),
      };
      const c = createActiveChallenge({ configuration, random: () => 1 });
      let time = 0;
      const observe = (yaw = 0, eye = 0) =>
        c.update({ yaw, eyeBlinkLeft: eye, eyeBlinkRight: eye, timestamp: (time += 50) });
      for (let i = 0; i < 24; i++) observe();
      if (!n) {
        expect(c.snapshot()).toMatchObject({
          status: 'not_checked',
          reason: 'disabled_in_settings',
          steps: [],
        });
        expect(c.snapshot().passedAt).toBeUndefined();
      } else {
        expect(
          c
            .snapshot()
            .steps.filter((s) => s.direction !== 'neutral')
            .map((s) => s.direction)
            .sort(),
        ).toEqual(
          [
            configuration.turnLeft && 'left',
            configuration.turnRight && 'right',
            configuration.blink && 'blink',
          ]
            .filter(Boolean)
            .sort(),
        );
        for (
          let attempts = 0;
          attempts < 20 && c.snapshot().status !== 'passed_basic';
          attempts++
        ) {
          const d = c.snapshot().steps[c.snapshot().step]?.direction;
          if (d === 'blink') {
            observe();
            observe();
            observe(0, 1);
            observe(0, 1);
            observe();
            observe();
          } else for (let i = 0; i < 8; i++) observe(d === 'left' ? 25 : d === 'right' ? -25 : 0);
        }
        expect(c.snapshot().status).toBe('passed_basic');
      }
      expect(challengeReady(c.snapshot())).toBe(true);
    },
  );
  it('does not pass winks, missing observations, prolonged closure or stale cycles', () => {
    for (const kind of ['wink', 'missing', 'slow', 'held']) {
      const c = createActiveChallenge({ configuration: { ...off, blink: true } });
      for (let t = 0; t <= 1100; t += 50)
        c.update({ yaw: 0, timestamp: t, eyeBlinkLeft: 0, eyeBlinkRight: 0 });
      let time = 1150;
      for (let i = 0; i < 45; i++) {
        c.update({
          yaw: 0,
          timestamp: time,
          eyeBlinkLeft: kind === 'missing' ? null : i < 40 ? 1 : 0,
          eyeBlinkRight: kind === 'wink' ? 0 : i < 40 ? 1 : 0,
        });
        time += kind === 'slow' ? 250 : 50;
      }
      expect(c.snapshot().status).not.toBe('passed_basic');
    }
  });
  it('takes an immutable configuration snapshot and rejects malformed booleans', () => {
    const configuration = { ...DEFAULT_LIVENESS };
    const c = createActiveChallenge({ configuration });
    configuration.turnLeft = false;
    expect(c.snapshot().configuration.turnLeft).toBe(true);
    expect(() => createActiveChallenge({ configuration: { ...off, blink: 'false' } })).toThrow(
      /settings/,
    );
  });
});

async function harness({ guided = true, configuration = off } = {}) {
  let raw = null,
    quota = false,
    yaw = 0,
    time = 0,
    faces = [face];
  const repository = createLocalStorageRepository({
    context,
    storage: {
      getItem: () => raw,
      setItem: (_k, v) => {
        if (quota) throw new Error('Full');
        raw = v;
      },
    },
    locks: { request: (_k, _o, cb) => cb({}) },
    events: null,
  });
  await repository.load();
  await repository.commit({
    type: 'savePerson',
    person: {
      id: 'p',
      displayName: 'Person',
      employeeCode: 'E1',
      acknowledgedAt: new Date().toISOString(),
    },
  });
  await repository.commit({
    type: 'settings',
    settings: { matchThreshold: 0.85, saveThumbnails: false, enrollmentLiveness: configuration },
  });
  const engine = {
    manifest,
    initialize: vi.fn(),
    analyzeFrame: vi.fn(async () => ({
      faces,
      embedding: [...vector],
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
      quality: {},
    })),
  };
  const liveness = {
    manifest: { sha256: 'pose-model' },
    initialize: vi.fn(),
    observe: vi.fn(async () => ({ yaw, box: face.box, eyeBlinkLeft: 0, eyeBlinkRight: 0 })),
  };
  const workflow = createFaceWorkflow({ repository, engine, context });
  const live = createLiveFaceWorkflow({
    repository,
    engine,
    liveness,
    workflow,
    context,
    now: () => time,
  });
  await live.start({ personId: 'p', purpose: 'enroll', guided });
  return {
    live,
    repository,
    engine,
    liveness,
    raw: () => raw,
    setQuota: (v) => (quota = v),
    setFaces: (v) => (faces = v),
    step: async (pose = 0, dt = 150) => {
      yaw = pose;
      time += dt;
      await live.process({ width: 640, height: 480 }, time);
    },
    async capture(pose) {
      for (let i = 0; i < 8; i++) await this.step(pose);
      expect(live.getSnapshot().status).toBe('ready_to_enroll');
      await live.enroll();
      await this.step(pose);
    },
  };
}

describe('guided capture and disabled liveness provenance', () => {
  it('restarts only the unfinished capture hold after a quality interruption', async () => {
    const h = await harness({ guided: false });
    await h.step(0);
    await h.step(0);
    h.setFaces([{ ...face, reasonCode: 'BLURRED_FACE' }]);
    await h.step(0);
    h.setFaces([face]);
    await h.step(0);
    expect(h.live.getSnapshot().status).toBe('preparing_enrollment');
    expect(h.live.getSnapshot().liveness.reason).toBe('disabled_in_settings');
    await h.step(0);
    await h.step(0);
    expect(h.live.getSnapshot().status).toBe('ready_to_enroll');
    h.repository.dispose();
  });
  it('seals three separate captures and atomically saves after camera processing ends', async () => {
    const h = await harness();
    for (const pose of [0, 15, -15]) await h.capture(pose);
    expect(h.live.getSnapshot().status).toBe('review');
    expect(h.repository.getSnapshot().database.templates).toHaveLength(0);
    const calls = h.engine.analyzeFrame.mock.calls.length;
    await h.step(0);
    expect(h.engine.analyzeFrame.mock.calls.length).toBe(calls);
    await h.live.saveSet(['Front', 'Makeup left', 'Makeup right']);
    const db = h.repository.getSnapshot().database;
    expect(db.templates.map((t) => t.label)).toEqual(['Front', 'Makeup left', 'Makeup right']);
    expect(db.attempts).toHaveLength(3);
    expect(new Set(db.templates.map((t) => t.id)).size).toBe(3);
    expect(new Set(db.templates.map((t) => t.captureSetId)).size).toBe(1);
    expect(db.people[0]).not.toHaveProperty('primaryTemplateId');
    for (const a of db.attempts)
      expect(a).toMatchObject({
        livenessStatus: 'not_checked',
        liveness: { reason: 'disabled_in_settings', steps: [] },
      });
    expect(db.templates.every((t) => t.thumbnailDataUrl === null)).toBe(true);
    expect(() => validateDatabase(db, context)).not.toThrow();
    const corrupt = structuredClone(db);
    corrupt.attempts[0].livenessStatus = 'passed_basic';
    expect(() => validateDatabase(corrupt, context)).toThrow(/Disabled/);
    await h.live.saveSet(['Front', 'Makeup left', 'Makeup right']);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(3);
    h.repository.dispose();
  });
  it('keeps the review on quota failure and saves once on retry without more inference', async () => {
    const h = await harness();
    for (const pose of [0, 15, -15]) await h.capture(pose);
    const before = h.raw(),
      calls = h.engine.analyzeFrame.mock.calls.length;
    h.setQuota(true);
    await h.live.saveSet(['a', 'b', 'c']);
    expect(h.live.getSnapshot().status).toBe('set_save_failed');
    expect(h.raw()).toBe(before);
    h.setQuota(false);
    await h.live.saveSet(['a', 'b', 'c']);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(3);
    expect(h.engine.analyzeFrame.mock.calls.length).toBe(calls);
    h.repository.dispose();
  });
  it('rejects stale review revisions and supports discard without saved captures', async () => {
    const h = await harness();
    for (const pose of [0, 15, -15]) await h.capture(pose);
    const db = h.repository.getSnapshot().database;
    db.people[0].enrollmentRevision++;
    await expect(h.live.saveSet(['a', 'b', 'c'])).rejects.toThrow(/changed/);
    h.live.discardSet();
    expect(h.live.getSnapshot().review).toBeNull();
    expect(db.templates).toHaveLength(0);
    h.repository.dispose();
  });
  it('invalidates pending poses when multiple people interrupt the set', async () => {
    const h = await harness();
    await h.capture(0);
    h.setFaces([face, { ...face, box: [300, 10, 120, 140] }]);
    await h.step();
    h.setFaces([face]);
    await h.capture(0);
    expect(h.live.getSnapshot().status).not.toBe('review');
    expect(h.live.getSnapshot().liveness.prompt).toContain('left');
    h.repository.dispose();
  });
  it('captures one live sample with disabled evidence and rejects forged capture consistency', async () => {
    const h = await harness({ guided: false });
    await h.capture(0);
    const db = h.repository.getSnapshot().database;
    expect(db.templates).toHaveLength(1);
    const bad = structuredClone(db);
    bad.attempts[0].captureConsistency = 0.85;
    expect(() => validateDatabase(bad, context)).toThrow(/evidence/);
    h.repository.dispose();
  });
  it('does not change an active configuration when Settings changes', async () => {
    const h = await harness({ guided: false });
    await h.repository.commit({
      type: 'settings',
      settings: {
        matchThreshold: 0.85,
        saveThumbnails: false,
        enrollmentLiveness: { ...off, blink: true },
      },
    });
    await h.capture(0);
    expect(h.repository.getSnapshot().database.attempts[0].liveness.configuration).toEqual(off);
    expect(h.repository.getSnapshot().database.settings.enrollmentLiveness.blink).toBe(true);
    h.repository.dispose();
  });
  it('retries an identical set idempotently and rejects changed reuse', async () => {
    const h = await harness();
    for (const pose of [0, 15, -15]) await h.capture(pose);
    const commit = h.repository.commit;
    let operation;
    h.repository.commit = (op) => {
      operation = structuredClone({ ...op, signal: undefined });
      return commit(op);
    };
    await h.live.saveSet(['a', 'b', 'c']);
    const before = h.raw();
    await commit(operation);
    expect(h.raw()).toBe(before);
    operation.captures[0].template.label = 'different';
    await expect(commit(operation)).rejects.toThrow(/conflicts/);
    expect(h.raw()).toBe(before);
    h.repository.dispose();
  });
  it('rejects malformed guided evidence without a partial write', async () => {
    const h = await harness();
    for (const pose of [0, 15, -15]) await h.capture(pose);
    const commit = h.repository.commit;
    h.repository.commit = (op) => {
      op.captures[1].attempt.trackId = 99;
      return commit(op);
    };
    const before = h.raw();
    await h.live.saveSet(['a', 'b', 'c']);
    expect(h.live.getSnapshot().status).toBe('set_save_failed');
    expect(h.raw()).toBe(before);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(0);
    h.repository.dispose();
  });
  it('migrates schema 4 without primary pointers or fabricated historical liveness', () => {
    const old = createDatabase(context);
    old.schemaVersion = 4;
    delete old.settings.enrollmentLiveness;
    old.people.push({
      id: 'p',
      companyId: 'company',
      employeeCode: 'e',
      normalizedEmployeeCode: 'e',
      displayName: 'Person',
      primaryTemplateId: 't',
      enrollmentRevision: 9,
    });
    old.templates.push({
      id: 't',
      personId: 'p',
      companyId: 'company',
      version: 9,
      label: 'Original',
      embedding: vector,
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
      enrollmentSource: 'live_camera',
      enrollmentLiveness: 'passed_basic',
    });
    const bytes = JSON.stringify(old),
      next = migrateDatabase(old, context);
    expect(JSON.stringify(old)).toBe(bytes);
    expect(next.schemaVersion).toBe(5);
    expect(next.people[0]).not.toHaveProperty('primaryTemplateId');
    expect(next.people[0].enrollmentRevision).toBe(9);
    expect(next.templates).toEqual(old.templates);
    expect(next.settings.enrollmentLiveness).toEqual(DEFAULT_LIVENESS);
  });
});

import { describe, it, expect } from 'vitest';
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

import { harness as meterHarness, bind, perform } from './enrollmentFixtures';

async function guidedHarness() {
  const h = await meterHarness();
  await bind(h, 1, 'Person', true);
  await perform(h, [1]);
  expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 1).stage).toBe(1);
  for (const yaw of [15, -15]) {
    h.yaw[0] = yaw;
    await h.wait(1200);
  }
  h.yaw[0] = 0;
  expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 1).status).toBe('review');
  return h;
}

describe('guided capture with separate motion evidence', () => {
  it('seals three captures and atomically saves the guided set with separate proof', async () => {
    const h = await guidedHarness();
    expect(h.repository.getSnapshot().database.templates).toHaveLength(0);
    await h.flow.saveSet(['Front', 'Left', 'Right'], 1);
    const db = h.repository.getSnapshot().database;
    expect(db.templates.map((t) => t.label)).toEqual(['Front', 'Left', 'Right']);
    expect(db.attempts).toHaveLength(3);
    expect(new Set(db.templates.map((t) => t.id)).size).toBe(3);
    expect(new Set(db.templates.map((t) => t.captureSetId)).size).toBe(1);
    for (const a of db.attempts) {
      expect(a.liveness.status).toBe('passed_basic');
      expect(a.livenessMeter.status).toBe('passed_basic');
    }
    expect(() => validateDatabase(db, context)).not.toThrow();
    await h.flow.saveSet(['Front', 'Left', 'Right'], 1);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(3);
  });
  it('retains sealed review after quota failure and retries without new observations', async () => {
    const h = await guidedHarness();
    const before = h.raw();
    h.quota(true);
    await h.flow.saveSet(['a', 'b', 'c'], 1);
    expect(h.flow.getSnapshot().sessions[0].status).toBe('set_save_failed');
    expect(h.raw()).toBe(before);
    h.flow.stop();
    h.quota(false);
    await h.flow.saveSet(['a', 'b', 'c'], 1);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(3);
  });
  it('rejects malformed guided evidence without partial writes', async () => {
    const h = await guidedHarness();
    const commit = h.repository.commit;
    h.repository.commit = (op) => {
      op.captures[1].attempt.trackId = 99;
      return commit(op);
    };
    const before = h.raw();
    await h.flow.saveSet(['a', 'b', 'c'], 1);
    expect(h.flow.getSnapshot().sessions[0].status).toBe('set_save_failed');
    expect(h.raw()).toBe(before);
  });
  it('retries an identical set idempotently and rejects changed reuse', async () => {
    const h = await guidedHarness();
    const commit = h.repository.commit;
    let operation;
    h.repository.commit = (op) => {
      operation = structuredClone({ ...op, signal: undefined });
      return commit(op);
    };
    await h.flow.saveSet(['a', 'b', 'c'], 1);
    const before = h.raw();
    await commit(operation);
    expect(h.raw()).toBe(before);
    operation.captures[0].template.label = 'different';
    await expect(commit(operation)).rejects.toThrow(/conflicts/);
  });
  it('retains a sealed review for explicit discard', async () => {
    const h = await guidedHarness();
    h.flow.stop();
    h.flow.discardSet(1);
    expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 1).review).toBeNull();
    expect(h.repository.getSnapshot().database.templates).toHaveLength(0);
  });
});

describe('historical schema compatibility', () => {
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

describe('current enrollment gate regressions', () => {
  it('loads old all-off settings and blocks a new operation', async () => {
    const h = await meterHarness(off);
    expect(h.repository.getSnapshot().database.settings.enrollmentLiveness).toEqual(off);
    await expect(bind(h, 1, 'Person')).rejects.toThrow('Enable at least one');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it('keeps passed evidence while quality interrupts an unfinished guided pose', async () => {
    const h = await meterHarness();
    await bind(h, 1, 'Person', true);
    await perform(h, [1]);
    const before = structuredClone(h.flow.getSnapshot().sessions[0].meter.accepted);
    h.yaw[0] = 15;
    await h.wait(150);
    h.faces([{ ...face, reasonCode: 'BLURRED_FACE' }]);
    await h.step();
    expect(h.flow.getSnapshot().sessions[0].stage).toBe(1);
    expect(h.flow.getSnapshot().sessions[0].meter.accepted).toEqual(before);
    h.faces([face]);
    await h.wait(150);
    expect(h.flow.getSnapshot().sessions[0].stage).toBe(1);
    await h.wait(1000);
    expect(h.flow.getSnapshot().sessions[0].stage).toBe(2);
  });
  it('rejects changed identity during sealed review and allows discard', async () => {
    const h = await guidedHarness();
    const session = h.flow.getSnapshot().sessions[0];
    const db = h.repository.getSnapshot().database;
    db.people.push({ ...session.person, enrollmentRevision: 1 });
    await expect(h.flow.saveSet(['a', 'b', 'c'], 1)).rejects.toThrow(/changed/);
    h.flow.discardSet(1);
    expect(h.flow.getSnapshot().sessions[0].review).toBeNull();
    expect(db.templates).toHaveLength(0);
  });
  it('keeps active challenge configuration when settings change', async () => {
    const h = await meterHarness();
    await bind(h, 1, 'Person');
    await h.repository.commit({
      type: 'settings',
      settings: {
        matchThreshold: 0.85,
        saveThumbnails: false,
        enrollmentLiveness: { version: 1, turnLeft: true, turnRight: false, blink: false },
      },
    });
    await perform(h, [1]);
    const db = h.repository.getSnapshot().database;
    expect(db.attempts[0].liveness.configuration).toEqual({ ...off, blink: true });
    expect(db.settings.enrollmentLiveness.turnLeft).toBe(true);
  });
  it('rejects forged capture consistency in current policy evidence', async () => {
    const h = await meterHarness();
    await bind(h, 1, 'Person');
    await perform(h, [1]);
    const bad = structuredClone(h.repository.getSnapshot().database);
    bad.attempts[0].captureConsistency = 0.85;
    expect(() => validateDatabase(bad, context)).toThrow();
  });
});

describe('guided association and capacity', () => {
  it('allows a second person in view but rejects ambiguous target association', async () => {
    const h = await meterHarness();
    await bind(h, 1, 'Person', true);
    await perform(h, [1]);
    expect(h.flow.getSnapshot().sessions[0].stage).toBe(1);
    h.faces([face, { ...face }]);
    await h.step();
    expect(h.repository.getSnapshot().database.templates).toHaveLength(0);
    expect(h.flow.getSnapshot().sessions[0].meter.status).not.toBe('passed_basic');
  });
  it('enforces the five-sample limit before beginning a guided set', async () => {
    const h = await guidedHarness();
    await h.flow.saveSet(['a', 'b', 'c'], 1);
    const person = h.repository.getSnapshot().database.people[0];
    await h.wait(1600);
    await expect(
      h.flow.nameDetectedFace({
        trackId: 1,
        personId: person.id,
        acknowledged: true,
        guided: true,
      }),
    ).rejects.toThrow('sample slots');
    expect(h.repository.getSnapshot().database.templates).toHaveLength(3);
  });
});

it('rejects a sealed guided review if an existing enrollee revision changes', async () => {
  const h = await meterHarness();
  await bind(h, 1, 'Person');
  await perform(h, [1]);
  const db = h.repository.getSnapshot().database;
  const person = db.people[0];
  await h.wait(1600);
  await h.flow.nameDetectedFace({
    trackId: 1,
    personId: person.id,
    acknowledged: true,
    guided: true,
  });
  await perform(h, [1]);
  await h.wait(1000);
  for (const yaw of [15, -15]) {
    h.yaw[0] = yaw;
    await h.wait(1200);
  }
  expect(h.flow.getSnapshot().sessions[0].status).toBe('review');
  person.enrollmentRevision++;
  await expect(h.flow.saveSet(['a', 'b', 'c'], 1)).rejects.toThrow(/changed/);
  h.flow.discardSet(1);
  expect(db.templates).toHaveLength(1);
});

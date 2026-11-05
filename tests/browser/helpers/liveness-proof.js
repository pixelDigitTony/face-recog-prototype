import { expect } from '@playwright/test';

// A genuinely captured record is checked through the real repository against an
// isolated in-memory store. No production validators or pass flags are patched.
export async function checkRepositoryProof(page) {
  const rows = await page.evaluate(async () => {
    const { createLocalStorageRepository } = await import(
      '/src/utils/hooks/faceRecognition/repositories/localStorageRepository.js'
    );
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const saved = JSON.parse(localStorage.getItem(key));
    const originalAttempt = saved.attempts.find((a) => a.outcome === 'ENROLLED');
    const originalTemplate = saved.templates.find((t) => t.id === originalAttempt.templateId);
    const context = { ...saved.scope, storeId: null };
    const changes = [
      ['unchanged', () => {}, true],
      [
        'missing-meter',
        (a, t) => {
          delete a.livenessMeter;
          delete t.livenessMeter;
        },
        false,
      ],
      [
        'forged-score',
        (a, t) => {
          a.livenessMeter.acceptedScore = 100;
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ],
      [
        'wrong-track',
        (a, t) => {
          a.livenessMeter.trackId++;
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ],
      [
        'wrong-session',
        (a, t) => {
          a.livenessMeter.enrollmentSessionId = 'other';
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ],
      [
        'missing-count',
        (a, t) => {
          delete a.livenessMeter.events.find((e) => e.family === 'head').holdCount;
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ],
      [
        'duplicate-family',
        (a, t) => {
          a.livenessMeter.events[1] = structuredClone(a.livenessMeter.events[0]);
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ],
      [
        'short-span',
        (a, t) => {
          a.livenessMeter.startedAt = a.livenessMeter.passedAt - 1999;
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ],
      [
        'stale-capture',
        (a) => {
          a.decisionTimestamp = a.captureFrameTimestamp + 1501;
        },
        false,
      ],
      [
        'template-mismatch',
        (a, t) => {
          t.livenessMeter.enrollmentSessionId = 'different';
        },
        false,
      ],
      [
        'unbounded-proof',
        (a, t) => {
          a.livenessMeter.rawLandmarks = Array(10000).fill(1);
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ],
      [
        'all-off',
        (a) => {
          a.liveness.configuration = {
            version: 1,
            turnLeft: false,
            turnRight: false,
            blink: false,
          };
        },
        false,
      ],
      [
        'legacy-v2-write',
        (a, t) => {
          a.decisionPolicyVersion = 'enrollment-per-face-liveness-v2';
          delete a.livenessMeter;
          delete t.livenessMeter;
        },
        false,
      ],
      [
        'legacy-v1-write',
        (a, t) => {
          a.decisionPolicyVersion = 'enrollment-configurable-liveness-v1';
          delete a.livenessMeter;
          delete t.livenessMeter;
        },
        false,
      ],
    ];
    const proofChanges = [
      ['count11', (p) => (p.observationCount = 11)],
      ['count201', (p) => (p.observationCount = 201)],
      ['fractional-count', (p) => (p.observationCount = 12.5)],
      ['threshold-change', (p) => (p.threshold = 59)],
      ['unrounded-score-tamper', (p) => (p.acceptedScore += 0.001)],
      ['wrong-worker', (p) => p.workerGeneration++],
      ['wrong-camera', (p) => (p.cameraSessionId = 'other-camera')],
      ['wrong-asset', (p) => (p.assetIdentity = 'other-asset')],
      ['capture-nonexclusive', (p) => (p.capture.exclusive = false)],
      ['capture-pose-stale', (p) => (p.capture.poseTimestamp = p.capture.captureTimestamp - 1501)],
      [
        'partial-forged-phase2',
        (p) => {
          p.progress.expression = 2;
          p.acceptedScore =
            (40 * p.progress.blink + 25 * p.progress.head + 35 * p.progress.expression) / 3;
          p.partials.expression.phase = 2;
          delete p.partials.expression.changedAt;
          delete p.partials.expression.changedEndAt;
        },
      ],
      ['partial-extra-stream', (p) => (p.partials.expression.rawFrames = [1, 2, 3])],
    ];
    for (const family of ['blink', 'head']) {
      const event = (p) => p.events.find((e) => e.family === family);
      proofChanges.push([`${family}-missing-gap`, (p) => delete event(p).maxGapMs]);
      proofChanges.push([`${family}-gap201`, (p) => (event(p).maxGapMs = 201)]);
      proofChanges.push([`${family}-NaN-gap`, (p) => (event(p).maxGapMs = NaN)]);
      proofChanges.push([
        `${family}-missing-count`,
        (p) => delete event(p)[family === 'blink' ? 'openAfter' : 'holdCount'],
      ]);
      proofChanges.push([
        `${family}-NaN-count`,
        (p) => (event(p)[family === 'blink' ? 'openAfter' : 'holdCount'] = NaN),
      ]);
      proofChanges.push([
        `${family}-fractional-count`,
        (p) => (event(p)[family === 'blink' ? 'openAfter' : 'holdCount'] = 2.5),
      ]);
    }
    proofChanges.push([
      'blink-no-closed-phase',
      (p) => (p.events.find((e) => e.family === 'blink').closedCount = 0),
    ]);
    proofChanges.push([
      'head-return-over3',
      (p) => (p.events.find((e) => e.family === 'head').returnDelta = 3.001),
    ]);
    proofChanges.push([
      'head-peak-over15',
      (p) => (p.events.find((e) => e.family === 'head').peak = 15.001),
    ]);
    proofChanges.push([
      'head-peak-below4',
      (p) => (p.events.find((e) => e.family === 'head').peak = 3.999),
    ]);
    for (const [name, mutate] of proofChanges)
      changes.push([
        name,
        (a, t) => {
          mutate(a.livenessMeter);
          t.livenessMeter = structuredClone(a.livenessMeter);
        },
        false,
      ]);
    const rows = [];
    for (const [name, mutate, expected] of changes) {
      const base = structuredClone(saved);
      base.templates = [];
      base.attempts = [];
      base.identificationEvents = [];
      base.evaluationTrials = [];
      base.people = base.people.filter((p) => p.id === originalAttempt.personId);
      base.people[0].enrollmentRevision = 0;
      delete base.people[0].primaryTemplateId;
      delete base.people[0].activeTemplateId;
      const memory = new Map([[key, JSON.stringify(base)]]);
      const storage = {
        getItem: (k) => memory.get(k) ?? null,
        setItem: (k, v) => memory.set(k, v),
      };
      const repository = createLocalStorageRepository({
        context,
        storage,
        locks: { request: async (_key, _options, callback) => callback({}) },
        events: { addEventListener() {}, removeEventListener() {} },
      });
      await repository.load();
      const attempt = structuredClone(originalAttempt),
        template = structuredClone(originalTemplate);
      mutate(attempt, template);
      let accepted = false,
        error = null;
      try {
        await repository.commit({
          type: 'saveEnrollment',
          attempt,
          template,
          expectedEnrollmentRevision: 0,
          manifest: template.modelIdentity,
        });
        accepted = true;
      } catch (e) {
        error = e.message;
      }
      repository.dispose();
      rows.push({ name, expected, accepted, error });
    }
    return rows;
  });
  await page.evaluate((rows) => (window.__qaRepositoryResults = rows), rows);
  expect(
    rows.filter((row) => row.accepted !== row.expected),
    JSON.stringify(rows, null, 2),
  ).toEqual([]);
  return rows;
}

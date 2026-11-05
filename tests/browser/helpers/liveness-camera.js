import { expect } from '@playwright/test';

// These fixtures replace observations, never the meter reducer or repository validator.
export async function installMeterCamera(
  page,
  { faces = 1, unavailable = false, initializationDelay = 0 } = {},
) {
  await page.addInitScript(
    ({ faces, unavailable, initializationDelay }) => {
      window.__meterFixture = {
        visible: Array.from({ length: faces }, (_, i) => i),
        yaw: [0, 0],
        eye: [0, 0],
        expression: [0, 0],
        quality: [true, true],
        reverse: false,
        unavailable,
        poseCalls: 0,
        comparisons: 0,
        initializations: [],
        box: (i) => [50 + i * 320, 100, 160, 190],
      };
      const fixture = window.__meterFixture;
      Object.defineProperties(window, {
        __yaw: { get: () => fixture.yaw[0], set: (v) => (fixture.yaw[0] = v) },
        __eye: { get: () => fixture.eye[0], set: (v) => (fixture.eye[0] = v) },
        __faces: {
          get: () => fixture.visible.length,
          set: (v) => (fixture.visible = Array.from({ length: v }, (_, i) => i)),
        },
        __visible: { get: () => fixture.visible, set: (v) => (fixture.visible = v) },
        __yaws: { get: () => fixture.yaw, set: (v) => (fixture.yaw = v) },
      });
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        const paint = () => {
          ctx.fillStyle = '#aaa';
          ctx.fillRect(0, 0, 640, 480);
        };
        paint();
        const timer = setInterval(paint, 33),
          stream = canvas.captureStream(30);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
        return stream;
      };
      window.Worker = class {
        async postMessage({ requestId, id, type, payload }) {
          const f = window.__meterFixture;
          let result = true;
          if (id) {
            if (type === 'initialize') {
              f.initializations.push(payload);
              if (initializationDelay)
                await new Promise((resolve) => setTimeout(resolve, initializationDelay));
              if (f.unavailable) {
                this.onmessage?.({
                  data: { id, ok: false, error: 'Liveness fixture unavailable' },
                });
                return;
              }
              result = { sha256: 'a'.repeat(64) };
            } else {
              f.poseCalls++;
              // The per-face meter fields are installed by the pinned fixture interface.
              result = {
                faces: f.visible.map((i) => ({
                  box: f.box(i),
                  yaw: f.yaw[i],
                  pitch: 0,
                  eyeBlinkLeft: f.eye[i],
                  eyeBlinkRight: f.eye[i],
                  jawOpen: f.expression[i],
                  mouthSmileLeft: 0,
                  mouthSmileRight: 0,
                  jawMotion: 0.1 + f.expression[i] * 0.12,
                  smileMotion: 0.65,
                })),
              };
              if (f.reverse) result.faces.reverse();
            }
          } else {
            const manifest = await (await fetch('/models/model-manifest.json')).json();
            if (type === 'initialize') result = manifest;
            if (type === 'setGallery') this.gallery = payload;
            const detections = f.visible.map((i, detectionId) => ({
              detectionId,
              fixtureIndex: i,
              box: f.box(i),
              confidence: 0.99,
              reasonCode: f.quality[i] ? null : 'BLURRED_FACE',
              quality: { brightness: 120 },
            }));
            if (type === 'analyzeFrame')
              result = {
                faces: detections,
                faceEmbeddings: payload.includeEmbedding
                  ? detections.map((d) => ({
                      detectionId: d.detectionId,
                      embedding: Array.from({ length: 128 }, (_, n) =>
                        n === d.fixtureIndex ? 1 : 0,
                      ),
                    }))
                  : [],
                modelIdentity: manifest,
                preprocessingVersion: manifest.preprocessingVersion,
                quality: {},
                timingsMs: {},
              };
            if (type === 'detectFrame') {
              if (f.failDetection) {
                this.onmessage?.({
                  data: { requestId, ok: false, error: 'QA recognition failure' },
                });
                return;
              }
              const delay = f.nextDetectionDelay ?? 0;
              f.nextDetectionDelay = 0;
              if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
              result = { faces: detections };
            }
            if (type === 'extractFaces') {
              f.comparisons++;
              result = {
                frameId: payload.frameId,
                galleryVersion: payload.galleryVersion,
                results: payload.detectionIds.map((detectionId) => {
                  const entry = this.gallery?.entries.find(
                    (e) => e.embedding[f.visible[detectionId]] === 1,
                  );
                  return {
                    detectionId,
                    ranking: {
                      classification: entry ? 'IDENTIFIED' : 'UNKNOWN',
                      similarity: entry ? 1 : 0,
                      runnerUpSimilarity:
                        new Set(this.gallery.entries.map((e) => e.personId)).size === 1 ? null : 0,
                      margin:
                        new Set(this.gallery.entries.map((e) => e.personId)).size === 1
                          ? null
                          : entry
                            ? 1
                            : 0,
                      aboveThresholdCount: entry ? 1 : 0,
                      personId: entry?.personId ?? null,
                      templateId: entry?.templateId ?? null,
                      templateVersion: entry?.templateVersion ?? null,
                      closestCandidate: entry
                        ? {
                            personId: entry.personId,
                            templateId: entry.templateId,
                            templateVersion: entry.templateVersion,
                            similarity: 1,
                          }
                        : null,
                    },
                  };
                }),
              };
            }
          }
          if (!this.stopped) this.onmessage?.({ data: { requestId, id, ok: true, result } });
        }
        terminate() {
          this.stopped = true;
        }
      };
    },
    { faces, unavailable, initializationDelay },
  );
}

export const database = (page) =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      ),
    ),
  );

export async function configureChallenge(
  page,
  { turnLeft = true, turnRight = false, blink = false } = {},
) {
  await page.goto('/settings');
  for (const [label, value] of [
    ['Turn left', turnLeft],
    ['Turn right', turnRight],
    ['Blink', blink],
  ])
    await page.getByLabel(label, { exact: true }).setChecked(value);
  await page.getByLabel('Save small capture thumbnails', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
}

export async function seedKnownPeople(page, count = 1) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith('stk:face-prototype:')),
      ),
    )
    .toBe(true);
  await page.evaluate(async (count) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const db = JSON.parse(localStorage.getItem(key));
    const manifest = await (await fetch('/models/model-manifest.json')).json();
    for (let i = 0; i < count; i++) {
      db.people.push({
        id: `legacy-person-${i}`,
        companyId: db.scope.companyId,
        storeId: null,
        displayName: `Legacy ${i}`,
        employeeCode: `L${i}`,
        normalizedEmployeeCode: `l${i}`,
        acknowledgedAt: new Date().toISOString(),
        enrollmentRevision: 1,
        primaryTemplateId: `legacy-template-${i}`,
      });
      db.templates.push({
        id: `legacy-template-${i}`,
        personId: `legacy-person-${i}`,
        companyId: db.scope.companyId,
        storeId: null,
        label: 'Historical sample',
        version: 1,
        embedding: Array.from({ length: 128 }, (_, n) => (n === i ? 1 : 0)),
        modelIdentity: manifest,
        preprocessingVersion: manifest.preprocessingVersion,
        enrollmentSource: 'live_camera',
        enrollmentLiveness: 'passed_basic',
        thumbnailDataUrl: null,
      });
    }
    localStorage.setItem(key, JSON.stringify(db));
  }, count);
  await page.reload();
}

export async function holdSignals(page, indices, patch, duration = 400) {
  await page.evaluate(
    ({ indices, patch }) => {
      for (const [key, value] of Object.entries(patch))
        for (const i of indices) window.__meterFixture[key][i] = value;
    },
    { indices, patch },
  );
  await page.waitForTimeout(duration);
}

export async function completeMeter(page, indices = [0], family = 'blink') {
  // At least 2 seconds of actual callbacks; event phases are sampled, never inferred.
  await holdSignals(page, indices, { yaw: 0, eye: 0, expression: 0 }, 1400);
  await holdSignals(page, indices, { yaw: 8 }, 450);
  await holdSignals(page, indices, { yaw: 0 }, 450);
  if (family === 'blink') {
    await holdSignals(page, indices, { eye: 1 }, 180);
    await holdSignals(page, indices, { eye: 0 }, 350);
  } else {
    await holdSignals(page, indices, { expression: 0.6 }, 450);
    await holdSignals(page, indices, { expression: 0 }, 450);
  }
}

export async function completeChallenge(
  page,
  indices = [0],
  { blink = false, right = false } = {},
) {
  if (blink) {
    await holdSignals(page, indices, { eye: 0, yaw: 0 }, 1200);
    await holdSignals(page, indices, { eye: 1 }, 180);
    await holdSignals(page, indices, { eye: 0 }, 400);
  } else {
    await holdSignals(page, indices, { yaw: 25 }, 500);
    await holdSignals(page, indices, { yaw: 0 }, 500);
    if (right) {
      await holdSignals(page, indices, { yaw: -25 }, 500);
      await holdSignals(page, indices, { yaw: 0 }, 500);
    }
  }
}
export async function completeChecks(page, indices = [0]) {
  await completeMeter(page, indices);
  await completeChallenge(page, indices);
}

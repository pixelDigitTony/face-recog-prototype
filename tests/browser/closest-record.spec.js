import { test, expect } from '@playwright/test';

test('each tracked face shows its own closest photo, inclusive green state and advisory lighting', async ({
  page,
}) => {
  // Deterministic recognition responses cover exact boundaries; real models remain
  // covered separately by identification.spec.js and native-parity tests.
  await page.addInitScript(() => {
    window.scanScenario = 'low';
    window.scanComparisonBatches = 0;
    window.scanDetectionBatches = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#aaa';
      ctx.fillRect(0, 0, 640, 480);
      setInterval(() => ctx.fillRect(0, 0, 640, 480), 100);
      return canvas.captureStream(10);
    };
    window.Worker = class {
      async postMessage({ requestId, type, payload }) {
        let result = true;
        if (type === 'initialize')
          result = await (await fetch('/models/model-manifest.json')).json();
        if (type === 'setGallery') this.gallery = payload;
        if (type === 'detectFrame') {
          window.scanDetectionBatches++;
          const x = window.scanJitterX;
          result = {
            faces: (window.scanScenario === 'gone' ? [] : [0, 1]).map((i) => ({
              detectionId: i,
              box: [i === 0 && x != null ? x : i * 290 + 30, 180, 160, 180],
              confidence: 0.99,
              landmarks: [],
              reasonCode: window.scanScenario === 'quality' ? 'BLURRED_FACE' : null,
              quality: {
                lighting: {
                  version: 'lighting-feedback-v1',
                  warnings: i === 0 ? ['LOW_LIGHT'] : ['UNEVEN_LIGHTING'],
                },
              },
            })),
          };
        }
        if (type === 'extractFaces') {
          window.scanComparisonBatches++;
          result = {
            frameId: payload.frameId,
            galleryVersion: payload.galleryVersion,
            results: payload.detectionIds.map((detectionId) => {
              const entry =
                this.gallery.entries[window.scanScenario === 'conflict' ? 0 : detectionId];
              const score = window.scanScenario === 'low' ? 0.72 : 0.85;
              const accepted = score >= 0.85;
              return {
                detectionId,
                ranking: {
                  classification: accepted ? 'IDENTIFIED' : 'UNKNOWN',
                  similarity: score,
                  runnerUpSimilarity: 0.1,
                  margin: score - 0.1,
                  aboveThresholdCount: accepted ? 1 : 0,
                  personId: accepted ? entry.personId : null,
                  templateId: accepted ? entry.templateId : null,
                  templateVersion: accepted ? entry.templateVersion : null,
                  closestCandidate: {
                    personId: entry.personId,
                    templateId: entry.templateId,
                    templateVersion: entry.templateVersion,
                    similarity: score,
                  },
                },
              };
            }),
          };
        }
        if (!this.stopped) this.onmessage?.({ data: { requestId, ok: true, result } });
      }
      terminate() {
        this.stopped = true;
      }
    };
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/scan');
  await expect(page.getByRole('button', { name: 'Start scanning', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const db = JSON.parse(localStorage.getItem(key));
    const manifest = await (await fetch('/models/model-manifest.json')).json();
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, 40, 40);
    for (const i of [0, 1]) {
      db.people.push({
        id: `p${i}`,
        displayName: `Closest ${i}`,
        employeeCode: `C-${i}`,
        normalizedEmployeeCode: `c-${i}`,
        companyId: db.scope.companyId,
        storeId: null,
        acknowledgedAt: new Date().toISOString(),
        enrollmentRevision: 1,
        primaryTemplateId: `t${i}`,
      });
      db.templates.push({
        id: `t${i}`,
        personId: `p${i}`,
        companyId: db.scope.companyId,
        storeId: null,
        label: 'Original sample',
        version: 1,
        embedding: Array.from({ length: 128 }, (_, n) => (n === i ? 1 : 0)),
        modelIdentity: manifest,
        preprocessingVersion: manifest.preprocessingVersion,
        qualityPolicyVersion: manifest.qualityPolicyVersion,
        enrollmentSource: 'live_camera',
        enrollmentLiveness: 'passed_basic',
        thumbnailDataUrl: i === 0 ? canvas.toDataURL('image/jpeg', 0.4) : null,
      });
    }
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const labels = page.getByTestId('face-label'),
    boxes = page.getByTestId('face-box');
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(labels).toHaveCount(2);
  await expect(labels.nth(0)).toContainText('Closest 0 (C-0)');
  await expect(labels.nth(1)).toContainText('Closest 1 (C-1)');
  await expect(labels.nth(0)).toContainText('Closest record — unconfirmed');
  await expect(labels.nth(0)).toContainText('Below 85%');
  await expect(labels.nth(0)).toContainText('Low light');
  await expect(labels.nth(1)).toContainText('Uneven lighting');
  await expect(list.getByRole('img', { name: 'Enrollment photo of Closest 0' })).toBeVisible();
  await expect(list.getByRole('img', { name: 'No enrollment photo' })).toBeVisible();
  await expect(boxes.nth(0)).toHaveCSS('border-top-color', 'rgb(255, 191, 71)');
  await expect(
    page.getByRole('list', { name: 'Recent scan results' }).getByRole('listitem'),
  ).toHaveCount(2);
  await page.screenshot({ path: '.local/closest-record-amber-desktop.png', fullPage: true });
  // Create a lost old box, then overlap it and its replacement. This previously
  // produced a new ID every frame and prevented any stable match window.
  await page.evaluate(() => {
    window.scanJitterX = 170;
  });
  const detectionsBeforeShift = await page.evaluate(() => window.scanDetectionBatches);
  await expect
    .poll(() => page.evaluate(() => window.scanDetectionBatches))
    .toBeGreaterThan(detectionsBeforeShift);
  await page.evaluate(() => {
    window.scanJitterX = 100;
  });
  await page.evaluate(() => {
    window.scanScenario = 'exact';
  });
  await expect(list).toContainText('Recognized: Closest 0');
  await expect(list).toContainText('Recognized: Closest 1');
  await expect(boxes.nth(0)).toHaveCSS('border-top-color', 'rgb(112, 227, 154)');
  await expect(labels.nth(0)).toContainText('Low light'); // advisory does not change acceptance
  await expect(list).toContainText('Tracking confirmed face');
  const heldIds = await boxes.evaluateAll((els) => els.map((e) => e.dataset.trackId));
  const counts = await page.evaluate(() => {
    window.scanScenario = 'quality';
    return { detection: window.scanDetectionBatches, comparison: window.scanComparisonBatches };
  });
  await expect
    .poll(() => page.evaluate(() => window.scanDetectionBatches))
    .toBeGreaterThan(counts.detection + 12);
  expect(await page.evaluate(() => window.scanComparisonBatches)).toBe(counts.comparison);
  expect(await boxes.evaluateAll((els) => els.map((e) => e.dataset.trackId))).toEqual(heldIds);
  await expect(list).toContainText('Recognized: Closest 0');
  await expect(list).toContainText('Confirmed similarity: 85.00%');
  await expect(boxes.nth(0)).toHaveCSS('border-top-color', 'rgb(112, 227, 154)');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const preview = document
          .querySelector('[data-testid="live-camera"]')
          .getBoundingClientRect();
        return [...document.querySelectorAll('[data-testid="face-label"]')].every((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.left >= preview.left &&
            r.right <= preview.right &&
            r.top >= preview.top &&
            r.bottom <= preview.bottom
          );
        });
      }),
    )
    .toBe(true);
  await page.screenshot({ path: '.local/closest-record-green-mobile.png', fullPage: true });
  const labelRects = await labels.evaluateAll((els) =>
    els
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right };
      })
      .sort((a, b) => a.left - b.left),
  );
  expect(labelRects[0].right).toBeLessThanOrEqual(labelRects[1].left);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    window.scanScenario = 'gone';
  });
  await expect(boxes).toHaveCount(0);
  await page.evaluate(() => {
    window.scanScenario = 'conflict';
  });
  await expect(labels.nth(0)).toContainText('Identity conflict');
  await expect(labels.nth(1)).toContainText('Closest 0 (C-0)');
  await expect(boxes.nth(0)).toHaveCSS('border-top-color', 'rgb(255, 191, 71)');
  await page.evaluate(() => {
    window.scanScenario = 'quality';
  });
  await expect(list.getByTestId('closest-record')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(boxes).toHaveCount(0);
  const events = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
        ),
      ).identificationEvents,
  );
  expect(events.filter((e) => e.outcome === 'UNKNOWN').every((e) => e.personId === null)).toBe(
    true,
  );
  expect(events.filter((e) => e.outcome === 'IDENTIFIED').map((e) => e.similarity)).toEqual([
    0.85, 0.85,
  ]);
  expect(JSON.stringify(events)).not.toContain('closestCandidate');
  expect(events.every((e) => e.decisionPolicyVersion === 'identify-85-multisample-v3')).toBe(true);
  expect(errors).toEqual([]);
});

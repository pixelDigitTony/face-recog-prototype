import { test, expect } from '@playwright/test';

test('multiple references, evaluation and tracking work on desktop and mobile', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
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
        const face = {
          detectionId: 0,
          box: [100, 120, 160, 180],
          confidence: 0.99,
          landmarks: [],
          reasonCode: null,
          quality: { brightness: 120 },
        };
        if (type === 'analyzeFrame')
          result = {
            faces: [face],
            embedding: Array.from({ length: 128 }, (_, i) => (i === 2 ? 1 : 0)),
            quality: { faceCount: 1 },
          };
        if (type === 'detectFrame') result = { faces: [face] };
        if (type === 'extractFaces') {
          const entry = this.gallery.entries.find((e) => e.embedding[2] === 1);
          result = {
            frameId: payload.frameId,
            galleryVersion: payload.galleryVersion,
            results: [
              {
                detectionId: 0,
                ranking: {
                  classification: 'IDENTIFIED',
                  similarity: 1,
                  runnerUpSimilarity: 0,
                  margin: 1,
                  aboveThresholdCount: 1,
                  personId: entry.personId,
                  templateId: entry.templateId,
                  templateVersion: entry.templateVersion,
                  closestCandidate: {
                    personId: entry.personId,
                    templateId: entry.templateId,
                    templateVersion: entry.templateVersion,
                    similarity: 1,
                  },
                },
              },
            ],
          };
        }
        if (!this.stopped) this.onmessage?.({ data: { requestId, ok: true, result } });
      }
      terminate() {
        this.stopped = true;
      }
    };
  });
  await page.goto('/enroll');
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const db = JSON.parse(localStorage.getItem(key)),
      manifest = await (await fetch('/models/model-manifest.json')).json();
    for (let i = 0; i < 2; i++) {
      db.people.push({
        id: `p${i}`,
        displayName: `Person ${i}`,
        employeeCode: `E${i}`,
        normalizedEmployeeCode: `e${i}`,
        companyId: db.scope.companyId,
        acknowledgedAt: new Date().toISOString(),
        primaryTemplateId: `t${i}`,
        enrollmentRevision: 5,
      });
      for (let j = 0; j < (i === 0 ? 5 : 1); j++)
        db.templates.push({
          id: j ? `alternate${j}` : `t${i}`,
          personId: `p${i}`,
          companyId: db.scope.companyId,
          version: j + 1,
          label: j === 1 ? 'With makeup' : `Reference ${j}`,
          createdAt: new Date().toISOString(),
          embedding: Array.from({ length: 128 }, (_, n) => (n === (j === 1 ? 2 : i) ? 1 : 0)),
          modelIdentity: manifest,
          preprocessingVersion: manifest.preprocessingVersion,
          enrollmentSource: 'live_camera',
          enrollmentLiveness: 'passed_basic',
          thumbnailDataUrl: null,
        });
    }
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'E0 · Person 0' }).click();
  await expect(page.getByText('Person 0 · 5/5 face samples')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start live scan', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Replace this sample', exact: true }).nth(1).click();
  await expect(page.getByRole('button', { name: 'Start live scan', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Use Add face sample', exact: true }).click();
  await page.getByRole('button', { name: 'Delete sample', exact: true }).last().click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByText('Person 0 · 4/5 face samples')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start live scan', exact: true })).toBeEnabled();
  await page.goto('/evaluate');
  await page.getByLabel('Actual person').click();
  await page.getByRole('option', { name: 'Person 0 (E0)' }).click();
  await page.getByLabel('Appearance / lighting notes').fill('With makeup / soft frontal light');
  await page.getByRole('button', { name: 'Start trial', exact: true }).click();
  await expect(page.getByText('New webcam trial · 1/100 saved')).toBeVisible();
  await expect(page.getByText(/All samples: correct/)).toBeVisible();
  await expect(page.getByText(/Primary only: missed/)).toBeVisible();
  const table = page.getByRole('table', { name: 'Experimental threshold comparison' });
  await expect(table.getByRole('row')).toHaveCount(17);
  await page.screenshot({ path: '.local/multi-sample-evaluation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const navRects = await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link')
    .evaluateAll((links) =>
      links.map((link) => {
        const r = link.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
  for (let i = 1; i < navRects.length; i++)
    expect(navRects[i].left).toBeGreaterThanOrEqual(navRects[i - 1].right);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/multi-sample-evaluation-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByText('New webcam trial · 1/100 saved')).toBeVisible();
  await page.getByRole('button', { name: 'Rerun against current gallery', exact: true }).click();
  await expect(page.getByText('Current report', { exact: false })).toBeVisible();
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Detected faces' })).toContainText(
    'Recognized: Person 0',
  );
  await expect(page.getByTestId('face-label')).toContainText('With makeup');
  await expect(page.getByTestId('face-label')).toContainText('Tracking confirmed face');
  const saved = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      ),
    ),
  );
  expect(saved.identificationEvents[0].templateId).toBe('alternate1');
  expect(saved.identificationEvents[0].eligibleCount).toBe(2);
  expect(saved.identificationEvents[0].eligibleSampleCount).toBe(5);
  expect(saved.settings.matchThreshold).toBe(0.85);
  expect(saved.attempts).toHaveLength(0);
  expect(saved.evaluationTrials[0].report.modes.all).toHaveLength(1);
  expect(errors).toEqual([]);
});

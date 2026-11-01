import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.addInitScript(() => {
    window.__faces = 1;
    window.__yaw = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#aaa';
      ctx.fillRect(0, 0, 640, 480);
      const timer = setInterval(() => ctx.fillRect(0, 0, 640, 480), 40),
        stream = c.captureStream(25);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
    window.Worker = class {
      async postMessage({ requestId, id, type, payload }) {
        let result;
        if (id)
          result =
            type === 'initialize'
              ? { sha256: 'pose-test' }
              : { yaw: window.__yaw, box: [100, 100, 180, 200] };
        else if (type === 'initialize')
          result = await (await fetch('/models/model-manifest.json')).json();
        else if (type === 'analyzeFrame')
          result = {
            faces: Array.from({ length: window.__faces }, (_, i) => ({
              box: [100 + i * 250, 100, 180, 200],
              confidence: 0.99,
              reasonCode: null,
              quality: { brightness: 120 },
            })),
            embedding:
              payload.includeEmbedding && window.__faces === 1
                ? Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0))
                : null,
            faceEmbeddings:
              payload.includeEmbedding && payload.analyzeAllFaces
                ? Array.from({ length: window.__faces }, (_, i) => ({
                    detectionId: i,
                    embedding: Array.from({ length: 128 }, (_, n) =>
                      n === (window.__sameIdentity ? 0 : i) ? 1 : 0,
                    ),
                  }))
                : [],
            modelIdentity: await (await fetch('/models/model-manifest.json')).json(),
            preprocessingVersion: (await (await fetch('/models/model-manifest.json')).json())
              .preprocessingVersion,
            quality: {},
            timingsMs: {},
          };
        if (!this.stopped) this.onmessage?.({ data: { requestId, id, ok: true, result } });
      }
      terminate() {
        this.stopped = true;
      }
    };
  });
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
  await page.getByLabel('Turn left', { exact: true }).uncheck();
  await page.getByLabel('Turn right', { exact: true }).uncheck();
  await page.getByLabel('Save small capture thumbnails', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.goto('/enroll');
}
const database = (page) =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      ),
    ),
  );

for (const mobile of [false, true])
  test(`name in match panel automatically enrolls a detected unknown face ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await setup(page);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add person', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use test image', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
    const input = page.getByLabel("Detected person's name", { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('Anthony');
    expect((await database(page)).people).toHaveLength(0);
    await page.screenshot({
      path: `.local/automatic-enrollment-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await input.press('Enter');
    await expect(page.getByText('ENROLLED', { exact: true })).toBeVisible();
    let db = await database(page);
    expect(db.people).toHaveLength(1);
    expect(db.people[0].displayName).toBe('Anthony');
    expect(db.templates).toHaveLength(1);
    await page.getByRole('button', { name: 'Start next capture', exact: true }).click();
    await expect(page.getByText('Already enrolled: Anthony.', { exact: false })).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add face sample', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Add face sample', exact: true }).click();
    await expect.poll(async () => (await database(page)).templates.length).toBe(2);
    db = await database(page);
    expect(db.people).toHaveLength(1);
    expect(db.attempts).toHaveLength(2);
    expect(errors).toEqual([]);
  });

test('each name remains attached to its own track as other people enter and leave', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const input = page.getByLabel("Detected person's name", { exact: true });
  await input.fill('Stale name');
  await page.evaluate(() => (window.__faces = 2));
  await expect(input).toHaveCount(0);
  await expect(page.getByTestId('face-box')).toHaveCount(2);
  await expect(page.getByLabel('Name for Face #1', { exact: true })).toHaveValue('Stale name');
  await expect(page.getByLabel('Name for Face #2', { exact: true })).toHaveValue('');
  await page.evaluate(() => (window.__faces = 1));
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('Stale name');
  expect((await database(page)).people).toHaveLength(0);
});

for (const mobile of [false, true])
  test(`enrollment independently analyzes multiple faces ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page);
    await page.evaluate(async () => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
        db = JSON.parse(localStorage.getItem(key));
      const manifest = await (await fetch('/models/model-manifest.json')).json();
      db.people.push({
        id: 'known',
        companyId: db.scope.companyId,
        displayName: 'Known person',
        employeeCode: 'K1',
        normalizedEmployeeCode: 'k1',
        acknowledgedAt: new Date().toISOString(),
        enrollmentRevision: 1,
      });
      db.templates.push({
        id: 'known-face',
        personId: 'known',
        companyId: db.scope.companyId,
        version: 1,
        label: 'Known reference',
        embedding: Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0)),
        modelIdentity: manifest,
        preprocessingVersion: manifest.preprocessingVersion,
        enrollmentSource: 'live_camera',
        enrollmentLiveness: 'passed_basic',
        thumbnailDataUrl: null,
      });
      localStorage.setItem(key, JSON.stringify(db));
    });
    await page.reload();
    await page.evaluate(() => (window.__faces = 2));
    await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
    const analyses = page.getByTestId('enrollment-face-analysis');
    await expect(analyses).toHaveCount(2);
    await expect(analyses.nth(0)).toContainText('Recognized: Known person');
    await expect(analyses.nth(0)).toContainText('100.00%');
    await expect(analyses.nth(1)).toContainText('0.00%');
    await expect(analyses.nth(1)).toContainText('Closest record — unconfirmed');
    const labels = page.getByTestId('face-label');
    await expect(labels.nth(0)).toContainText('100.00%');
    await expect(labels.nth(1)).toContainText('0.00%');
    await expect(page.getByRole('list', { name: 'Detected faces' })).toContainText(
      'Similarity: 0.00%',
    );
    await expect(page.getByLabel("Detected person's name", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `.local/enrollment-per-face-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    expect((await database(page)).attempts).toHaveLength(0);
    expect(errors).toEqual([]);
  });

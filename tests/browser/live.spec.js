import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('automatic enrollment saves once and the saved template matches with real SFace and simulated pose observations', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PROTOTYPE_URL),
    'The static camera fixture uses dev-only sample files.',
  );
  const reference = JSON.parse(await readFile('tests/fixtures/native-reference.json', 'utf8'));
  await page.addInitScript(
    ({ box }) => {
      const NativeWorker = window.Worker;
      window.testPoseCalls = 0;
      window.testAnalysisCalls = 0;
      // Only pose observations are simulated. YuNet, alignment and SFace stay real.
      window.Worker = class {
        constructor(url, options) {
          if (!String(url).includes('liveness.worker')) {
            const worker = new NativeWorker(url, options),
              post = worker.postMessage.bind(worker);
            worker.postMessage = (message, ...rest) => {
              if (message.type === 'analyzeFrame') window.testAnalysisCalls++;
              return post(message, ...rest);
            };
            return worker;
          }
          this.stopped = false;
          this.yaw = 0;
        }
        postMessage({ id, type }) {
          setTimeout(() => {
            if (this.stopped) return;
            let result = { sha256: '0'.repeat(64) };
            if (type !== 'initialize') {
              window.testPoseCalls++;
              const prompt =
                document.querySelector('[data-testid="face-instruction"]')?.textContent || '';
              const phase = performance.now() % 5000;
              const target = prompt.includes('head left')
                ? 25
                : prompt.includes('head right')
                  ? -25
                  : phase > 1800 && phase < 2400
                    ? 8
                    : 0;
              this.yaw += Math.max(-12.5, Math.min(12.5, target - this.yaw));
              const eye = phase > 3200 && phase < 3400 ? 1 : 0;
              result = {
                box,
                yaw: this.yaw,
                pitch: 0,
                eyeBlinkLeft: eye,
                eyeBlinkRight: eye,
                jawOpen: 0,
                mouthSmileLeft: 0,
                mouthSmileRight: 0,
                jawMotion: 0.1,
                smileMotion: 0.65,
              };
            }
            this.onmessage?.({ data: { id, ok: true, result } });
          }, 0);
        }
        terminate() {
          this.stopped = true;
        }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const image = await createImageBitmap(
          await (await fetch('/tests/fixtures/lena.jpg')).blob(),
        );
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d'),
          paint = () => ctx.drawImage(image, 0, 0, 512, 512);
        paint();
        setInterval(paint, 33);
        return canvas.captureStream(30);
      };
    },
    { box: reference.records['lena.jpg'].box },
  );
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const name = page.getByLabel("Detected person's name", { exact: true });
  await expect(name).toBeVisible({ timeout: 90000 });
  await name.fill('Live Match Fixture');
  await name.press('Enter');
  await expect(page.getByText('ENROLLED', { exact: true })).toBeVisible({ timeout: 90000 });
  const before = await page.evaluate(() => ({
    poses: window.testPoseCalls,
    frames: window.testAnalysisCalls,
  }));
  await expect
    .poll(() => page.evaluate(() => window.testAnalysisCalls), { timeout: 10000 })
    .toBeGreaterThan(before.frames + 6);
  expect(await page.evaluate(() => window.testPoseCalls)).toBeGreaterThan(before.poses);
  await page.screenshot({ path: '.local/enrollment-automatic-completed.png', fullPage: true });
  await page.getByRole('link', { name: 'Scan face', exact: true }).first().click();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Recent scan results' })).toContainText(
    'Recognized: Live Match Fixture',
    { timeout: 90000 },
  );
  const db = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      ),
    ),
  );
  expect(db.attempts.map((a) => a.outcome)).toEqual(['ENROLLED']);
  expect(db.identificationEvents[0].outcome).toBe('IDENTIFIED');
  expect(db.identificationEvents[0].similarity).toBeGreaterThan(0.99);
  await page.screenshot({ path: '.local/saved-template-match.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('real liveness worker loads local pinned model and returns pose evidence', async ({
  page,
}) => {
  test.skip(Boolean(process.env.PROTOTYPE_URL), 'Module-level test uses dev source imports.');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/scan');
  const result = await page.evaluate(async () => {
    const { createFaceLandmarkerAdapter } = await import(
      '/src/utils/hooks/faceRecognition/liveness/faceLandmarkerAdapter.js'
    );
    const adapter = createFaceLandmarkerAdapter(location.origin + '/');
    const manifest = await adapter.initialize();
    const image = await createImageBitmap(await (await fetch('/tests/fixtures/lena.jpg')).blob());
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pose = await adapter.observe(
      { data: data.data, width: data.width, height: data.height },
      1000,
    );
    adapter.dispose();
    image.close();
    return { pose, manifest };
  });
  expect(result.manifest.sha256).toHaveLength(64);
  expect(Number.isFinite(result.pose.yaw)).toBe(true);
  expect(result.pose.box).toHaveLength(4);
  expect(errors).toEqual([]);
});
test('live camera controls, multiple face overlay geometry and mobile layout', async ({
  page,
  context,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['camera']);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled({
    timeout: 90000,
  });
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.srcObject?.active), {
      timeout: 90000,
    })
    .toBe(true);
  await page.evaluate(
    () => (window.testTrack = document.querySelector('video').srcObject.getVideoTracks()[0]),
  );
  await page.screenshot({ path: '.local/live-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testTrack.readyState)).toBe('ended');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/live-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('enrollment discovery never offers a name or saves a blank camera', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['camera']);
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.srcObject?.active), {
      timeout: 90000,
    })
    .toBe(true);
  await expect(page.getByLabel("Detected person's name", { exact: true })).toHaveCount(0);
  await expect(page.getByText('No current face detections.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/enrollment-no-face-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/enrollment-no-face-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
test('missing liveness model blocks named enrollment explicitly', async ({ page }) => {
  await page.route('**/models/face_landmarker.task', (route) =>
    route.fulfill({ status: 404, body: 'Missing liveness model' }),
  );
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (String(url).includes('liveness.worker')) return new NativeWorker(url, options);
      }
      async postMessage({ requestId, type, payload }) {
        let result = true;
        if (type === 'initialize')
          result = await (await fetch('/models/model-manifest.json')).json();
        if (type === 'analyzeFrame')
          result = {
            faces: [{ box: [100, 100, 180, 200], confidence: 0.99, reasonCode: null, quality: {} }],
            embedding: payload.includeEmbedding
              ? Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0))
              : null,
          };
        if (!this.stopped) this.onmessage?.({ data: { requestId, ok: true, result } });
      }
      terminate() {
        this.stopped = true;
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext('2d');
      setInterval(() => ctx.fillRect(0, 0, 640, 480), 100);
      return c.captureStream(10);
    };
  });
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const name = page.getByLabel("Detected person's name", { exact: true });
  await name.fill('Missing Model');
  await name.press('Enter');
  await expect(
    page.getByRole('alert').filter({
      hasText: /Liveness unavailable|Missing liveness asset|Missing liveness model|Missing model:/,
    }),
  ).toBeVisible({
    timeout: 90000,
  });
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
          ),
        ).people.length,
    ),
  ).toBe(0);
});

test('real YuNet draws every face in a streamed two-person fixture without saving frames', async ({
  page,
}) => {
  test.skip(Boolean(process.env.PROTOTYPE_URL), 'Camera fixture uses dev-only sample files.');
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = await createImageBitmap(await (await fetch('/tests/fixtures/lena.jpg')).blob());
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      const paint = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 1024, 1024);
        ctx.drawImage(image, 0, 0, 512, 512);
        ctx.drawImage(image, 512, 0, 512, 512);
      };
      paint();
      setInterval(paint, 100);
      return canvas.captureStream(10);
    };
  });
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          active: document.querySelector('video')?.srcObject?.active,
          ready: document.querySelector('video')?.readyState,
          hidden: document.hidden,
          text: document.querySelector('main')?.textContent,
        })),
      { timeout: 5000 },
    )
    .toMatchObject({ active: true });
  await expect(page.getByTestId('face-box')).toHaveCount(2, { timeout: 90000 });
  await expect(page.getByTestId('face-label')).toHaveCount(2);
  const camera = await page.getByTestId('live-camera').boundingBox();
  for (const label of await page.getByTestId('face-label').all()) {
    await expect(label.getByTestId('face-instruction')).toHaveCount(0);
    const details = await label.getByTestId('face-label-details').boundingBox();
    const bounds = await label.boundingBox();
    expect(details.y).toBeGreaterThanOrEqual(bounds.y);
    expect(bounds.x).toBeGreaterThanOrEqual(camera.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(camera.x + camera.width + 1);
    const trackId = await label.getAttribute('data-track-id');
    await expect(label.getByTestId('face-label-details')).toContainText(`Face #${trackId}`);
    await expect(page.locator(`[data-testid="face-box"][data-track-id="${trackId}"]`)).toHaveCount(
      1,
    );
  }
  await expect(
    page
      .getByRole('list', { name: 'Detected faces' })
      .getByText('No eligible enrollments', { exact: true }),
  ).toHaveCount(2);
  const records = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
        ),
      ).attempts,
  );
  expect(records).toHaveLength(0);
  await page.screenshot({ path: '.local/live-multiple-faces.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const bounds = await page.getByTestId('live-camera').boundingBox();
      const labels = await page.getByTestId('face-label').all();
      if (labels.length !== 2) return false;
      for (const label of labels) {
        const panel = await label.boundingBox();
        if (panel.x < bounds.x || panel.x + panel.width > bounds.x + bounds.width + 1) return false;
      }
      return true;
    })
    .toBe(true);
  for (const label of await page.getByTestId('face-label').all()) {
    await expect(label.getByTestId('face-instruction')).toHaveCount(0);
    const details = await label.getByTestId('face-label-details').boundingBox();
    const bounds = await label.boundingBox();
    expect(details.y).toBeGreaterThanOrEqual(bounds.y);
  }
  const mobilePanels = await Promise.all(
    (await page.getByTestId('face-label').all()).map((label) => label.boundingBox()),
  );
  mobilePanels.sort((a, b) => a.x - b.x);
  expect(mobilePanels[0].x + mobilePanels[0].width).toBeLessThanOrEqual(mobilePanels[1].x);
  await page.screenshot({ path: '.local/live-multiple-faces-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

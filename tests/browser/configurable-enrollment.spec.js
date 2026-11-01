import { test, expect } from '@playwright/test';

async function installFakeCamera(page) {
  await page.addInitScript(() => {
    window.__yaw = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#aaa';
      ctx.fillRect(0, 0, 640, 480);
      const timer = setInterval(() => ctx.fillRect(0, 0, 640, 480), 33);
      const stream = canvas.captureStream(30);
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
              : {
                  yaw: window.__yaw,
                  box: [100, 100, 180, 200],
                  eyeBlinkLeft: window.__eye ?? 0,
                  eyeBlinkRight: window.__eye ?? 0,
                };
        else if (type === 'initialize')
          result = await (await fetch('/models/model-manifest.json')).json();
        else if (type === 'analyzeFrame')
          result = {
            faces: [
              {
                box: [100, 100, 180, 200],
                confidence: 0.99,
                reasonCode: null,
                quality: { brightness: 120 },
              },
            ],
            embedding: payload.includeEmbedding
              ? Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0))
              : null,
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
}

for (const mobile of [false, true])
  test(`configurable liveness and guided enrollment ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installFakeCamera(page);
    await page.goto('/settings');
    await expect(page.getByText('Enrollment liveness', { exact: true })).toBeVisible();
    await page.getByLabel('Turn left', { exact: true }).uncheck();
    await page.getByLabel('Turn right', { exact: true }).uncheck();
    await page.getByLabel('Save small capture thumbnails', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Turn left', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Blink', { exact: true })).not.toBeChecked();
    await page.goto('/enroll');
    await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
    await page.getByLabel("Detected person's name", { exact: true }).fill('Test Person');
    await expect(page.getByRole('button', { name: 'Set as primary', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Guided set — three samples', exact: true }).click();
    await page.getByLabel("Detected person's name", { exact: true }).press('Enter');
    await expect(page.getByTestId('face-instruction').first()).toContainText('Turn slightly left');
    await page.evaluate(() => (window.__yaw = 15));
    await expect(page.getByTestId('face-instruction').first()).toContainText('Turn slightly right');
    await page.evaluate(() => (window.__yaw = -15));
    await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start live scan', exact: true })).toBeDisabled();
    await page.getByLabel('Sample 2 label', { exact: true }).fill('With makeup — slight left');
    await page.screenshot({
      path: `.local/configurable-enrollment-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Save three samples', exact: true }).click();
    await expect(page.getByText('Test Person · 3/5 face samples')).toBeVisible();
    await expect(page.getByText(/Enrollment review completed/)).toBeVisible();
    const saved = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
        ),
      ),
    );
    expect(saved.schemaVersion).toBe(5);
    expect(saved.attempts).toHaveLength(3);
    expect(
      saved.templates.every(
        (t) => t.enrollmentLiveness === 'not_checked' && t.thumbnailDataUrl === null,
      ),
    ).toBe(true);
    expect(saved.templates[1].label).toBe('With makeup — slight left');
    expect(errors).toEqual([]);
  });

test('blink-only enrollment uses independent observations and retains completion', async ({
  page,
}) => {
  await installFakeCamera(page);
  await page.goto('/settings');
  await page.getByLabel('Turn left', { exact: true }).uncheck();
  await page.getByLabel('Turn right', { exact: true }).uncheck();
  await page.getByLabel('Blink', { exact: true }).check();
  await page.getByLabel('Save small capture thumbnails', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.goto('/enroll');

  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const name = page.getByLabel("Detected person's name", { exact: true });
  await name.fill('Blink Person');
  await name.press('Enter');
  await expect(page.getByTestId('face-instruction').first()).toContainText('blink');
  // The closed phase must actually be sampled; a signal that falls between
  // observations must never be interpolated into a passing blink.
  await page.waitForTimeout(300);
  await page.evaluate(() => (window.__eye = 1));
  await page.waitForTimeout(180);
  await page.evaluate(() => (window.__eye = 0));
  await expect(page.getByText('ENROLLED', { exact: true })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByText('Blink Person · 1/5 face samples')).toBeVisible();
  const attempt = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
        ),
      ).attempts[0],
  );
  expect(attempt.livenessStatus).toBe('passed_basic');
  expect(attempt.liveness.configuration).toEqual({
    version: 1,
    turnLeft: false,
    turnRight: false,
    blink: true,
  });
  expect(attempt.liveness.steps.map((s) => s.direction)).toEqual(['blink']);
});

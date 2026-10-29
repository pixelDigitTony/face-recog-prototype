import { test, expect } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
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
test('camera enrollment loads both real workers and never passes a blank camera', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['camera']);
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByLabel('Employee code').fill('CAMERA-001');
  await page.getByLabel('Full name').fill('Camera Tester');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.srcObject?.active), {
      timeout: 90000,
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Capture & enroll', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Look straight ahead' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
test('missing liveness model blocks camera enrollment explicitly', async ({ page }) => {
  await page.route('**/models/face_landmarker.task', (route) =>
    route.fulfill({ status: 404, body: 'Missing liveness model' }),
  );
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByLabel('Employee code').fill('NO-LIVE');
  await page.getByLabel('Full name').fill('Missing Model');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  await expect(page.getByText(/Liveness unavailable:/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Capture & enroll', exact: true })).toBeDisabled();
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
  await page.goto('/scan');
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
  await expect(page.getByRole('list', { name: 'Detected faces' })).toContainText(
    'Multiple faces — verification paused',
  );
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
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

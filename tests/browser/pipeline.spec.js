import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

test('WASM pipeline agrees with native OpenCV and runs offline after initialization', async ({
  page,
  context,
}) => {
  test.skip(
    Boolean(process.env.PROTOTYPE_URL),
    'Source-level native parity runs against the development server.',
  );
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createBrowserFaceEngine } = await import(
      '/src/utils/hooks/faceRecognition/recognition/browserFaceEngine.js'
    );
    const engine = createBrowserFaceEngine(location.origin + '/');
    await engine.initialize();
    const frames = {};
    for (const name of ['lena.jpg', 'messi-large.png', 'messi5.jpg']) {
      const response = await fetch(`/tests/fixtures/${name}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      frames[name] = { data: frame.data, width: frame.width, height: frame.height };
      bitmap.close();
    }
    const results = {};
    for (const [name, frame] of Object.entries(frames))
      results[name] = await engine.extract(frame, { saveThumbnails: true });
    const blank = { width: 320, height: 320, data: new Uint8ClampedArray(320 * 320 * 4).fill(255) };
    results.blank = await engine.extract(blank);
    const faceImage = frames['lena.jpg'];
    const single = document.createElement('canvas');
    single.width = faceImage.width;
    single.height = faceImage.height;
    single
      .getContext('2d')
      .putImageData(new ImageData(faceImage.data, faceImage.width, faceImage.height), 0, 0);
    const double = document.createElement('canvas');
    double.width = faceImage.width * 2;
    double.height = faceImage.height * 2;
    const doubleCtx = double.getContext('2d');
    doubleCtx.drawImage(single, 0, 0);
    doubleCtx.drawImage(single, faceImage.width, 0);
    const doubleFrame = doubleCtx.getImageData(0, 0, double.width, double.height);
    results.multiple = await engine.extract({
      data: doubleFrame.data,
      width: doubleFrame.width,
      height: doubleFrame.height,
    });
    window.parityEngine = engine;
    window.parityFrame = frames['lena.jpg'];
    return results;
  });
  const reference = JSON.parse(await readFile('tests/fixtures/native-reference.json', 'utf8'));
  const report = {};
  for (const [browserName, nativeName] of [
    ['lena.jpg', 'lena.jpg'],
    ['messi-large.png', 'messi5.jpg'],
  ]) {
    const actual = result[browserName],
      expected = reference.records[nativeName];
    expect(actual.embedding).toHaveLength(128);
    const cosine = actual.embedding.reduce((sum, n, i) => sum + n * expected.embedding[i], 0);
    const landmarkError = Math.max(
      ...actual.quality.landmarks.flat().map((n, i) => Math.abs(n - expected.landmarks.flat()[i])),
    );
    report[browserName] = {
      cosineWithNative: cosine,
      maxLandmarkErrorPixels: landmarkError,
      timingsMs: actual.timingsMs,
      quality: actual.quality,
    };
    expect(cosine).toBeGreaterThan(0.995);
    expect(landmarkError).toBeLessThan(2);
  }
  const crossScore = result['lena.jpg'].embedding.reduce(
    (sum, n, i) => sum + n * result['messi-large.png'].embedding[i],
    0,
  );
  expect(crossScore).toBeLessThan(0.363);
  expect(result.blank.outcome).toBe('NO_FACE');
  expect(result['messi5.jpg'].outcome).toBe('LOW_QUALITY');
  expect(result.multiple.outcome).toBe('MULTIPLE_FACES');
  await context.setOffline(true);
  const offline = await page.evaluate(() => window.parityEngine.extract(window.parityFrame));
  expect(offline.embedding).toHaveLength(128);
  await context.setOffline(false);
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/parity-report.json',
    JSON.stringify({ ...report, differentPersonScore: crossScore, offline: true }, null, 2),
  );
});

test('a missing model reports a readiness error without inserting capture records', async ({
  page,
}) => {
  await page.route('**/models/face_recognition_sface_2021dec.onnx', (route) =>
    route.fulfill({ status: 404, body: 'Missing model' }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Use test image', exact: true }).click();
  await page.getByRole('button', { name: 'Load models', exact: true }).click();
  await expect(page.getByText(/Missing model:/)).toBeVisible({ timeout: 30000 });
  expect(
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
      return JSON.parse(localStorage.getItem(key)).attempts.length;
    }),
  ).toBe(0);
});

test('unsupported write coordination keeps the application read-only', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined });
  });
  await page.goto('/');
  await expect(page.getByText(/does not support Web Locks/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeDisabled();
});

test('corrupt storage preserves original data and scoped reset leaves other keys intact', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    localStorage.setItem('unrelated-stk-key', 'keep');
    const key = Object.keys(localStorage).find((key) => key.startsWith('stk:face-prototype:'));
    localStorage.setItem(key, '{corrupt');
  });
  await page.reload();
  await expect(page.getByText(/Use Settings to explicitly reset/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Reset prototype database', exact: true }).click();
  await page.getByRole('button', { name: 'Delete data', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('unrelated-stk-key'))).toBe('keep');
  await page.getByRole('link', { name: 'Enroll', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeEnabled();
});

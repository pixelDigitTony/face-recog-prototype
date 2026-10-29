import { test, expect } from '@playwright/test';
import path from 'node:path';

test('real browser enrollment, verification, database, reload and read-only tab', async ({
  page,
  context,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const network = [];
  page.on('request', (request) => network.push({ url: request.url(), method: request.method() }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Use test image', exact: true }).click();
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByLabel('Employee code').fill('TEST-001');
  await page.getByLabel('Full name').fill('Local Test Person');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  await page.getByLabel('Choose test image').setInputFiles(path.resolve('tests/fixtures/lena.jpg'));
  await page.getByRole('button', { name: 'Load models', exact: true }).click();
  await expect(page.getByText('Models ready', { exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Capture & enroll', exact: true }).click();
  await expect(page.getByText('DIAGNOSTIC ONLY', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/enrollment-desktop.png', fullPage: true });
  const key = await page.evaluate(() =>
    Object.keys(localStorage).find((key) => key.startsWith('stk:face-prototype:')),
  );
  const db = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  expect(db.templates[0].embedding).toHaveLength(128);
  expect(db.attempts).toHaveLength(1);
  expect(db.templates[0].thumbnailDataUrl.length).toBeLessThanOrEqual(4096);
  await page.getByRole('link', { name: 'Scan face', exact: true }).first().click();
  await page.getByRole('button', { name: 'Use test image', exact: true }).click();
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: /TEST-001/ }).click();
  await page.getByLabel('Choose test image').setInputFiles(path.resolve('tests/fixtures/lena.jpg'));
  if (await page.getByRole('button', { name: 'Load models', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Load models', exact: true }).click();
    await expect(page.getByText('Models ready', { exact: true })).toBeVisible({ timeout: 90000 });
  }
  await page.getByRole('button', { name: 'Scan face', exact: true }).click();
  await expect(page.getByText('DIAGNOSTIC ONLY', { exact: true })).toBeVisible({ timeout: 60000 });
  const matched = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).attempts.at(-1),
    key,
  );
  expect(matched.similarity).toBeGreaterThan(0.99);
  await page.getByRole('button', { name: 'Clear result', exact: true }).click();
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('stk:face-prototype:'))
        throw new DOMException('Test quota exceeded', 'QuotaExceededError');
      return window.originalStorageSet.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Scan face', exact: true }).click();
  await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).attempts.length, key),
  ).toBe(2);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalStorageSet;
  });
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).attempts.length, key),
  ).toBe(3);
  await page.getByRole('link', { name: 'Local database', exact: true }).first().click();
  await expect(page.getByRole('table')).toContainText('Local Test Person');
  await page.reload();
  await expect(page.getByRole('table')).toContainText('Local Test Person');
  await page.screenshot({ path: '.local/database-desktop.png', fullPage: true });
  const observer = await context.newPage();
  await observer.goto('/enroll');
  await expect(observer.getByText(/Another tab is editing/)).toBeVisible();
  await expect(observer.getByRole('button', { name: 'Add person', exact: true })).toBeDisabled();
  await observer.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/enroll');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.local/enrollment-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(
    network.every(
      (req) =>
        req.method === 'GET' &&
        new URL(req.url).origin ===
          new URL(process.env.PROTOTYPE_URL || 'http://127.0.0.1:5190').origin,
    ),
  ).toBe(true);
});

test('camera preview starts explicitly and releases its stream on navigation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['camera']);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start live scan', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.srcObject?.active), {
      timeout: 90000,
    })
    .toBe(true);
  await page.evaluate(() => {
    window.testTrack = document.querySelector('video').srcObject.getVideoTracks()[0];
  });
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Make the test your own.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.testTrack.readyState)).toBe('ended');
});

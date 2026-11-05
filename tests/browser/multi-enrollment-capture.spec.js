import { test, expect } from '@playwright/test';
import {
  installMeterCamera,
  configureChallenge,
  completeChecks,
} from './helpers/liveness-camera.js';
async function setup(page) {
  await installMeterCamera(page, { faces: 2 });
  await configureChallenge(page);
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
}
const database = (page) =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      ),
    ),
  );
async function name(page, id, value) {
  const field = page.getByLabel(`Name for Face #${id}`, { exact: true });
  await field.fill(value);
  await field.press('Enter');
}
for (const mobile of [false, true])
  test(`multiple people enroll simultaneously ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await setup(page);
    await expect(page.getByLabel('Name for Face #1', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Name for Face #2', { exact: true })).toBeEnabled();
    await name(page, 1, 'Alice');
    await name(page, 2, 'Bob');
    await completeChecks(page, [0, 1]);
    await expect.poll(async () => (await database(page)).people.length).toBe(2);
    const db = await database(page);
    expect(db.people.map((p) => p.displayName).sort()).toEqual(['Alice', 'Bob']);
    expect(db.templates).toHaveLength(2);
    expect(db.attempts.map((a) => a.trackId).sort()).toEqual([1, 2]);
    expect(
      db.attempts.every((a) => a.faceCountAtDecision === 2 && a.targetFaceCountAtDecision === 1),
    ).toBe(true);
    await expect(page.getByTestId('face-box')).toHaveCount(2);
    await page.screenshot({
      path: `.local/parallel-enrollment-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
test('one face’s sealed guided review remains available while another face saves', async ({
  page,
}) => {
  await setup(page);
  const alice = page
    .getByTestId('enrollment-face-analysis')
    .filter({ has: page.getByText('Face #1 · Current match similarity', { exact: true }) });
  await alice.getByRole('button', { name: 'Guided set — three samples', exact: true }).click();
  await name(page, 1, 'Alice');
  await name(page, 2, 'Bob');
  await completeChecks(page, [0, 1]);
  await expect(
    page.locator('[data-testid="face-label"][data-track-id="1"] [data-testid="face-instruction"]'),
  ).toContainText('Turn slightly left');
  await page.evaluate(() => (window.__yaws[0] = 15));
  await expect(
    page.locator('[data-testid="face-label"][data-track-id="1"] [data-testid="face-instruction"]'),
  ).toContainText('Turn slightly right');
  await page.evaluate(() => (window.__yaws[0] = -15));
  await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
  expect((await database(page)).people.map((p) => p.displayName)).toEqual(['Bob']);
  expect(await page.evaluate(() => document.querySelector('video').srcObject.active)).toBe(true);
  await page.getByLabel('Sample 2 label', { exact: true }).fill('Alice with makeup');
  await page.evaluate(() => (window.__visible = [1]));
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Sample 2 label', { exact: true })).toHaveValue('Alice with makeup');
  await page.getByRole('button', { name: 'Save three samples', exact: true }).click();
  await expect.poll(async () => (await database(page)).templates.length).toBe(4);
  const db = await database(page);
  expect(db.people).toHaveLength(2);
  expect(db.templates.find((t) => t.label === 'Alice with makeup')).toBeTruthy();
});
test('losing Alice does not interrupt Bob’s enrollment', async ({ page }) => {
  await setup(page);
  await name(page, 1, 'Alice');
  await name(page, 2, 'Bob');
  await page.evaluate(() => (window.__visible = [1]));
  await completeChecks(page, [1]);
  await expect
    .poll(async () => (await database(page)).people.map((p) => p.displayName))
    .toEqual(['Bob']);
  await expect(page.getByText('Enrollment saved for Bob.', { exact: true })).toBeVisible();
  expect((await database(page)).templates).toHaveLength(1);
});

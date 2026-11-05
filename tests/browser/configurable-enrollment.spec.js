import { test, expect } from '@playwright/test';
import {
  installMeterCamera,
  configureChallenge,
  database,
  completeChecks,
  completeMeter,
  completeChallenge,
  holdSignals,
} from './helpers/liveness-camera.js';

for (const mobile of [false, true])
  test(`configurable liveness and guided enrollment ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installMeterCamera(page);
    await configureChallenge(page);
    await page.reload();
    await expect(page.getByLabel('Turn left', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Turn right', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Blink', { exact: true })).not.toBeChecked();
    await page.goto('/enroll');
    await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
    const name = page.getByLabel("Detected person's name", { exact: true });
    await name.fill('Test Person');
    await page.getByRole('button', { name: /Guided set . three samples/ }).click();
    await name.press('Enter');
    await completeChecks(page);
    await expect(page.getByTestId('face-instruction').first()).toContainText('Turn slightly left');
    await holdSignals(page, [0], { yaw: 15 }, 1000);
    await expect(page.getByTestId('face-instruction').first()).toContainText('Turn slightly right');
    await holdSignals(page, [0], { yaw: -15 }, 1000);
    await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
    await page.getByLabel('Sample 2 label', { exact: true }).fill('With makeup - slight left');
    await page.screenshot({
      path: `.local/configurable-enrollment-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Save three samples', exact: true }).click();
    await expect(page.getByText('Test Person \u00b7 3/5 face samples')).toBeVisible();
    await expect(page.getByText(/Enrollment review completed/)).toBeVisible();
    const saved = await database(page);
    expect(saved.schemaVersion).toBe(5);
    expect(saved.attempts).toHaveLength(3);
    expect(
      saved.templates.every(
        (t) =>
          t.enrollmentLiveness === 'passed_basic' && t.thumbnailDataUrl === null && t.livenessMeter,
      ),
    ).toBe(true);
    expect(new Set(saved.attempts.map((a) => a.livenessMeter.enrollmentSessionId)).size).toBe(1);
    expect(saved.templates[1].label).toBe('With makeup - slight left');
    expect(errors).toEqual([]);
  });

test('blink-only prompted challenge does not replace meter and retains completion', async ({
  page,
}) => {
  await installMeterCamera(page);
  await configureChallenge(page, { turnLeft: false, blink: true });
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const name = page.getByLabel("Detected person's name", { exact: true });
  await name.fill('Blink Person');
  await name.press('Enter');
  await completeChallenge(page, [0], { blink: true });
  expect((await database(page)).templates).toHaveLength(0);
  await completeMeter(page);
  await expect(page.getByText('ENROLLED', { exact: true })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByText('Blink Person \u00b7 1/5 face samples')).toBeVisible();
  const attempt = (await database(page)).attempts[0];
  expect(attempt.livenessStatus).toBe('passed_basic');
  expect(attempt.liveness.configuration).toEqual({
    version: 1,
    turnLeft: false,
    turnRight: false,
    blink: true,
  });
  expect(attempt.liveness.steps.map((s) => s.direction)).toEqual(['blink']);
  expect(attempt.livenessMeter.status).toBe('passed_basic');
});

import { test, expect } from '@playwright/test';
import {
  installMeterCamera,
  seedKnownPeople,
  configureChallenge,
  database,
  holdSignals,
  completeMeter,
} from './helpers/liveness-camera.js';

const faceMeter = (page, id) =>
  page
    .getByRole('list', { name: 'Detected faces' })
    .locator(`li[data-track-id="${id}"]`)
    .getByTestId('liveness-meter');
const liveBar = (meter) =>
  meter.getByRole('progressbar', { name: 'Liveness evidence', exact: true });

test('live scores follow calculated movement and stay put without a timer reset', async ({
  page,
}) => {
  await installMeterCamera(page, { faces: 2 });
  await page.goto('/scan');
  await seedKnownPeople(page, 2);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).toContainText('Recognized: Legacy 1');
  const first = faceMeter(page, 1),
    second = faceMeter(page, 2);
  await expect(liveBar(first)).toHaveAttribute('aria-valuenow', '0');
  await expect(liveBar(second)).toHaveAttribute('aria-valuenow', '0');
  // Identity can confirm before the independent motion worker establishes open-eye baseline.
  await expect.poll(() => page.evaluate(() => window.__meterFixture.poseCalls)).toBeGreaterThan(12);
  await holdSignals(page, [0, 1], { eye: 0 }, 500);
  await holdSignals(page, [0], { eye: 1 }, 180);
  await holdSignals(page, [0], { eye: 0 }, 350);
  await expect(liveBar(first)).toHaveAttribute('aria-valuenow', '100');
  await expect(liveBar(second)).toHaveAttribute('aria-valuenow', '0');
  await holdSignals(page, [1], { yaw: 8 }, 500);
  await holdSignals(page, [1], { yaw: 0 }, 500);
  await expect(liveBar(second)).toHaveAttribute('aria-valuenow', '32');
  await holdSignals(page, [1], { eye: 1 }, 180);
  await holdSignals(page, [1], { eye: 0 }, 350);
  await expect(liveBar(second)).toHaveAttribute('aria-valuenow', '100');
  const comparisons = await page.evaluate(() => window.__meterFixture.comparisons);
  await page.waitForTimeout(15000);
  await expect(liveBar(first)).toHaveAttribute('aria-valuenow', '100');
  await expect(liveBar(second)).toHaveAttribute('aria-valuenow', '100');
  await holdSignals(page, [1], { eye: 0.7 }, 180);
  await holdSignals(page, [1], { eye: 0 }, 350);
  await expect(liveBar(second)).toHaveAttribute('aria-valuenow', '41');
  await expect(liveBar(first)).toHaveAttribute('aria-valuenow', '100');
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).toContainText('Recognized: Legacy 1');
  expect(await page.evaluate(() => window.__meterFixture.comparisons)).toBe(comparisons);
  expect((await database(page)).identificationEvents).toHaveLength(2);
  await expect(page.getByTestId('face-instruction')).toHaveCount(0);
  await page.screenshot({ path: '.local/live-movement-two-face-idle.png', fullPage: true });
});

test('jitter and box translation do not move the meter, and a held expression keeps its calculated score', async ({
  page,
}) => {
  await installMeterCamera(page);
  await page.goto('/scan');
  await seedKnownPeople(page);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const meter = faceMeter(page, 1);
  await expect(page.getByRole('list', { name: 'Detected faces' })).toContainText(
    'Recognized: Legacy 0',
  );
  await page.evaluate(() => {
    let step = 0;
    window.__qaJitterTimer = setInterval(() => {
      const direction = ++step % 2 ? 1 : -1;
      window.__meterFixture.yaw[0] = direction * 0.05;
      window.__meterFixture.expression[0] = step % 2 ? 0.001 : 0;
      window.__meterFixture.box = () => [100 + direction, 100, 160, 190];
    }, 100);
  });
  await page.waitForTimeout(2000);
  await expect(liveBar(meter)).toHaveAttribute('aria-valuenow', '0');
  await page.evaluate(() => clearInterval(window.__qaJitterTimer));
  await holdSignals(page, [0], { expression: 0.6, yaw: 0 }, 600);
  await expect(liveBar(meter)).toHaveAttribute('aria-valuenow', '72');
  await page.waitForTimeout(15000);
  await expect(liveBar(meter)).toHaveAttribute('aria-valuenow', '72');
  expect((await database(page)).identificationEvents).toHaveLength(1);
});

test('a still meter does not revoke completed enrollment checks or alter their capture proof', async ({
  page,
}) => {
  await installMeterCamera(page);
  await configureChallenge(page, { turnLeft: false, blink: true });
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const input = page.getByLabel("Detected person's name", { exact: true });
  await input.fill('Idle readiness');
  await input.press('Enter');
  await completeMeter(page);
  await holdSignals(page, [0], { yaw: 15 }, 350);
  const meter = faceMeter(page, 1);
  await expect(meter).toContainText('Basic motion checks met');
  expect((await database(page)).templates).toHaveLength(0);
  const acceptedText = await meter.innerText();
  const score = await liveBar(meter).getAttribute('aria-valuenow');
  expect(Number(score)).toBeGreaterThan(0);
  await page.waitForTimeout(15000);
  await expect(liveBar(meter)).toHaveAttribute('aria-valuenow', score);
  await expect(meter).toContainText('Basic motion checks met');
  await expect(page.getByTestId('face-instruction').first()).not.toContainText(/Step \d/);
  expect((await database(page)).templates).toHaveLength(0);
  await page.screenshot({ path: '.local/live-movement-retained-enrollment.png', fullPage: true });
  await holdSignals(page, [0], { yaw: 0 }, 1800);
  await expect.poll(async () => (await database(page)).templates.length).toBe(1);
  const db = await database(page);
  expect(db.attempts[0].livenessMeter).toEqual(db.templates[0].livenessMeter);
  expect(db.attempts[0].livenessMeter.policyVersion).toBe('motion-evidence-v1');
  expect(db.attempts[0].livenessMeter.acceptedScore).toBeGreaterThanOrEqual(60);
  expect(db.attempts[0].livenessStatus).toBe('passed_basic');
  expect(JSON.stringify(db)).not.toContain('live-movement-v');
  expect(acceptedText).toContain('Basic motion checks met');
});

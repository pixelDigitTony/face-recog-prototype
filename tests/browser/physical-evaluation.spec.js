import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  installMeterCamera,
  configureChallenge,
  database,
  completeMeter,
} from './helpers/liveness-camera.js';

async function choose(page, label, option, index = 0) {
  await page.getByRole('combobox', { name: label }).nth(index).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function setup(page, { faces = 1, unavailable = false, initializationDelay = 0 } = {}) {
  await installMeterCamera(page, { faces, unavailable, initializationDelay });
  await configureChallenge(page, { turnLeft: false, blink: true });
  await page.goto('/evaluate');
  await choose(page, 'Evaluation mode', 'Physical camera and spoof trials');
  await page.getByLabel('Trial / session label').fill('QA local trial');
  await page.getByLabel('Device label').fill('QA camera');
  await choose(page, 'Lighting condition', 'Even frontal light');
  await page.getByLabel('Appearance notes').fill('Normal appearance, fixture observations');
  await choose(page, 'Target duration', '15 seconds');
  if (faces > 1) await choose(page, 'Expected visible group size', String(faces));
  await page
    .getByRole('checkbox', {
      name: 'I confirm participants and presentations are authorized for local testing.',
    })
    .check();
}
async function label(page, index, name, truth, subtype) {
  await page.getByLabel('Participant / presentation label', { exact: true }).nth(index).fill(name);
  await choose(page, 'Ground truth', truth, index);
  if (subtype) await choose(page, 'Attack subtype', subtype);
}
const saved = async (page) => (await database(page)).physicalTrials ?? [];
const report = (page) =>
  page.evaluate(async () => {
    const { summarizePhysicalTrials } = await import(
      '/src/utils/hooks/faceRecognition/repositories/physicalTrial.js'
    );
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    return summarizePhysicalTrials(JSON.parse(localStorage.getItem(key)).physicalTrials ?? []);
  });

test('timed multi-face trial independently records basic checks, operator truth and genuine/attack denominators', async ({
  page,
}) => {
  await setup(page, { faces: 2 });
  await expect(page.getByText('Experimental motion-check results', { exact: true })).toBeVisible();
  await expect(page.getByText(/Unmeasured/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Start physical trial', exact: true }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Evaluation mode' })).toBeDisabled();
  await completeMeter(page, [0]);
  await expect(page.getByText('Review physical trial', { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByRole('button', { name: 'Save trial', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Ground truth' }).nth(0)).toContainText(
    'Unscored',
  );
  await label(page, 0, 'Person A', 'Genuine person');
  await label(page, 1, 'Print B', 'Attack presentation');
  await expect(page.getByRole('button', { name: 'Save trial', exact: true })).toBeDisabled();
  await choose(page, 'Attack subtype', 'stationary print');
  await page.getByRole('button', { name: 'Save trial', exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  const db = await database(page),
    t = db.physicalTrials[0];
  expect(t.completion).toBe('timed');
  expect(t.endTimestamp - t.startTimestamp).toBeGreaterThanOrEqual(15000);
  expect(t.segments).toHaveLength(2);
  const [genuine, attack] = t.segments;
  expect(genuine.combinedPassedAt).not.toBeNull();
  expect(genuine.meterProof.policyVersion).toBe('motion-evidence-v1');
  expect(attack.meterPassedAt).toBeNull();
  expect(attack.challengePassedAt).toBeNull();
  expect(attack.combinedPassedAt).toBeNull();
  expect(genuine.observationCount).toBeGreaterThan(12);
  expect(genuine.firstObservationAt).toBeLessThan(genuine.lastObservationAt);
  expect(t.camera.width).toBe(640);
  expect(db.people).toHaveLength(0);
  expect(db.templates).toHaveLength(0);
  expect(db.attempts).toHaveLength(0);
  expect(db.identificationEvents).toHaveLength(0);
  expect(db.evaluationTrials).toHaveLength(0);
  const r = await report(page);
  expect(r.genuine).toMatchObject({
    denominator: 1,
    meterPassed: 1,
    challengePassed: 1,
    combinedPassed: 1,
  });
  expect(r.attack).toMatchObject({
    denominator: 1,
    meterPassed: 0,
    challengePassed: 0,
    combinedPassed: 0,
  });
  expect(r.bySubtype.stationary_print.denominator).toBe(1);
  const rejectsExtraConfiguration = await page.evaluate(async (record) => {
    const { validatePhysicalTrial } = await import(
      '/src/utils/hooks/faceRecognition/repositories/physicalTrial.js'
    );
    record.configuration.rawFrames = [];
    for (const segment of record.segments)
      if (segment.challenge) segment.challenge.configuration.rawFrames = [];
    try {
      validatePhysicalTrial(record, { companyId: record.companyId, storeId: record.storeId });
      return false;
    } catch {
      return true;
    }
  }, t);
  expect(rejectsExtraConfiguration).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export physical trials', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(JSON.stringify(exported)).toContain(t.id);
  expect(JSON.stringify(t)).not.toMatch(/"(?:embedding|thumbnailDataUrl|imageData|landmarks)"\s*:/);
  await page.screenshot({ path: '.local/physical-trial-desktop.png', fullPage: true });
});

test('interrupted passing segment is not rejection evidence; quota retry reuses exact sealed data without inference', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Start physical trial', exact: true }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  await completeMeter(page);
  await page.getByRole('button', { name: 'Stop and review', exact: true }).click();
  await expect(page.getByText('Review physical trial', { exact: true })).toBeVisible();
  await label(page, 0, 'Interrupted genuine', 'Genuine person');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__physicalWrites = [];
    window.__failPhysicalSave = true;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('stk:face-prototype:') && JSON.parse(value).physicalTrials?.length) {
        window.__physicalWrites.push(JSON.parse(value).physicalTrials.at(-1));
        if (window.__failPhysicalSave)
          throw new DOMException('QA physical quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Save trial', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving trial', exact: true })).toBeVisible();
  await expect(page.getByLabel('Participant / presentation label', { exact: true })).toBeDisabled();
  expect(await saved(page)).toHaveLength(0);
  const calls = await page.evaluate(() => window.__meterFixture.poseCalls);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__meterFixture.poseCalls)).toBe(calls);
  await page.evaluate(() => (window.__failPhysicalSave = false));
  await page.getByRole('button', { name: 'Retry saving trial', exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  const writes = await page.evaluate(() => window.__physicalWrites);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  const r = await report(page);
  expect(r.genuine.denominator).toBe(0);
  expect(r.incomplete).toBe(1);
  expect(r.observedInterruptedPasses).toBe(1);
  await page.goto('/database');
  await page.getByRole('tab', { name: 'Physical trials (1)', exact: true }).click();
  await expect(page.getByText('QA local trial', { exact: true })).toBeVisible();
});

test('empty camera scene completes honestly and excludes initialization time from its measurement clock', async ({
  page,
}) => {
  await setup(page, { faces: 0, initializationDelay: 2500 });
  const started = Date.now();
  await page.getByRole('button', { name: 'Start physical trial', exact: true }).click();
  await expect(page.getByText('Review physical trial', { exact: true })).toBeVisible({
    timeout: 23000,
  });
  expect(Date.now() - started).toBeGreaterThan(17000);
  await expect(page.getByText('No face segments were measured.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save trial', exact: true })).toBeDisabled();
  expect(await saved(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Discard review', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start physical trial', exact: true }),
  ).toBeEnabled();
});

test('mobile physical review fits viewport and hiding interrupts camera work while retaining review', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole('button', { name: 'Start physical trial', exact: true }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('Review physical trial', { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => window.__meterFixture.poseCalls);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__meterFixture.poseCalls)).toBe(calls);
  expect(await page.locator('video').evaluate((v) => v.srcObject)).toBeNull();
  await expect(page.getByTestId('no-face-instruction')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '.local/physical-trial-mobile-review.png', fullPage: true });
});

test('navigation restores interrupted review, truth-first entry stays valid, and saved trials can be inspected and deleted', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Start physical trial', exact: true }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const calls = await page.evaluate(() => window.__meterFixture.poseCalls);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__meterFixture.poseCalls)).toBe(calls);
  await page.getByRole('link', { name: 'Evaluate recognition', exact: true }).click();
  await expect(page.getByText('Review physical trial', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Evaluation mode' })).toContainText(
    'Physical camera and spoof trials',
  );
  await choose(page, 'Ground truth', 'Genuine person');
  await expect(page.getByRole('button', { name: 'Save trial', exact: true })).toBeDisabled();
  await page
    .getByLabel('Participant / presentation label', { exact: true })
    .fill('Returned review');
  await page.getByRole('button', { name: 'Save trial', exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  await expect(page.getByRole('combobox', { name: 'Evaluation mode' })).toBeEnabled();
  await page.getByRole('link', { name: 'Local database', exact: true }).click();
  await page.getByRole('tab', { name: 'Physical trials (1)', exact: true }).click();
  await expect(page.getByText('QA local trial', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^View record / }).click();
  await expect(page.getByRole('dialog', { name: 'Stored record' })).toContainText(
    'physical-motion-evaluation-v1',
  );
  await expect(page.getByRole('dialog', { name: 'Stored record' })).toContainText(
    'Returned review',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Evaluate recognition', exact: true }).click();
  await choose(page, 'Evaluation mode', 'Physical camera and spoof trials');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete trial', exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(0);
});

test('missing motion model gives a setup error without measured rejection or camera work', async ({
  page,
}) => {
  await setup(page, { unavailable: true });
  await page.getByRole('button', { name: 'Start physical trial', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Liveness fixture unavailable' }).first(),
  ).toBeVisible();
  expect(await saved(page)).toHaveLength(0);
  expect(await page.evaluate(() => window.__meterFixture.poseCalls)).toBe(0);
  await expect(page.getByText('Review physical trial', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Start physical trial', exact: true }),
  ).toBeEnabled();
});

test('detector errors seal an interrupted physical review and stop both inference schedulers', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Start physical trial', exact: true }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.evaluate(() => (window.__meterFixture.failDetection = true));
  await expect(page.getByText('Review physical trial', { exact: true })).toBeVisible();
  await expect(page.getByText('Trial interrupted.', { exact: false })).toBeVisible();
  const calls = await page.evaluate(() => window.__meterFixture.poseCalls);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__meterFixture.poseCalls)).toBe(calls);
  expect(await page.locator('video').evaluate((v) => v.srcObject)).toBeNull();
  await label(page, 0, 'Interrupted attack', 'Attack presentation', 'display photo');
  await page.getByRole('button', { name: 'Save trial', exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  expect((await saved(page))[0].reason).toBe('detector_error');
  expect((await report(page)).attack.denominator).toBe(0);
});

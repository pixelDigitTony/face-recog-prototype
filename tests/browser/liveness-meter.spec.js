import { test, expect } from '@playwright/test';
import { checkRepositoryProof } from './helpers/liveness-proof.js';
import { writeFile } from 'node:fs/promises';
import {
  installMeterCamera,
  configureChallenge,
  seedKnownPeople,
  database,
  holdSignals,
  completeMeter,
  completeChallenge,
  completeChecks,
} from './helpers/liveness-camera.js';

test('new all-off settings fail inline while a historical all-off database loads and recovers', async ({
  page,
}) => {
  await installMeterCamera(page);
  await page.goto('/settings');
  await expect(
    page.getByText('Liveness evidence meter required for live enrollment', { exact: false }),
  ).toBeVisible();
  for (const label of ['Turn left', 'Turn right', 'Blink'])
    await page.getByLabel(label, { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(
    page.getByText('Enable at least one enrollment challenge in Settings', { exact: false }),
  ).toBeVisible();
  await page.reload();
  expect((await database(page)).settings.enrollmentLiveness.turnLeft).toBe(true);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const db = JSON.parse(localStorage.getItem(key));
    db.settings.enrollmentLiveness = {
      version: 1,
      turnLeft: false,
      turnRight: false,
      blink: false,
    };
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const name = page.getByLabel("Detected person's name", { exact: true });
  await name.fill('Blocked new capture');
  await name.press('Enter');
  await expect(
    page.getByText('Enable at least one enrollment challenge in Settings', { exact: false }),
  ).toBeVisible();
  expect((await database(page)).people).toHaveLength(0);
  expect((await database(page)).settings.enrollmentLiveness).toEqual({
    version: 1,
    turnLeft: false,
    turnRight: false,
    blink: false,
  });
  await configureChallenge(page);
  expect((await database(page)).settings.enrollmentLiveness.turnLeft).toBe(true);
});

test('Scan identity recognition survives unavailable motion analysis and does not invent evidence or history updates', async ({
  page,
}) => {
  await installMeterCamera(page, { unavailable: true });
  await page.goto('/scan');
  await seedKnownPeople(page);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).toContainText('Liveness unavailable');
  await expect(page.getByTestId('face-instruction')).toHaveCount(0);
  expect((await database(page)).identificationEvents).toHaveLength(1);
  const before = await page.evaluate(() => window.__meterFixture.comparisons);
  await page.waitForTimeout(2300);
  expect((await database(page)).identificationEvents).toHaveLength(1);
  expect(await page.evaluate(() => window.__meterFixture.comparisons)).toBe(before);
  const meters = page.getByTestId('liveness-meter');
  if (await meters.count()) expect(await meters.first().getAttribute('aria-valuenow')).toBeNull();
  await page.screenshot({ path: '.local/liveness-scan-unavailable-desktop.png', fullPage: true });
});

for (const mobile of [false, true])
  test(`independent meter and challenge gates, fresh Add/Replace, accessible Enroll ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installMeterCamera(page);
    await configureChallenge(page);
    await page.goto('/enroll');
    await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
    const card = page.getByTestId('enrollment-face-analysis').first();
    await expect(card).toContainText('Liveness evidence');
    // Unnamed preview can complete; confirming the name must discard its authority.
    await completeMeter(page);
    await expect(card).toContainText('Basic motion checks met');
    const name = page.getByLabel("Detected person's name", { exact: true });
    await name.fill('QA Motion Person');
    await name.press('Enter');
    await expect(card.getByTestId('liveness-meter').first()).not.toContainText(
      'Basic motion checks met',
    );
    // Challenge can finish without valid head meter event:25deg exceeds15deg meter limit.
    await holdSignals(page, [0], { yaw: 0 }, 1300);
    await completeChallenge(page);
    expect((await database(page)).templates).toHaveLength(0);
    await expect(card).toContainText('Liveness evidence');
    await completeMeter(page);
    await expect.poll(async () => (await database(page)).templates.length).toBe(1);
    const first = await database(page);
    expect(first.schemaVersion).toBe(5);
    expect(first.attempts[0].decisionPolicyVersion).toBe('enrollment-per-face-meter-v3');
    expect(first.attempts[0].livenessMeter.policyVersion).toBe('motion-evidence-v1');
    expect(first.attempts[0].livenessStatus).toBe('passed_basic');
    expect(first.templates[0].livenessMeter).toEqual(first.attempts[0].livenessMeter);
    if (!mobile) {
      const rows = await checkRepositoryProof(page);
      await writeFile('.local/liveness-repository-results.json', JSON.stringify(rows, null, 2));
    }
    const list = page.getByRole('list', { name: 'Detected faces' });
    await expect(list).toContainText('Liveness evidence');
    await expect(page.getByTestId('face-label').first()).toContainText('Liveness evidence');
    await page.screenshot({
      path: `.local/liveness-enroll-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const labelBounds = await page.getByTestId('face-label').evaluateAll((labels) =>
      labels.map((label) => {
        const outer = label.getBoundingClientRect();
        const preview = label.closest('[data-testid=live-camera]').getBoundingClientRect();
        const meter = label
          .querySelector('[data-testid=liveness-meter] [role=progressbar]')
          ?.getBoundingClientRect();
        return {
          inside:
            outer.left >= preview.left &&
            outer.right <= preview.right &&
            outer.top >= preview.top &&
            outer.bottom <= preview.bottom,
          meterVisible:
            !!meter &&
            meter.bottom <= outer.bottom &&
            meter.left >= outer.left &&
            meter.right <= outer.right,
        };
      }),
    );
    expect(
      labelBounds.every((row) => row.inside && row.meterVisible),
      JSON.stringify(labelBounds),
    ).toBe(true);
    await expect(card.getByRole('button', { name: 'Add face sample', exact: true })).toBeEnabled();
    await card.getByRole('button', { name: 'Add face sample', exact: true }).click();
    await expect(card.getByTestId('liveness-meter').first()).not.toContainText(
      'Basic motion checks met',
    );
    expect((await database(page)).templates).toHaveLength(1);
    await completeChecks(page);
    await expect.poll(async () => (await database(page)).templates.length).toBe(2);
    const second = await database(page);
    expect(second.attempts[1].livenessMeter.enrollmentSessionId).not.toBe(
      first.attempts[0].livenessMeter.enrollmentSessionId,
    );
    await card.getByRole('button', { name: 'Replace this sample', exact: true }).first().click();
    await expect(card).toContainText('Replacing:');
    await expect(
      card.getByRole('button', { name: 'Replace this sample', exact: true }),
    ).toHaveCount(3);
    await card.getByRole('button', { name: 'Replace this sample', exact: true }).last().click();
    await expect(
      card.getByRole('button', { name: 'Cancel enrollment for Face #1', exact: true }),
    ).toBeVisible();
    await expect(card.getByTestId('liveness-meter').first()).not.toContainText(
      'Basic motion checks met',
    );
    await completeChecks(page);
    await expect.poll(async () => (await database(page)).attempts.length).toBe(3);
    expect((await database(page)).templates).toHaveLength(2);
    expect(errors).toEqual([]);
  });

test('meter passes while challenge waits; quiet face latches, quality pauses and recovers, second track independent', async ({
  page,
}) => {
  await installMeterCamera(page, { faces: 2 });
  await configureChallenge(page);
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  for (const [id, value] of [
    [1, 'QA Alice'],
    [2, 'QA Bob'],
  ]) {
    const name = page.getByLabel(`Name for Face #${id}`, { exact: true });
    await name.fill(value);
    await name.press('Enter');
  }
  const alice = page.getByTestId('enrollment-face-analysis').first();
  await completeMeter(page, [0], 'expression');
  await expect(alice).toContainText('Basic motion checks met');
  expect((await database(page)).templates).toHaveLength(0);
  await page.evaluate(() => {
    window.__meterFixture.reverse = true;
    window.__meterFixture.quality[0] = false;
  });
  await expect(alice).toContainText(/paused|Cannot assess reliably/i);
  await page.waitForTimeout(2100);
  await page.evaluate(() => (window.__meterFixture.quality[0] = true));
  await expect(alice).toContainText('Basic motion checks met');
  await page.waitForTimeout(10500);
  await expect(alice).toContainText('Basic motion checks met');
  await completeChallenge(page, [0]);
  await expect
    .poll(async () => (await database(page)).people.map((p) => p.displayName))
    .toEqual(['QA Alice']);
  await expect(page.getByTestId('enrollment-face-analysis').nth(1)).not.toContainText(
    'Basic motion checks met',
  );
  await page.evaluate(() => (window.__meterFixture.visible = [1]));
  await completeChecks(page, [1]);
  await expect.poll(async () => (await database(page)).people.length).toBe(2);
  const db = await database(page);
  const proofs = db.attempts.map((a) => a.livenessMeter);
  expect(proofs[0].trackId).not.toBe(proofs[1].trackId);
  expect(proofs[0].acceptedScore).toBeGreaterThanOrEqual(60);
  expect(proofs[1].acceptedScore).toBeGreaterThanOrEqual(65);
});

test('confirmed Scan faces keep independent motion updates without challenge prompts or new identification events', async ({
  page,
}) => {
  await installMeterCamera(page);
  await page.goto('/scan');
  await seedKnownPeople(page);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(list).toContainText('Recognized: Legacy 0');
  const before = await page.evaluate(() => ({
    poses: window.__meterFixture.poseCalls,
    comparisons: window.__meterFixture.comparisons,
  }));
  await completeMeter(page);
  await expect(list).toContainText('Basic motion checks met');
  const after = await page.evaluate(() => ({
    poses: window.__meterFixture.poseCalls,
    comparisons: window.__meterFixture.comparisons,
  }));
  expect(after.poses).toBeGreaterThan(before.poses + 12);
  expect(after.comparisons).toBe(before.comparisons);
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(page.getByTestId('face-instruction')).toHaveCount(0);
  expect((await database(page)).identificationEvents).toHaveLength(1);
  expect((await database(page)).identificationEvents[0].livenessMeter).toBeUndefined();
  expect(
    await page.evaluate(() => window.__meterFixture.initializations.every((p) => p.meter)),
  ).toBe(true);
  await page.screenshot({ path: '.local/liveness-scan-confirmed-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/liveness-scan-confirmed-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).not.toContainText('Basic motion checks met');
});

test('one missing detection invalidates only that active meter even if its numeric track ID returns within challenge grace', async ({
  page,
}) => {
  await installMeterCamera(page, { faces: 2 });
  await configureChallenge(page);
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  for (const id of [1, 2]) {
    const input = page.getByLabel(`Name for Face #${id}`, { exact: true });
    await input.fill(`Continuity ${id}`);
    await input.press('Enter');
  }
  await completeMeter(page, [0, 1]);
  const first = page.locator('[data-testid="enrollment-face-analysis"][data-track-id="1"]');
  const second = page.locator('[data-testid="enrollment-face-analysis"][data-track-id="2"]');
  await expect(first).toContainText('Basic motion checks met');
  await expect(second).toContainText('Basic motion checks met');
  await page.evaluate(() => (window.__meterFixture.visible = [1]));
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  await page.evaluate(() => (window.__meterFixture.visible = [0, 1]));
  await expect(page.getByTestId('face-box')).toHaveCount(2);
  await expect(first).not.toContainText('Basic motion checks met');
  await expect(second).toContainText('Basic motion checks met');
  await completeChallenge(page, [0, 1]);
  await expect
    .poll(async () => (await database(page)).people.map((p) => p.displayName))
    .toEqual(['Continuity 2']);
  await completeMeter(page, [0]);
  await expect.poll(async () => (await database(page)).people.length).toBe(2);
});

test('sealed guided quota retry preserves exact proof and capture timestamps after camera disappearance', async ({
  page,
}) => {
  await installMeterCamera(page);
  await configureChallenge(page);
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const name = page.getByLabel("Detected person's name", { exact: true });
  await name.fill('Sealed Retry');
  await page.getByRole('button', { name: /Guided set . three samples/ }).click();
  await name.press('Enter');
  await completeChecks(page);
  await expect(page.getByTestId('face-instruction').first()).toContainText('Turn slightly left');
  await holdSignals(page, [0], { yaw: 15 }, 1100);
  await expect(page.getByTestId('face-instruction').first()).toContainText('Turn slightly right');
  await holdSignals(page, [0], { yaw: -15 }, 1100);
  await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__quotaWrites = [];
    window.__quotaFail = true;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('stk:face-prototype:')) {
        window.__quotaWrites.push(JSON.parse(value));
        if (window.__quotaFail) throw new DOMException('QA quota exceeded', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
    window.__meterFixture.visible = [];
  });
  await expect(page.getByTestId('face-box')).toHaveCount(0);
  await page.evaluate(() => (window.__meterFixture.visible = [0]));
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  await expect(page.getByTestId('face-label').first()).not.toContainText('Basic motion checks met');
  await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
  await page.evaluate(() => (window.__meterFixture.visible = []));
  await page.getByRole('button', { name: 'Save three samples', exact: true }).click();
  await expect(page.getByText(/QA quota exceeded/)).toBeVisible();
  expect((await database(page)).templates).toHaveLength(0);
  await page.waitForTimeout(1800);
  await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Review three samples', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  await page.evaluate(() => (window.__meterFixture.visible = [0]));
  await expect(page.getByTestId('face-box')).toHaveCount(1);
  const returnedTrack = await page.getByTestId('face-box').first().getAttribute('data-track-id');
  expect(returnedTrack).not.toBe('1');
  await expect(page.getByTestId('face-label').first()).not.toContainText('Basic motion checks met');
  await page.evaluate(() => (window.__quotaFail = false));
  await page.getByRole('button', { name: 'Save three samples', exact: true }).click();
  await expect.poll(async () => (await database(page)).templates.length).toBe(3);
  const writes = await page.evaluate(() => window.__quotaWrites);
  expect(writes).toHaveLength(2);
  expect(writes[0].attempts).toEqual(writes[1].attempts);
  expect(writes[0].templates).toEqual(writes[1].templates);
  const saved = await database(page);
  expect(new Set(saved.attempts.map((a) => a.livenessMeter.enrollmentSessionId)).size).toBe(1);
  expect(new Set(saved.attempts.map((a) => a.captureFrameTimestamp)).size).toBe(3);
  await page.screenshot({ path: '.local/liveness-guided-retry.png', fullPage: true });
});

test('Scan disappearance, stale extraction and hiding invalidate advisory evidence and stop camera work', async ({
  page,
}) => {
  await installMeterCamera(page);
  await page.goto('/scan');
  await seedKnownPeople(page);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(list).toContainText('Recognized: Legacy 0');
  await completeMeter(page);
  await expect(list).toContainText('Basic motion checks met');
  await page.evaluate(() => (window.__meterFixture.visible = []));
  await expect(page.getByTestId('face-box')).toHaveCount(0);
  await page.evaluate(() => (window.__meterFixture.visible = [0]));
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).not.toContainText('Basic motion checks met');
  await completeMeter(page);
  await expect(list).toContainText('Basic motion checks met');
  await page.evaluate(() => (window.__meterFixture.nextDetectionDelay = 1900));
  await expect(page.getByTestId('face-box')).toHaveCount(0);
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).not.toContainText('Basic motion checks met');
  await page.evaluate(() => {
    window.__qaCameraTrack = document.querySelector('video').srcObject.getVideoTracks()[0];
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.__qaCameraTrack.readyState)).toBe('ended');
  await expect(page.getByTestId('face-box')).toHaveCount(0);
  const calls = await page.evaluate(() => window.__meterFixture.poseCalls);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__meterFixture.poseCalls)).toBe(calls);
});

test('delayed Scan meter initialization stays neutral while recognition proceeds without prompts', async ({
  page,
}) => {
  await installMeterCamera(page, { initializationDelay: 3500 });
  await page.goto('/scan');
  await seedKnownPeople(page);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).toContainText('Starting liveness analysis');
  await expect(list).not.toContainText('Liveness unavailable');
  await expect(list.getByRole('progressbar', { name: 'Liveness evidence' })).toHaveCount(0);
  await expect(page.getByTestId('face-instruction')).toHaveCount(0);
  await expect(list).toContainText('Collecting motion evidence', { timeout: 7000 });
  expect((await database(page)).identificationEvents).toHaveLength(1);
});

test('new and historical capture history keeps motion evidence separate from enrollment challenge without backfill', async ({
  page,
}) => {
  await installMeterCamera(page);
  await configureChallenge(page);
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  const input = page.getByLabel("Detected person's name", { exact: true });
  await input.fill('History Person');
  await input.press('Enter');
  await completeChecks(page);
  await expect.poll(async () => (await database(page)).templates.length).toBe(1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const db = JSON.parse(localStorage.getItem(key));
    const a = structuredClone(db.attempts[0]),
      t = structuredClone(db.templates[0]);
    a.id = 'historical-all-off';
    a.templateId = 'historical-template';
    a.templateVersion = 2;
    a.decisionPolicyVersion = 'enrollment-per-face-liveness-v2';
    a.livenessStatus = 'not_checked';
    a.liveness.configuration = { version: 1, turnLeft: false, turnRight: false, blink: false };
    a.liveness.status = 'not_checked';
    a.liveness.reason = 'disabled_in_settings';
    a.liveness.steps = [];
    delete a.liveness.passedAt;
    delete a.livenessMeter;
    t.id = a.templateId;
    t.version = 2;
    t.label = 'Historical all-off sample';
    t.enrollmentLiveness = 'not_checked';
    t.liveness = structuredClone(a.liveness);
    delete t.livenessMeter;
    db.attempts.push(a);
    db.templates.push(t);
    db.people[0].enrollmentRevision = 2;
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.goto('/database');
  const table = page.getByRole('table', { name: 'Local database records' });
  await expect(
    table.getByRole('columnheader', { name: 'Motion evidence', exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole('columnheader', { name: 'Enrollment challenge', exact: true }),
  ).toBeVisible();
  const legacy = table.getByRole('row').filter({ hasText: 'enrollment-per-face-liveness-v2' });
  await expect(legacy).toContainText('Not recorded');
  await expect(legacy).toContainText('not_checked');
  const current = table.getByRole('row').filter({ hasText: 'enrollment-per-face-meter-v3' });
  await expect(current).toContainText('Basic motion checks met');
  await expect(current).toContainText('passed_basic');
  await page.getByRole('tab', { name: 'Templates (2)', exact: true }).click();
  await expect(table).toContainText('Historical all-off sample');
  await expect(table).toContainText('Not recorded');
  await page.reload();
  expect(
    (await database(page)).attempts.find((a) => a.id === 'historical-all-off').livenessMeter,
  ).toBeUndefined();
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Detected faces' })).toContainText(
    'Recognized: History Person',
  );
  await page.screenshot({ path: '.local/liveness-history-compatible.png', fullPage: true });
});

test('ambiguous crossed Scan boxes cannot transfer either track meter or identity', async ({
  page,
}) => {
  await installMeterCamera(page, { faces: 2 });
  await page.goto('/scan');
  await seedKnownPeople(page, 2);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).toContainText('Recognized: Legacy 1');
  await completeMeter(page, [0, 1]);
  await expect(
    list.getByTestId('liveness-meter').filter({ hasText: 'Basic motion checks met' }),
  ).toHaveCount(2);
  await page.evaluate(() => {
    window.__meterFixture.box = () => [200, 100, 160, 190];
    window.__meterFixture.reverse = true;
  });
  await expect(list).not.toContainText('Basic motion checks met');
  await expect(list).not.toContainText('Recognized:');
  await page.evaluate(() => (window.__meterFixture.box = (i) => [50 + i * 320, 100, 160, 190]));
  await expect(list).toContainText('Recognized: Legacy 0');
  await expect(list).toContainText('Recognized: Legacy 1');
  await expect(list).not.toContainText('Basic motion checks met');
});

for (const reason of ['camera disconnect', 'recognition failure', 'navigation'])
  test(`Scan tears down both observation schedulers after ${reason}`, async ({ page }) => {
    await installMeterCamera(page);
    await page.goto('/scan');
    await seedKnownPeople(page);
    await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Detected faces' })).toContainText(
      'Recognized: Legacy 0',
    );
    await page.evaluate(
      () => (window.__qaTrack = document.querySelector('video').srcObject.getVideoTracks()[0]),
    );
    if (reason === 'camera disconnect')
      await page.evaluate(() => window.__qaTrack.dispatchEvent(new Event('ended')));
    else if (reason === 'recognition failure')
      await page.evaluate(() => (window.__meterFixture.failDetection = true));
    else await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => window.__qaTrack.readyState)).toBe('ended');
    const before = await page.evaluate(() => window.__meterFixture.poseCalls);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__meterFixture.poseCalls)).toBe(before);
  });

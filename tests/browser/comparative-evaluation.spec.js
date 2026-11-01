import { test, expect } from '@playwright/test';

async function prepare(page) {
  await page.addInitScript(() => {
    window.__probe = 1;
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#aaa';
      ctx.fillRect(0, 0, 640, 480);
      const timer = setInterval(() => ctx.fillRect(0, 0, 640, 480), 60),
        stream = c.captureStream(15);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
    window.Worker = class {
      async postMessage({ requestId, type }) {
        let result = true;
        if (type === 'initialize')
          result = await (await fetch('/models/model-manifest.json')).json();
        if (type === 'analyzeFrame')
          result = {
            faces: [
              {
                box: [100, 100, 180, 200],
                confidence: 0.99,
                quality: { brightness: 120 },
                reasonCode: null,
              },
            ],
            embedding: Array.from({ length: 128 }, (_, i) => (i === 0 ? window.__probe : 0)),
            quality: {},
          };
        if (!this.stopped) this.onmessage?.({ data: { requestId, ok: true, result } });
      }
      terminate() {
        this.stopped = true;
      }
    };
  });
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const db = JSON.parse(localStorage.getItem(key)),
      manifest = await (await fetch('/models/model-manifest.json')).json();
    for (let p = 0; p < 2; p++) {
      db.people.push({
        id: `p${p}`,
        companyId: db.scope.companyId,
        displayName: `Person ${p}`,
        employeeCode: `E${p}`,
        normalizedEmployeeCode: `e${p}`,
        acknowledgedAt: new Date().toISOString(),
        enrollmentRevision: 5,
      });
      for (let n = 0; n < 5; n++) {
        const score = p ? 0.1 : n === 0 ? 0.8 : 0.92;
        db.templates.push({
          id: `p${p}s${n}`,
          personId: `p${p}`,
          companyId: db.scope.companyId,
          version: n + 1,
          label: `Reference ${n}`,
          createdAt: new Date().toISOString(),
          embedding: Array.from({ length: 128 }, (_, i) =>
            i === 0 ? score : i === p + 1 ? Math.sqrt(1 - score * score) : 0,
          ),
          modelIdentity: manifest,
          preprocessingVersion: manifest.preprocessingVersion,
          enrollmentSource: 'live_camera',
          enrollmentLiveness: 'passed_basic',
          thumbnailDataUrl: null,
        });
      }
    }
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.goto('/evaluate');
  await page.getByRole('combobox', { name: /^Evaluation mode/ }).click();
  await page.getByRole('option', { name: 'Compare 1 / 3 / 5 samples', exact: true }).click();
  await page.getByRole('button', { name: 'Load models for comparison', exact: true }).click();
  await page.getByLabel('Person 0 · 5 eligible samples', { exact: true }).check();
  await page.getByLabel('Person 1 · 5 eligible samples', { exact: true }).check();
  await page.getByRole('button', { name: 'Freeze reference plan', exact: true }).click();
  await expect(page.getByText(/Frozen plan · 1 \/ 3 \/ 5/)).toBeVisible();
}

for (const mobile of [false, true])
  test(`paired sample evaluation ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await prepare(page);
    await page.getByRole('combobox', { name: /^Actual person/ }).click();
    await page.getByRole('option', { name: 'Person 0', exact: true }).click();
    await page.getByLabel('Capture session label', { exact: true }).fill('Different day');
    await expect(
      page.getByRole('button', { name: 'Start comparison trial', exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel(
        'This test capture is separate from enrollment, not an enrollment image or frame',
        { exact: true },
      )
      .check();
    await page.getByRole('button', { name: 'Start comparison trial', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'completed' })).toBeVisible();
    await expect(
      page.getByText('Missed identification · Below threshold', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Correctly identified · Stable match', { exact: true }),
    ).toHaveCount(2);
    await expect(page.getByText(/1 → 3: 1 corrected misses/)).toBeVisible();
    await expect(page.getByText(/Unknown rejection performance is untested/)).toBeVisible();
    await page.evaluate(() => {
      window.__probe = -1;
    });
    await page.getByRole('combobox', { name: /^Actual person/ }).click();
    await page.getByRole('option', { name: 'Not enrolled', exact: true }).click();
    await page.getByLabel('Participant label', { exact: true }).fill('Visitor');
    await page
      .getByLabel('This participant is not enrolled anywhere in this scope', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Start comparison trial', exact: true }).click();
    await expect(page.getByText('unknown rejected', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Unknown rejected · Below threshold', { exact: true })).toHaveCount(
      3,
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export comparison report', exact: true }).click();
    const report = await (await download).createReadStream();
    let text = '';
    for await (const chunk of report) text += chunk.toString();
    const parsed = JSON.parse(text);
    expect(parsed.trials).toHaveLength(2);
    expect(text).not.toContain('"embedding"');
    await page.getByRole('combobox', { name: /^Filter lighting/ }).click();
    await page.getByRole('option', { name: 'normal', exact: true }).click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.screenshot({
      path: `.local/comparative-evaluation-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await page.reload();
    await page.getByRole('combobox', { name: /^Evaluation mode/ }).click();
    await page.getByRole('option', { name: 'Compare 1 / 3 / 5 samples', exact: true }).click();
    await page.getByRole('button', { name: 'Load models for comparison', exact: true }).click();
    await expect(
      page.getByText('Correctly identified · Stable match', { exact: true }),
    ).toHaveCount(2);
  });

test('comparison marks deleted reference historical and keeps enrollment curation evidence', async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole('combobox', { name: /^Actual person/ }).click();
  await page.getByRole('option', { name: 'Person 0', exact: true }).click();
  await page.getByLabel('Capture session label', { exact: true }).fill('Session two');
  await page
    .getByLabel('This test capture is separate from enrollment, not an enrollment image or frame', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Start comparison trial', exact: true }).click();
  await expect(page.getByText('Correctly identified · Stable match', { exact: true })).toHaveCount(
    2,
  );
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      db = JSON.parse(localStorage.getItem(key));
    db.templates = db.templates.filter((t) => t.id !== 'p0s0');
    db.people[0].enrollmentRevision++;
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await page.getByRole('combobox', { name: /^Evaluation mode/ }).click();
  await page.getByRole('option', { name: 'Compare 1 / 3 / 5 samples', exact: true }).click();
  await page.getByRole('button', { name: 'Load models for comparison', exact: true }).click();
  await expect(
    page.getByText('Historical recorded results (separate from current aggregates)', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('1 stale/excluded completed trials', { exact: true })).toBeVisible();
  await page.goto('/enroll');
  await page.getByRole('button', { name: 'Start live scan', exact: true }).click();
  await expect(page.getByText(/Start with one clear, front-facing sample/)).toBeVisible();
  await expect(page.getByText('Person 0 · 4/5 face samples', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Lighting: Not recorded · Capture set: Not recorded', { exact: true }),
  ).toHaveCount(4);
});

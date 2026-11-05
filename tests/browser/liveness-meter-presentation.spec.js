import { test, expect } from '@playwright/test';

test('meter presentation updates collecting values at most five times per second and exposes non-color states', async ({
  page,
}) => {
  await page.goto('/scan');
  await page.evaluate(async () => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default ?? ReactModule;
    const RootModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = RootModule.default ?? RootModule;
    const { LivenessMeter } = await import(
      '/src/features/face-recognition/components/LivenessMeter.jsx'
    );
    const host = document.createElement('div');
    host.id = 'qa-meter-host';
    document.body.append(host);
    const root = createRoot(host);
    window.__qaRenderMeter = (meter) => root.render(React.createElement(LivenessMeter, { meter }));
    window.__qaRenderMeter({ status: 'initializing' });
  });
  const host = page.locator('#qa-meter-host');
  await expect(host).toContainText('Starting liveness analysis');
  await expect(host.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(() => {
    window.__qaRenderMeter({
      status: 'collecting',
      score: 1,
      progress: { blink: 0, head: 0, expression: 0 },
    });
    window.__qaNumericChanges = [];
    window.__qaAnnouncementChanges = [];
    const host = document.getElementById('qa-meter-host');
    const observer = new MutationObserver(() => {
      const value = host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow');
      if (value !== window.__qaNumericChanges.at(-1)?.value)
        window.__qaNumericChanges.push({ value, at: performance.now() });
      const announcement = host.querySelector('[aria-live="polite"]')?.textContent;
      if (announcement !== window.__qaAnnouncementChanges.at(-1))
        window.__qaAnnouncementChanges.push(announcement);
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    let score = 1;
    window.__qaMeterTimer = setInterval(
      () =>
        window.__qaRenderMeter({
          status: 'collecting',
          score: ++score,
          progress: { blink: 1, head: 0, expression: 0 },
        }),
      50,
    );
    setTimeout(() => {
      clearInterval(window.__qaMeterTimer);
      observer.disconnect();
    }, 1300);
  });
  await page.waitForTimeout(1400);
  const changes = await page.evaluate(() => ({
    values: window.__qaNumericChanges,
    announcements: window.__qaAnnouncementChanges,
  }));
  expect(changes.values.length).toBeGreaterThan(3);
  expect(changes.values.length).toBeLessThanOrEqual(8);
  for (let i = 2; i < changes.values.length; i++)
    expect(changes.values[i].at - changes.values[i - 1].at).toBeGreaterThanOrEqual(180);
  expect(changes.announcements.filter(Boolean)).toEqual(['Collecting motion evidence']);
  await expect(
    host.getByRole('progressbar', { name: 'Liveness evidence', exact: true }),
  ).toHaveAttribute('aria-valuetext', /% - Collecting motion evidence/);
  await page.evaluate(() => {
    window.__qaStatusChanges = [];
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations)
        if (m.attributeName === 'data-status') window.__qaStatusChanges.push(performance.now());
    });
    observer.observe(document.getElementById('qa-meter-host'), { subtree: true, attributes: true });
    let index = 0;
    const statuses = ['collecting', 'insufficient_quality', 'unavailable', 'initializing'];
    const timer = setInterval(
      () => window.__qaRenderMeter({ status: statuses[index++ % 4], score: index }),
      50,
    );
    setTimeout(() => {
      clearInterval(timer);
      observer.disconnect();
    }, 1000);
  });
  await page.waitForTimeout(1100);
  expect((await page.evaluate(() => window.__qaStatusChanges)).length).toBeLessThanOrEqual(7);
  for (const [status, text, numeric] of [
    ['passed_basic', 'Basic motion checks met', true],
    ['insufficient_quality', 'Cannot assess reliably', true],
    ['unavailable', 'Liveness unavailable', false],
    ['invalidated', 'Rechecking liveness', false],
  ]) {
    await page.evaluate(
      ({ status }) =>
        window.__qaRenderMeter({
          status,
          score: 65,
          accepted: { passedAt: performance.now() },
          acceptedAt: '2026-11-03T10:00:00.000Z',
          progress: { blink: 3, head: 3, expression: 0 },
        }),
      { status },
    );
    await expect(host).toContainText(text);
    if (status === 'passed_basic') await expect(host).toContainText(/met at \d{1,2}:\d{2}/);
    await expect(host.getByRole('progressbar')).toHaveCount(numeric ? 1 : 0);
    await expect(host.locator('[aria-live="polite"]')).toContainText(text);
  }
  for (const [status, score, idle, color] of [
    ['collecting', 100, false, 'warning'],
    ['passed_basic', 100, false, 'success'],
    ['passed_basic', 0, true, 'warning'],
  ]) {
    await page.evaluate(
      ({ status, score, idle }) =>
        window.__qaRenderMeter({
          status,
          score: 65,
          acceptedAt: '2026-11-03T10:00:00.000Z',
          progress: { blink: 3, head: 3, expression: 0 },
          activity: {
            policyVersion: 'live-movement-v1',
            score,
            faceScore: score / 2,
            headScore: score / 2,
            lastMovementAt: idle ? null : 123,
            idle,
          },
        }),
      { status, score, idle },
    );
    const bar = host.getByRole('progressbar', { name: 'Liveness evidence', exact: true });
    await expect(bar).toHaveAttribute('aria-valuenow', String(score));
    await expect(bar).toHaveClass(
      new RegExp(`MuiLinearProgress-color${color === 'success' ? 'Success' : 'Warning'}`),
    );
    await expect(host).toContainText(`Face/blink ${score / 2}/50`);
    await expect(host).toContainText(`Head ${score / 2}/50`);
    await expect(host).toContainText(idle ? 'No recent movement' : 'Live movement');
    if (status === 'passed_basic') await expect(host).toContainText('Basic motion checks met');
  }
});

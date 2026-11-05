import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('worker configuration and observations preserve initialization order, drain and disposal', async ({
  page,
}) => {
  await page.goto('/scan');
  const rows = await page.evaluate(async () => {
    const { createFaceLandmarkerAdapter } = await import(
      '/src/utils/hooks/faceRecognition/liveness/faceLandmarkerAdapter.js'
    );
    const log = [],
      workers = [],
      rows = [];
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    window.Worker = class {
      constructor() {
        this.id = workers.length;
        this.ready = false;
        this.pending = [];
        workers.push(this);
      }
      postMessage({ id, type, payload }) {
        log.push({ worker: this.id, type, ready: this.ready, payload });
        if (type === 'initialize') {
          this.timer = setTimeout(() => {
            if (this.ended) return;
            this.ready = true;
            log.push({ worker: this.id, type: 'initialize-ack' });
            this.onmessage?.({ data: { id, ok: true, result: { sha256: 'a'.repeat(64) } } });
          }, 15);
        } else if (!this.ready) {
          this.onmessage?.({
            data: { id, ok: false, error: 'Observe posted before initialize acknowledgement' },
          });
        } else
          this.pending.push(() =>
            this.onmessage?.({ data: { id, ok: true, result: { faces: [] } } }),
          );
      }
      terminate() {
        this.ended = true;
        clearTimeout(this.timer);
        log.push({ worker: this.id, type: 'terminate' });
      }
    };
    const release = () =>
      workers.forEach((w) => {
        if (!w.ended) w.pending.splice(0).forEach((fn) => fn());
      });
    const settle = (p) => Promise.race([p, wait(1500).then(() => 'TIMEOUT')]);
    const frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const adapter = createFaceLandmarkerAdapter('/');
    const concurrent = await settle(
      Promise.allSettled([
        adapter.initialize({ meter: true, blink: false, numFaces: 1 }),
        adapter.initialize({ meter: true, blink: true, numFaces: 10 }),
      ]),
    );
    rows.push({
      name: 'concurrent configurations',
      pass: Array.isArray(concurrent) && concurrent.every((v) => v.status === 'fulfilled'),
    });
    const observing = adapter.observe(frame, 10);
    await wait(30);
    const before = log.length;
    const configuring = adapter.initialize({ meter: true, blink: false, numFaces: 1 });
    await wait(30);
    const drained = log.length === before;
    release();
    const drainResults = await settle(Promise.allSettled([observing, configuring]));
    rows.push({
      name: 'in-flight drain',
      pass:
        drained &&
        Array.isArray(drainResults) &&
        drainResults.every((v) => v.status === 'fulfilled'),
    });
    // Start both before observe has posted, exercising the await/queue boundary.
    const raceObserve = adapter.observe(frame, 15).then(
      () => 'ok',
      (e) => e.message,
    );
    const raceConfigure = adapter.initialize({ meter: true, blink: true, numFaces: 10 }).then(
      () => 'ok',
      (e) => e.message,
    );
    await wait(50);
    release();
    const race = await settle(Promise.all([raceObserve, raceConfigure]));
    rows.push({
      name: 'same-turn observe/reconfigure readiness',
      pass: Array.isArray(race) && race.every((v) => v === 'ok'),
      result: race,
    });
    const pending = adapter.observe(frame, 20).catch((e) => e.name);
    await wait(30);
    const queued = adapter
      .initialize({ meter: false, blink: false, numFaces: 1 })
      .catch((e) => e.name);
    adapter.dispose();
    const atDispose = log.length;
    const disposed = await settle(Promise.all([pending, queued]));
    await wait(30);
    rows.push({
      name: 'dispose cancels without revival',
      pass:
        Array.isArray(disposed) &&
        disposed.every((v) => v === 'AbortError') &&
        log.length === atDispose,
      result: disposed,
    });
    rows.push({
      name: 'all posted observations follow initialization acknowledgement',
      pass: log.filter((v) => v.type === 'observe').every((v) => v.ready),
      log,
    });
    return rows;
  });
  await writeFile('.local/liveness-adapter-results.json', JSON.stringify(rows, null, 2));
  expect(
    rows.filter((r) => !r.pass),
    JSON.stringify(rows, null, 2),
  ).toEqual([]);
});

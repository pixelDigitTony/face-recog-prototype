import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('browser reducer obeys numerical event boundaries and rejects adversarial traces', async ({
  page,
}) => {
  await page.goto('/scan');
  const results = await page.evaluate(async () => {
    const { createLivenessMeter } = await import(
      '/src/utils/hooks/faceRecognition/liveness/livenessMeter.js'
    );
    const { meterScore, meterQualifies } = await import(
      '/src/utils/hooks/faceRecognition/liveness/livenessMeterPolicy.js'
    );
    function runner() {
      const meter = createLivenessMeter({
        cameraSessionId: 'qa-camera',
        enrollmentSessionId: 'qa-enroll',
        trackId: 1,
        workerGeneration: 1,
        assetIdentity: 'a'.repeat(64),
      });
      let t = 0,
        sequence = 0;
      const observe = (patch = {}, step = 50) => {
        t += step;
        return meter.update({
          timestamp: t,
          sequence: ++sequence,
          sourceTrackId: 1,
          workerGeneration: 1,
          fresh: true,
          exclusive: true,
          yaw: 0,
          pitch: 0,
          eyeBlinkLeft: 0,
          eyeBlinkRight: 0,
          jawOpen: 0,
          mouthSmileLeft: 0,
          mouthSmileRight: 0,
          jawMotion: 0.1,
          smileMotion: 0.65,
          ...patch,
        });
      };
      const hold = (patch, duration, step = 50) => {
        for (let i = 0; i < duration; i += step) observe(patch, step);
      };
      const blink = () => {
        hold({}, 500);
        hold({ eyeBlinkLeft: 1, eyeBlinkRight: 1 }, 150);
        hold({}, 300);
      };
      const head = (peak = 8) => {
        hold({}, 500);
        hold({ yaw: peak }, 450);
        hold({}, 450);
      };
      const expression = (smile = false, motion = true) => {
        hold({}, 500);
        hold(
          smile
            ? { mouthSmileLeft: 0.6, mouthSmileRight: 0.6, smileMotion: motion ? 0.75 : 0.65 }
            : { jawOpen: 0.6, jawMotion: motion ? 0.18 : 0.1 },
          450,
        );
        hold({}, 450);
      };
      return { meter, observe, hold, blink, head, expression };
    }
    const rows = [];
    const result = (name, pass, details = null) => rows.push({ name, pass, details });
    for (const [name, progress, score, qualified] of [
      ['below60', { blink: 1, head: 2, expression: 2 }, 160 / 3, false],
      ['exact60', { blink: 0, head: 3, expression: 3 }, 60, true],
      ['blinkHead65', { blink: 3, head: 3, expression: 0 }, 65, true],
      ['blinkExpression75', { blink: 3, head: 0, expression: 3 }, 75, true],
      ['all100', { blink: 3, head: 3, expression: 3 }, 100, true],
      ['partialHigh', { blink: 2, head: 2, expression: 2 }, 200 / 3, false],
    ])
      result(
        name,
        Math.abs(meterScore(progress) - score) < 1e-8 && meterQualifies(progress) === qualified,
      );
    for (const pair of ['blink-head', 'head-jaw', 'head-smile', 'blink-jaw']) {
      const r = runner();
      r.hold({}, 1000);
      if (pair.includes('blink')) r.blink();
      if (pair.includes('head')) r.head();
      if (pair.includes('jaw')) r.expression();
      if (pair.includes('smile')) r.expression(true);
      r.hold({}, 200);
      const s = r.meter.snapshot();
      result(pair, s.status === 'passed_basic' && s.accepted.events.length >= 2, s);
    }
    for (const [name, action] of [
      ['constant', (r) => r.hold({}, 12000)],
      [
        'coefficient-only',
        (r) => {
          r.head();
          r.expression(false, false);
        },
      ],
      [
        'one-eye',
        (r) => {
          r.head();
          r.hold({ eyeBlinkLeft: 1 }, 150);
          r.hold({}, 300);
        },
      ],
      [
        'coefficient-spike',
        (r) => {
          r.head();
          r.observe({ jawOpen: 0.9, jawMotion: 0.2 });
          r.hold({}, 600);
        },
      ],
      [
        'large-gap',
        (r) => {
          r.head();
          r.observe({ eyeBlinkLeft: 1, eyeBlinkRight: 1 });
          r.observe({}, 201);
          r.hold({}, 400);
        },
      ],
      [
        'low-frame-rate',
        (r) => {
          r.hold({}, 2000, 250);
          r.hold({ yaw: 8 }, 500, 250);
          r.hold({}, 500, 250);
          r.hold({ eyeBlinkLeft: 1, eyeBlinkRight: 1 }, 250, 250);
          r.hold({}, 1000, 250);
        },
      ],
      [
        'wrong-track',
        (r) => {
          r.head();
          for (let n = 0; n < 10; n++)
            r.observe({
              sourceTrackId: 2,
              eyeBlinkLeft: n < 4 ? 1 : 0,
              eyeBlinkRight: n < 4 ? 1 : 0,
            });
        },
      ],
      [
        'wrong-generation',
        (r) => {
          r.head();
          for (let n = 0; n < 10; n++)
            r.observe({
              workerGeneration: 2,
              eyeBlinkLeft: n < 4 ? 1 : 0,
              eyeBlinkRight: n < 4 ? 1 : 0,
            });
        },
      ],
      [
        'NaN',
        (r) => {
          r.head();
          r.observe({ jawOpen: NaN });
          r.hold({}, 400);
        },
      ],
      [
        'nonexclusive',
        (r) => {
          r.head();
          r.observe({ exclusive: false });
          r.hold({}, 400);
        },
      ],
      [
        'duplicate-time',
        (r) => {
          r.head();
          for (let n = 0; n < 20; n++)
            r.observe({ timestamp: 1, eyeBlinkLeft: n < 4 ? 1 : 0, eyeBlinkRight: n < 4 ? 1 : 0 });
        },
      ],
      [
        'excessive-head',
        (r) => {
          r.head(25);
          r.blink();
        },
      ],
    ]) {
      const r = runner();
      r.hold({}, 1000);
      action(r);
      result(name, r.meter.snapshot().status !== 'passed_basic', r.meter.snapshot());
    }
    const expire = runner();
    expire.hold({}, 1000);
    expire.blink();
    expire.hold({}, 10500);
    expire.head();
    result(
      'event-expiry',
      expire.meter.snapshot().status !== 'passed_basic',
      expire.meter.snapshot(),
    );
    const latch = runner();
    latch.hold({}, 1000);
    latch.head();
    latch.blink();
    const accepted = latch.meter.snapshot().accepted;
    latch.hold({}, 15000);
    result(
      'latch-after10s',
      JSON.stringify(latch.meter.snapshot().accepted) === JSON.stringify(accepted) &&
        accepted !== null,
    );
    latch.meter.pause();
    const paused = latch.meter.snapshot();
    latch.hold({}, 400);
    result(
      'quality-recovery',
      paused.status === 'insufficient_quality' &&
        latch.meter.snapshot().status === 'passed_basic' &&
        JSON.stringify(latch.meter.snapshot().accepted) === JSON.stringify(accepted),
    );
    latch.meter.reset();
    result(
      'reset',
      latch.meter.snapshot().accepted === null &&
        latch.meter.snapshot().score === null &&
        latch.meter.snapshot().status === 'invalidated',
    );
    for (const [duration, expected] of [
      [79, false],
      [80, true],
    ]) {
      const r = runner();
      r.head();
      r.hold({}, 1000);
      r.observe({ eyeBlinkLeft: 0.6, eyeBlinkRight: 0.6 }, duration - 40);
      r.observe({ eyeBlinkLeft: 0.3, eyeBlinkRight: 0.3 }, 40);
      r.observe({ eyeBlinkLeft: 0.3, eyeBlinkRight: 0.3 }, 10);
      result(
        `blink-cycle-${duration}ms`,
        (r.meter.snapshot().accepted !== null) === expected,
        r.meter.snapshot(),
      );
    }
    const longBlink = runner();
    longBlink.head();
    longBlink.hold({}, 1000);
    longBlink.hold({ eyeBlinkLeft: 1, eyeBlinkRight: 1 }, 1400, 100);
    longBlink.observe({}, 50);
    longBlink.observe({}, 50);
    result(
      'blink-cycle1500ms',
      longBlink.meter.snapshot().accepted !== null,
      longBlink.meter.snapshot(),
    );
    const tooLongBlink = runner();
    tooLongBlink.head();
    tooLongBlink.hold({}, 1000);
    tooLongBlink.hold({ eyeBlinkLeft: 1, eyeBlinkRight: 1 }, 1500, 100);
    tooLongBlink.observe({}, 50);
    tooLongBlink.observe({}, 50);
    result(
      'blink-cycle-over1500ms',
      tooLongBlink.meter.snapshot().accepted === null,
      tooLongBlink.meter.snapshot(),
    );
    const countGate = runner();
    for (let i = 1; i <= 11; i++)
      countGate.observe(
        {
          yaw: i >= 4 && i <= 5 ? 8 : 0,
          eyeBlinkLeft: i === 4 || i === 5 ? 1 : 0,
          eyeBlinkRight: i === 4 || i === 5 ? 1 : 0,
        },
        200,
      );
    result(
      '11-observations-over2s-blocked',
      countGate.meter.snapshot().accepted === null,
      countGate.meter.snapshot(),
    );
    countGate.observe({}, 200);
    result(
      '12-observations-over2s-accepted',
      countGate.meter.snapshot().accepted?.observationCount === 12,
      countGate.meter.snapshot(),
    );
    const spanGate = runner();
    for (let i = 1; i <= 30; i++)
      spanGate.observe({
        yaw: i >= 8 && i <= 13 ? 8 : 0,
        eyeBlinkLeft: i === 10 || i === 11 ? 1 : 0,
        eyeBlinkRight: i === 10 || i === 11 ? 1 : 0,
      });
    result(
      '30-observations-under2s-blocked',
      spanGate.meter.snapshot().accepted === null,
      spanGate.meter.snapshot(),
    );
    spanGate.hold({}, 550);
    result(
      '2s-span-accepted',
      spanGate.meter.snapshot().accepted != null &&
        spanGate.meter.snapshot().accepted.passedAt -
          spanGate.meter.snapshot().accepted.startedAt >=
          2000,
      spanGate.meter.snapshot(),
    );
    return rows;
  });
  await writeFile('.local/liveness-numerical-results.json', JSON.stringify(results, null, 2));
  expect(
    results.filter((row) => !row.pass),
    JSON.stringify(
      results.filter((row) => !row.pass),
      null,
      2,
    ),
  ).toEqual([]);
});

test('production worker geometry rejects rigid transforms, box translation and landmark jitter on rectangular frames', async ({
  page,
}) => {
  await page.goto('/scan');
  const result = await page.evaluate(async () => {
    // Execute the exact classic-worker feature function, not a copied test formula.
    const source = await (await fetch('/src/workers/liveness.worker.js')).text();
    const start = source.indexOf('function expressionMotionFeatures(');
    if (start < 0) throw new Error('Production geometry helper not found');
    let end = source.indexOf('{', start),
      depth = 1;
    for (end++; depth > 0; end++) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
    }
    const features = new Function(`return (${source.slice(start, end)})`)();
    const { createLivenessMeter } = await import(
      '/src/utils/hooks/faceRecognition/liveness/livenessMeter.js'
    );
    const model = {
      33: [-100, 0, 0],
      263: [100, 0, 0],
      13: [0, 30, 0],
      14: [0, 50, 0],
      61: [-60, 40, 0],
      291: [60, 40, 0],
    };
    function points(angle = 0, scale = 1, translation = 0, jitter = 0) {
      const p = [];
      for (const [key, [x, y, z]] of Object.entries(model)) {
        const yawX = Math.cos(angle) * x + Math.sin(angle) * z;
        const yawZ = -Math.sin(angle) * x + Math.cos(angle) * z;
        const turnY = Math.cos(angle) * y - Math.sin(angle) * yawZ;
        const turnZ = Math.sin(angle) * y + Math.cos(angle) * yawZ;
        const noise = jitter * (Number(key) % 2 ? 1 : -1);
        p[key] = {
          x: (yawX * scale + 320 + translation + noise) / 640,
          y: (turnY * scale + 240 + translation + noise) / 480,
          z: (turnZ * scale + noise) / 640,
        };
      }
      return p;
    }
    const neutral = features(points(), 640, 480),
      transforms = [];
    for (const angle of [-0.8, -0.3, 0, 0.3, 0.8])
      for (const scale of [0.5, 1, 2])
        transforms.push(features(points(angle, scale, 50), 640, 480));
    const rigidInvariant = transforms.every(
      (f) =>
        Math.abs(f.jawMotion - neutral.jawMotion) < 1e-12 &&
        Math.abs(f.smileMotion - neutral.smileMotion) < 1e-12,
    );
    const meter = createLivenessMeter({
      cameraSessionId: 'rigid-camera',
      enrollmentSessionId: 'rigid-enroll',
      trackId: 1,
      workerGeneration: 1,
      assetIdentity: 'a'.repeat(64),
    });
    let timestamp = 0,
      sequence = 0;
    const observe = (yaw, expression, feature) =>
      meter.update({
        timestamp: (timestamp += 50),
        sequence: ++sequence,
        sourceTrackId: 1,
        workerGeneration: 1,
        fresh: true,
        exclusive: true,
        yaw,
        pitch: 0,
        eyeBlinkLeft: 0,
        eyeBlinkRight: 0,
        jawOpen: expression,
        mouthSmileLeft: expression,
        mouthSmileRight: expression,
        ...feature,
      });
    for (let i = 0; i < 30; i++) observe(0, 0, neutral);
    for (let i = 0; i < 10; i++) observe(8, 0, neutral);
    for (let i = 0; i < 10; i++) observe(0, 0, neutral);
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 10; i++) observe(0, 0.7, features(points(0.6, 1, i * 2, 0.1), 640, 480));
      for (let i = 0; i < 10; i++) observe(0, 0, neutral);
    }
    return { neutral, transforms, rigidInvariant, snapshot: meter.snapshot() };
  });
  await writeFile('.local/liveness-rigid-results.json', JSON.stringify(result, null, 2));
  expect(result.rigidInvariant).toBe(true);
  expect(result.snapshot.status).not.toBe('passed_basic');
  expect(result.snapshot.accepted).toBeNull();
});

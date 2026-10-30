import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('automatic multi-person identification uses real models without selection or liveness and persists unique events', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PROTOTYPE_URL),
    'Real camera fixtures and enrollment setup use dev-only sources.',
  );
  const errors = [],
    livenessRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (
      /face_landmarker\.task|liveness-manifest\.json|liveness\.worker|vision_wasm|vision_bundle/.test(
        r.url(),
      )
    )
      livenessRequests.push(r.url());
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const images = await Promise.all(
        JSON.parse(sessionStorage.getItem('test:identification-fixtures')).map(async (url) =>
          createImageBitmap(await (await fetch(url)).blob()),
        ),
      );
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      let tick = 0;
      const paint = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 640, 480);
        ctx.filter = 'brightness(1.01)';
        images.forEach((image, i) => ctx.drawImage(image, i * 320 + (++tick % 2), 40));
        ctx.filter = 'none';
      };
      paint();
      setInterval(paint, 100);
      return canvas.captureStream(10);
    };
  });
  await page.goto('/scan');
  await expect(page.getByRole('button', { name: 'Start scanning', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const { createBrowserFaceEngine } = await import(
      '/src/utils/hooks/faceRecognition/recognition/browserFaceEngine.js'
    );
    const key = Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:'));
    const db = JSON.parse(localStorage.getItem(key));
    const engine = createBrowserFaceEngine(location.origin + '/');
    await engine.initialize();
    const fixtures = [];
    // Test-only gallery setup. The app never seeds these enrollments.
    for (const [index, name] of ['lena.jpg', 'messi-large.png'].entries()) {
      const image = await createImageBitmap(await (await fetch(`/tests/fixtures/${name}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height);
      const original = await engine.extract({
        data: data.data,
        width: data.width,
        height: data.height,
      });
      const [x, y, w, h] = original.faces[0].box;
      const scale = index === 0 ? 2 : 3;
      const crop = document.createElement('canvas');
      crop.width = 320;
      crop.height = 400;
      crop
        .getContext('2d')
        .drawImage(
          image,
          x - (w * (scale - 1)) / 2,
          y - (h * (scale - 1)) / 2,
          w * scale,
          h * scale,
          0,
          0,
          320,
          400,
        );
      fixtures.push(crop.toDataURL());
      const enrollment = document.createElement('canvas');
      enrollment.width = 640;
      enrollment.height = 480;
      const enrollmentCtx = enrollment.getContext('2d');
      enrollmentCtx.fillStyle = 'white';
      enrollmentCtx.fillRect(0, 0, 640, 480);
      enrollmentCtx.drawImage(crop, index * 320, 40);
      const enrollmentData = enrollmentCtx.getImageData(0, 0, 640, 480);
      const extracted = await engine.extract(
        {
          data: enrollmentData.data,
          width: 640,
          height: 480,
        },
        { saveThumbnails: true },
      );
      if (!extracted.embedding)
        throw new Error(
          `Fixture ${index} did not yield a template: ${JSON.stringify({ outcome: extracted.outcome, reason: extracted.reasonCode, quality: extracted.quality })}`,
        );
      db.people.push({
        id: `p${index}`,
        companyId: db.scope.companyId,
        storeId: null,
        acknowledgedAt: new Date().toISOString(),
        displayName: `Fixture ${index}`,
        employeeCode: `AUTO-${index}`,
        normalizedEmployeeCode: `auto-${index}`,
        enrollmentRevision: 1,
        primaryTemplateId: `t${index}`,
        createdAt: new Date().toISOString(),
      });
      db.templates.push({
        id: `t${index}`,
        personId: `p${index}`,
        companyId: db.scope.companyId,
        storeId: null,
        label: 'Original sample',
        version: 1,
        embedding: extracted.embedding,
        modelIdentity: extracted.modelIdentity,
        preprocessingVersion: extracted.preprocessingVersion,
        qualityPolicyVersion: extracted.qualityPolicyVersion,
        enrollmentSource: 'live_camera',
        enrollmentLiveness: 'passed_basic',
        thumbnailDataUrl: extracted.thumbnailDataUrl ?? null,
      });
      image.close();
    }
    engine.dispose();
    sessionStorage.setItem('test:identification-fixtures', JSON.stringify(fixtures));
    localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByTestId('face-instruction')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(2, { timeout: 90000 });
  const list = page.getByRole('list', { name: 'Detected faces' });
  await expect(list).toContainText('Recognized: Fixture 0', { timeout: 90000 });
  await expect(list).toContainText('Recognized: Fixture 1', { timeout: 90000 });
  await expect(list.getByRole('img', { name: 'Enrollment photo of Fixture 0' })).toBeVisible();
  await expect(list.getByRole('img', { name: 'Enrollment photo of Fixture 1' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Recent scan results' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Scan instructions' })).toHaveCount(0);
  await page.screenshot({ path: '.local/automatic-identification-desktop.png', fullPage: true });
  await page.waitForTimeout(2500);
  const db = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      ),
    ),
  );
  expect(db.identificationEvents).toHaveLength(2);
  expect(
    db.identificationEvents.every(
      (e) =>
        e.livenessStatus === 'not_checked' && e.similarity > 0.85 && e.faceCountAtDecision === 2,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/automatic-identification-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(livenessRequests).toEqual([]);
  expect(errors).toEqual([]);
  const measurements = await page.evaluate(async () => {
    const { createBrowserFaceEngine } = await import(
      '/src/utils/hooks/faceRecognition/recognition/browserFaceEngine.js'
    );
    const engine = createBrowserFaceEngine(location.origin + '/');
    await engine.initialize();
    const db = JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('stk:face-prototype:')),
      ),
    );
    const images = await Promise.all(
      JSON.parse(sessionStorage.getItem('test:identification-fixtures')).map(async (url) =>
        createImageBitmap(await (await fetch(url)).blob()),
      ),
    );
    const report = [];
    for (const gallerySize of [1, 10, 50]) {
      const entries = Array.from({ length: gallerySize }, (_, i) => ({
        personId: `benchmark${i}`,
        templateId: `template${i}`,
        templateVersion: 1,
        embedding:
          i < 2
            ? db.templates[i].embedding
            : Array.from({ length: 128 }, (_, k) => (k === i ? 1 : 0)),
      }));
      await engine.setGallery({ version: String(gallerySize), entries });
      for (const faceCount of [1, 2, 3]) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 640, 480);
        const width = Math.min(320, 640 / faceCount);
        for (let i = 0; i < faceCount; i++)
          ctx.drawImage(images[i % 2], i * width, 40, width, width * 1.25);
        const frame = ctx.getImageData(0, 0, 640, 480),
          start = performance.now(),
          frameId = crypto.randomUUID();
        const detected = await engine.detectFrame(
          { data: frame.data, width: 640, height: 480 },
          frameId,
        );
        const detectedAt = performance.now();
        const selected = detected.faces.filter((f) => !f.reasonCode).slice(0, 2);
        const result = await engine.extractFaces(
          frameId,
          selected.map((f) => f.detectionId),
          String(gallerySize),
        );
        report.push({
          gallerySize,
          requestedFaces: faceCount,
          detectedFaces: detected.faces.length,
          qualityEligible: detected.faces.filter((f) => !f.reasonCode).length,
          comparedFaces: result.results.length,
          detectionMs: detectedAt - start,
          pipelineMs: performance.now() - start,
        });
        await engine.releaseFrame(frameId);
      }
    }
    images.forEach((image) => image.close());
    engine.dispose();
    return report;
  });
  await writeFile('.local/identification-performance.json', JSON.stringify(measurements, null, 2));
  expect(measurements).toHaveLength(9);
  expect(
    measurements.every(
      (m) => m.comparedFaces <= 2 && m.detectedFaces > 0 && Number.isFinite(m.pipelineMs),
    ),
  ).toBe(true);
  await page.getByRole('link', { name: 'Local database', exact: true }).first().click();
  await page.getByRole('tab', { name: /Identification scans/ }).click();
  await expect(page.getByRole('table')).toContainText('Fixture 0');
  await page.reload();
  await page.getByRole('tab', { name: /Identification scans/ }).click();
  await expect(page.getByRole('table')).toContainText('Fixture 1');
});

test('Stop cancels a pending camera permission and releases the late stream', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        window.cameraPermissionPending = true;
        window.completeCameraPermission = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const stream = canvas.captureStream(10);
          window.lateCameraTrack = stream.getVideoTracks()[0];
          resolve(stream);
        };
      });
  });
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.cameraPermissionPending), { timeout: 90000 })
    .toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.evaluate(() => window.completeCameraPermission());
  await expect.poll(() => page.evaluate(() => window.lateCameraTrack.readyState)).toBe('ended');
  await expect(page.getByRole('button', { name: 'Start scanning', exact: true })).toBeEnabled();
  await expect(page.getByTestId('face-box')).toHaveCount(0);
});

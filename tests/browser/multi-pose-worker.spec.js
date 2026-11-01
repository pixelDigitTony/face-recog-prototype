import { test, expect } from '@playwright/test';
test('real MediaPipe worker returns separate poses and blink data for two faces', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PROTOTYPE_URL),
    'Real worker fixture setup uses dev source imports.',
  );
  await page.goto('/enroll');
  const result = await page.evaluate(async () => {
    const { createFaceLandmarkerAdapter } = await import(
      '/src/utils/hooks/faceRecognition/liveness/faceLandmarkerAdapter.js'
    );
    const adapter = createFaceLandmarkerAdapter(location.origin + '/');
    await adapter.initialize({ numFaces: 10, blink: true });
    const image = await createImageBitmap(await (await fetch('/tests/fixtures/lena.jpg')).blob());
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 640, 480);
    for (let i = 0; i < 2; i++) ctx.drawImage(image, 138, 79, 285, 411, i * 320, 30, 320, 420);
    const frame = ctx.getImageData(0, 0, 640, 480),
      pose = await adapter.observe({ data: frame.data, width: 640, height: 480 }, 1000);
    adapter.dispose();
    image.close();
    return pose;
  });
  expect(result.faces).toHaveLength(2);
  expect(
    result.faces.every(
      (p) =>
        Number.isFinite(p.yaw) &&
        p.box.length === 4 &&
        Number.isFinite(p.eyeBlinkLeft) &&
        Number.isFinite(p.eyeBlinkRight),
    ),
  ).toBe(true);
  const centers = result.faces.map((p) => p.box[0] + p.box[2] / 2).sort((a, b) => a - b);
  expect(centers[0]).toBeLessThan(320);
  expect(centers[1]).toBeGreaterThan(320);
});

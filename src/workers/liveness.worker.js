/* Classic worker: MediaPipe's WASM loader requires importScripts. Bundled by Vite. */
let landmarker, manifest;
async function verified(url, digest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing liveness asset: ${url}`);
  const bytes = await response.arrayBuffer();
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  if (actual !== digest) throw new Error('Liveness asset integrity check failed.');
  return new Uint8Array(bytes);
}
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    let result;
    if (type === 'initialize') {
      const base = payload.baseUrl;
      const response = await fetch(`${base}models/liveness-manifest.json`);
      if (!response.ok) throw new Error('Liveness manifest missing.');
      manifest = await response.json();
      for (const asset of manifest.assets)
        await verified(`${base}runtime/mediapipe/${asset.name}`, asset.sha256);
      importScripts(`${base}runtime/mediapipe/vision_bundle.js`);
      const files = await Vision.FilesetResolver.forVisionTasks(`${base}runtime/mediapipe`);
      const modelAssetBuffer = await verified(`${base}models/${manifest.name}`, manifest.sha256);
      landmarker = await Vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.7,
        minFacePresenceConfidence: 0.7,
        minTrackingConfidence: 0.7,
        outputFacialTransformationMatrixes: true,
      });
      result = manifest;
    } else {
      if (!landmarker) throw new Error('Liveness unavailable.');
      const { frame, timestamp } = payload;
      const output = landmarker.detectForVideo(
        new ImageData(frame.data, frame.width, frame.height),
        timestamp,
      );
      const points = output.faceLandmarks[0],
        matrix = output.facialTransformationMatrixes[0]?.data;
      result = { yaw: null, box: null };
      if (points && matrix) {
        const xs = points.map((p) => p.x * frame.width),
          ys = points.map((p) => p.y * frame.height);
        result = {
          yaw: (Math.atan2(-matrix[2], Math.hypot(matrix[0], matrix[1])) * 180) / Math.PI,
          box: [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs) - Math.min(...xs),
            Math.max(...ys) - Math.min(...ys),
          ],
        };
      }
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
};

import * as ort from 'onnxruntime-web/wasm';

export async function loadModels(baseUrl) {
  const response = await fetch(`${baseUrl}models/model-manifest.json`);
  if (!response.ok) throw new Error('Model manifest is missing. Run npm run setup:assets.');
  const manifest = await response.json();
  // OpenCV's UMD wrapper is adapted to globalThis by setup:assets for ESM workers.
  await import(/* @vite-ignore */ `${baseUrl}runtime/opencv.js`);
  const cv = globalThis.cv;
  if (!cv?.Mat)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OpenCV initialization timed out.')), 60000);
      cv.onRuntimeInitialized = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = `${baseUrl}runtime/`;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
  const sessions = [];
  try {
    for (const model of [manifest.detector, manifest.recognizer]) {
      const res = await fetch(`${baseUrl}models/${model.name}`);
      if (!res.ok) throw new Error(`Missing model: ${model.name}`);
      const bytes = await res.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      if (digest !== model.sha256) throw new Error(`Integrity check failed: ${model.name}`);
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      if (!session.inputNames.includes(model.input))
        throw new Error(`Unexpected input tensor for ${model.name}`);
      sessions.push(session);
      for (const outputName of model.outputs)
        if (!session.outputNames.includes(outputName))
          throw new Error(`Unexpected output tensor for ${model.name}: ${outputName}`);
    }
    for (const name of manifest.detector.outputs)
      if (!sessions[0].outputNames.includes(name))
        throw new Error(`Missing detector output: ${name}`);
    return {
      cv,
      ort,
      manifest,
      detector: sessions[0],
      recognizer: sessions[1],
      recognizerOutputs: sessions[1].outputNames,
    };
  } catch (error) {
    for (const session of sessions) await session.release();
    throw error;
  }
}

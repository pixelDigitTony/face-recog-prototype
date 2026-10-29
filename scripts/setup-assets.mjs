import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function download(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'STK-Face-Prototype-Setup' } });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
for (const folder of ['public/models', 'public/runtime', 'public/licenses', 'tests/fixtures'])
  await mkdir(path.join(root, folder), { recursive: true });
let lock;
try {
  lock = JSON.parse(await readFile(path.join(root, 'asset-lock.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!lock) {
  const commit = JSON.parse(
    await download('https://api.github.com/repos/opencv/opencv_zoo/commits/main'),
  ).sha;
  lock = { zooRevision: commit, models: [] };
  for (const [folder, name] of [
    ['face_detection_yunet', 'face_detection_yunet_2023mar.onnx'],
    ['face_recognition_sface', 'face_recognition_sface_2021dec.onnx'],
  ]) {
    const pointer = (
      await download(
        `https://raw.githubusercontent.com/opencv/opencv_zoo/${commit}/models/${folder}/${name}`,
      )
    ).toString();
    const hash = pointer.match(/oid sha256:([a-f0-9]{64})/)?.[1];
    if (!hash) throw new Error('Expected a Git LFS model digest');
    lock.models.push({
      folder,
      name,
      sha256: hash,
      url: `https://media.githubusercontent.com/media/opencv/opencv_zoo/${commit}/models/${folder}/${name}`,
    });
  }
  await writeFile(path.join(root, 'asset-lock.json'), JSON.stringify(lock, null, 2));
}
for (const model of lock.models) {
  const dest = path.join(root, 'public/models', model.name);
  let bytes;
  try {
    bytes = await readFile(dest);
  } catch {}
  if (!bytes || sha(bytes) !== model.sha256) bytes = await download(model.url);
  if (sha(bytes) !== model.sha256) throw new Error(`Hash mismatch: ${model.name}`);
  await writeFile(dest, bytes);
  const license = await download(
    `https://raw.githubusercontent.com/opencv/opencv_zoo/${lock.zooRevision}/models/${model.folder}/LICENSE`,
  );
  await writeFile(path.join(root, 'public/licenses', `${model.folder}.txt`), license);
  console.log(`${model.name}: verified ${bytes.length} bytes`);
}
const ortFolder = path.join(root, 'node_modules/onnxruntime-web/dist');
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'])
  await copyFile(path.join(ortFolder, file), path.join(root, 'public/runtime', file));
// The upstream UMD wrapper uses top-level `this`, which is undefined in an ESM worker.
const opencvSource = await readFile(
  path.join(root, 'node_modules/@techstark/opencv-js/dist/opencv.js'),
  'utf8',
);
await writeFile(
  path.join(root, 'public/runtime/opencv.js'),
  opencvSource.replace('}(this, function () {', '}(globalThis, function () {'),
);
for (const [pkg, name] of [
  ['onnxruntime-web', 'onnxruntime'],
  ['@techstark/opencv-js', 'opencv-js'],
]) {
  const dir = path.join(root, 'node_modules', pkg);
  const licenseFile = (await readdir(dir)).find((file) => /^license/i.test(file));
  if (licenseFile)
    await copyFile(path.join(dir, licenseFile), path.join(root, 'public/licenses', `${name}.txt`));
}
const manifest = {
  zooRevision: lock.zooRevision,
  preprocessingVersion: 'opencv-yunet640-sface-rgb112-v1',
  qualityPolicyVersion: 'quality-v1-experimental',
  runtimeVersion: '1.23.2',
  opencvVersion: '4.12.0',
  executionProvider: 'wasm',
  embeddingDimension: 128,
  detector: { ...lock.models[0], input: 'input', dimensions: [1, 3, 640, 640] },
  recognizer: { ...lock.models[1], input: 'data', dimensions: [1, 3, 112, 112], outputs: ['fc1'] },
  qualityPolicy: {
    detectorThreshold: 0.8,
    nmsThreshold: 0.3,
    minFacePixels: 60,
    minBlurVariance: 15,
    minBrightness: 25,
    maxBrightness: 235,
  },
};
manifest.detector.outputs = [
  'cls_8',
  'cls_16',
  'cls_32',
  'obj_8',
  'obj_16',
  'obj_32',
  'bbox_8',
  'bbox_16',
  'bbox_32',
  'kps_8',
  'kps_16',
  'kps_32',
];
await writeFile(
  path.join(root, 'public/models/model-manifest.json'),
  JSON.stringify(manifest, null, 2),
);
// Upstream sample images are development fixtures, never seeded into the application's database.
for (const name of ['lena.jpg', 'messi5.jpg']) {
  await writeFile(
    path.join(root, 'tests/fixtures', name),
    await download(`https://raw.githubusercontent.com/opencv/opencv/4.12.0/samples/data/${name}`),
  );
}
console.log('Local model and runtime assets are ready.');
await writeFile(
  path.join(root, 'public/licenses/onnxruntime.txt'),
  await download('https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/LICENSE'),
);

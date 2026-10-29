import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const pkg = path.join(root, 'node_modules/@mediapipe/tasks-vision');
const version = JSON.parse(await readFile(path.join(pkg, 'package.json'))).version;
const folder = path.join(root, 'public/runtime/mediapipe');
await mkdir(folder, { recursive: true });
const lockPath = path.join(root, 'public/models/liveness-manifest.json');
let previous;
try {
  previous = JSON.parse(await readFile(lockPath));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const url =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let bytes;
try {
  bytes = await readFile(path.join(root, 'public/models/face_landmarker.task'));
} catch {}
if (!bytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download: ${res.status}`);
  bytes = Buffer.from(await res.arrayBuffer());
}
if (previous && previous.sha256 !== hash(bytes)) throw new Error('Liveness model digest changed.');
await writeFile(path.join(root, 'public/models/face_landmarker.task'), bytes);
const assets = [];
for (const name of await readdir(path.join(pkg, 'wasm'))) {
  if (!/\.(js|wasm)$/.test(name)) continue;
  await copyFile(path.join(pkg, 'wasm', name), path.join(folder, name));
  assets.push({ name, sha256: hash(await readFile(path.join(folder, name))) });
}
await copyFile(path.join(pkg, 'vision_bundle.js'), path.join(folder, 'vision_bundle.js'));
assets.push({
  name: 'vision_bundle.js',
  sha256: hash(await readFile(path.join(folder, 'vision_bundle.js'))),
});
await writeFile(
  lockPath,
  JSON.stringify(
    {
      version,
      name: 'face_landmarker.task',
      url,
      sha256: hash(bytes),
      method: 'active_head_turn_v1',
      assets,
    },
    null,
    2,
  ),
);
const license = await fetch(
  'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE',
);
if (!license.ok) throw new Error('MediaPipe license unavailable');
await writeFile(path.join(root, 'public/licenses/mediapipe.txt'), await license.text());
console.log(
  `MediaPipe ${version}: verified model ${bytes.length} bytes and ${assets.length} runtime assets`,
);

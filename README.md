# STK Face Lab

A standalone React JavaScript + MUI prototype for browser-local YuNet/SFace face recognition. Enrollment, verification, settings, people, templates, probe embeddings and capture history stay in localStorage. No application server or database service is required.

## Run

Use Node.js 20.20+ or a current supported LTS release, and npm. Dependencies and verified model assets are already present in this working copy.

```powershell
cd C:\Users\USER\projects\Starwinner\face-recog-prototype
npm.cmd run dev
```

Open the URL printed by Vite. For a fresh checkout:

```powershell
npm.cmd ci
npm.cmd run setup:assets
npm.cmd run dev
```

`setup:assets` downloads the official models using the exact revision and SHA-256 hashes in `asset-lock.json`, copies the pinned runtime assets, and writes the browser model manifest. It needs internet access during setup. The application subsequently serves all assets locally. Keep `asset-lock.json` when rebuilding; it is the reproducibility record.

## Try it

1. On **Enroll**, click **+**, enter an employee code and name, acknowledge browser storage, and save the person.
2. Click **Start live scan**. Keep one face visible, look straight ahead, then follow the randomized left/right head-turn and return prompts. After basic liveness passes, click **Capture & enroll** (or explicitly replace an enrollment).
3. On **Scan face**, select that enrolled person and **Start live scan**. All detected faces receive boxes, temporary track IDs and detection details. Verification pauses whenever more than one face appears. After basic liveness, three fresh consecutive comparisons **strictly above 85%** produce a match. Exactly 85% fails. **Start next verification** rearms a new session; staying in frame does not create repeated rows.
4. Open **Local database** to inspect People, Templates, Captures, and Settings/Metadata. Each **View** dialog exposes the full stored record, including numeric face embeddings.
5. Use **Settings** to change thumbnail retention. The required threshold is fixed at raw cosine > 0.85. **Export JSON** includes the entire database. Deletion and reset always require an explicit action.

**Use test image** opens the diagnostic capture flow. It runs the real models, displays similarity and saves diagnostic records, but cannot complete liveness or produce a live match. Image-created templates are excluded from live verification. Fixtures under `tests/fixtures/` are never automatically seeded into localStorage.

Camera access needs localhost or HTTPS. Model loading is explicit and may take longer on the first visit. Ready sessions can run inference without network access; a cold offline reload is outside the MVP. Clearing browser data, changing origin/port, or using another profile creates a different local database.

## Storage behavior

The initial key is `stk:face-prototype:v1:standalone:stk-prototype:db`. The repository commits one validated JSON envelope per operation. An exclusive Web Lock allows one writer tab; other tabs observe data in read-only mode. Close the writer and reload another tab to take over.

Limits are 50 people, 200 capture attempts, and a conservative 3 MiB estimated storage budget. The first reached limit blocks additions; there is no automatic eviction. A failed write leaves prior data intact and keeps the new result explicitly unsaved. **Retry save** reuses the same attempt ID without repeating inference. An unsaved result is lost on reload or navigation.

Retained thumbnails are at most 96 × 96 JPEG and 4,096 characters. Embeddings contain 128 normalized numeric values. Full video and source frames are not retained. Corrupt or unsupported data is preserved for download; recovery never silently resets the database. Reset touches only the prototype's scoped key.

Schema 1 migrates atomically to schema 2 under the existing writer lock and key. Historical scores, outcomes and threshold snapshots remain unchanged; old templates show that enrollment liveness was not checked. Export before upgrading when you need a backup. Failed migration preserves original data for recovery.

This is a local test database accessible to scripts on the same origin. Results remain non-authoritative. MediaPipe landmarks support a **basic randomized motion challenge**, not validated passive anti-spoofing. Photo/video replay, masks and virtual-camera injection remain unvalidated. Similarity percentage is a raw score conversion, not identity probability; 0.85 is much stricter than the former experimental 0.363 threshold. Target-user/camera calibration and production STK authorization remain separate acceptance work.

## Architecture and STK integration

```text
src/app/                              Standalone shell, theme composition and routing
src/features/face-recognition/        Public feature entry, contracts, pages and UI
src/components/dialogs/faceRecognition/  Dialogs following STK placement rules
src/utils/hooks/faceRecognition/      Hooks, workflows, persistence and image helpers
src/workers/                         Worker entry for OpenCV.js and ONNX Runtime
src/theme/                           MUI theme tokens and component defaults
public/models/                       Verified ONNX weights and manifest
public/runtime/                      Pinned local OpenCV.js / ONNX WASM assets
tests/                               Unit, browser and native-reference fixtures
```

`features/face-recognition/index.js` is the public boundary. The module has no root router or theme provider. A host can inject services and mount the exported screens under its existing providers:

```jsx
import { FaceRecognitionModule, EnrollmentPage } from './features/face-recognition';

// Inside the existing STK theme and router:
<FaceRecognitionModule services={services}>
  <EnrollmentPage />
</FaceRecognitionModule>;
```

`createPrototypeServices({ context, baseUrl, repository, engine })` builds the local workflow, or supply the `context`, `repository`, `engine` and `workflow` service object directly. Hooks and standalone functions remain under `utils/hooks`; dialogs remain under `components/dialogs`. There are no imports from the production STK checkout.

Later, replace `FaceWorkflow` with an STK API adapter for server-authoritative enrollment/verification, replace local queries with scoped API queries, and supply actual company/store/employee identity from STK. Keep the raw database viewer prototype-only. Production attendance must use a server-issued decision tied to employee, scope and action; it must not trust a browser score.

`liveFaceWorkflow.js` coordinates transient tracking, challenge evidence and session decisions; `faceWorkflow.js` prepares terminal enrollment/verification operations and immutable retry data. Schema v2 migrates the known v1 format and rejects unknown versions without resetting data. See the [live specification](docs/STK_LIVE_FACE_TRACKING_SPEC.md), [UML](docs/STK_FACE_RECOGNITION_PROTOTYPE_UML.puml), and [validation record](docs/IMPLEMENTATION.md).

## Validation

The [live tracking specification](docs/STK_LIVE_FACE_TRACKING_SPEC.md) covers multi-face overlays, the matching percentage, basic liveness and session persistence. See [implementation evidence](docs/IMPLEMENTATION.md) for verified behavior and remaining physical-device acceptance.

```powershell
npm.cmd test
npm.cmd run build
# Run while the dev server is available at http://127.0.0.1:5190:
npm.cmd run dev -- --port 5190 --strictPort
# In a second terminal:
npm.cmd run test:e2e
```

Browser tests use installed Google Chrome. `PROTOTYPE_URL` can select a production preview; source-level native parity is skipped for that mode. The camera lifecycle test uses Chrome's synthetic camera device, not a physical webcam.

Native parity fixtures are checked in. To regenerate them, create a development-only Python environment with `opencv-python-headless==4.12.0.88` and run `scripts/reference-fixtures.py`. Python is never involved in serving or using the application. The script writes the detector landmarks and normalized SFace vectors used by the browser parity test.

## Build and hosting

`npm.cmd run build` produces a static `dist/` directory. Test it using `npm.cmd run preview`. Deploy on an HTTPS static host that accepts the SFace model's approximately 38.7 MB file, with SPA fallback to `index.html` and WASM MIME support. Cloudflare Pages' 25 MiB per-asset limit requires a separate, tested asset-serving arrangement; do not upload the current build unchanged there. No deployment was performed by this task.

### Vercel

Use the directory containing `package.json` and `vercel.json` as the Vercel project root, with the **Vite** framework preset, **`npm run build`** build command, and **`dist`** output directory.

The included `vercel.json` rewrites page requests to `index.html` so React Router can resolve `/enroll`, `/scan`, `/database` and `/settings` on direct visits or browser refresh. This follows [Vercel's Vite SPA guidance](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas). Commit and push the configuration to the branch Vercel deploys, then wait for a new deployment; the existing deployment cannot pick up local file changes. After deployment, open each page URL directly and refresh it.

## Models and notices

Exact model provenance and hashes are in `asset-lock.json`; input/output conventions and quality gates are in `public/models/model-manifest.json`. The detector uses its declared **640 × 640** input and BGR 0–255 planes. Five-point alignment produces a **112 × 112** RGB SFace input without unrelated pixel normalization. The OpenCV.js UMD wrapper has a documented `globalThis` adaptation for module workers in `setup-assets.mjs`; the underlying package is pinned.

The live cosine cutoff is strictly greater than 0.85, as requested; it is not calibrated for STK. Historical attempts preserve their prior threshold. The MediaPipe 1.2.0 package, Face Landmarker bundle revision 1 and local runtime hashes are recorded in `public/models/liveness-manifest.json`. `setup:assets` also prepares these assets; `node scripts/setup-liveness.mjs` prepares them independently. A model/hash/preprocessing change requires compatible enrollment or re-enrollment. Review code/model notices in `public/licenses/` before redistribution. Development fixtures are excluded from the production build.

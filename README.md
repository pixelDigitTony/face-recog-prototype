# STK Face Lab

A standalone React JavaScript + MUI prototype for browser-local YuNet/SFace face recognition. Enrollment, verification, settings, people, templates, probe embeddings and capture history stay in localStorage. No application server or database service is required.

## Run

Use Node.js 20.20+ or a current supported LTS release, and npm. Dependencies and verified model assets are already present in this working copy.

```powershell
cd C:\Users\USER\projects\Starwinner\facial-recog-prototype
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
2. Click **Load models**. Once ready, start the camera and click **Capture & enroll**. Keep one face visible in even lighting.
3. On **Scan face**, select that enrolled person, start the camera and click **Scan face**.
4. Open **Local database** to inspect People, Templates, Captures, and Settings/Metadata. Each **View** dialog exposes the full stored record, including numeric face embeddings.
5. Use **Settings** to change the experimental threshold or thumbnail retention. **Export JSON** includes the entire database. Deletion and reset always require an explicit action.

**Use test image** is an additional manual input for reproducible testing without a webcam. It still runs the real models and is labelled as image test mode. Fixtures under `tests/fixtures/` are never automatically enrolled or seeded into localStorage.

Camera access needs localhost or HTTPS. Model loading is explicit and may take longer on the first visit. Ready sessions can run inference without network access; a cold offline reload is outside the MVP. Clearing browser data, changing origin/port, or using another profile creates a different local database.

## Storage behavior

The initial key is `stk:face-prototype:v1:standalone:stk-prototype:db`. The repository commits one validated JSON envelope per operation. An exclusive Web Lock allows one writer tab; other tabs observe data in read-only mode. Close the writer and reload another tab to take over.

Limits are 50 people, 200 capture attempts, and a conservative 3 MiB estimated storage budget. The first reached limit blocks additions; there is no automatic eviction. A failed write leaves prior data intact and keeps the new result explicitly unsaved. **Retry save** reuses the same attempt ID without repeating inference. An unsaved result is lost on reload or navigation.

Retained thumbnails are at most 96 × 96 JPEG and 4,096 characters. Embeddings contain 128 normalized numeric values. Full video and source frames are not retained. Corrupt or unsupported data is preserved for download; recovery never silently resets the database. Reset touches only the prototype's scoped key.

This is a local test database accessible to scripts running on the same origin. The displayed match is non-authoritative, and liveness is not implemented. Test with appropriate sample data; production access control, biometric protection, retention and attendance authorization belong to the later STK integration.

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

The implementation uses one `faceWorkflow.js` module to keep the small enrollment/verification/commit workflow together rather than introducing forwarding-only modules. Schema v1 intentionally rejects unknown versions instead of attempting an untested migration. See the [specification](docs/STK_FACE_RECOGNITION_PROTOTYPE_SPEC.md), [UML](docs/STK_FACE_RECOGNITION_PROTOTYPE_UML.puml), and [validation record](docs/IMPLEMENTATION.md).

## Validation

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

## Models and notices

Exact model provenance and hashes are in `asset-lock.json`; input/output conventions and quality gates are in `public/models/model-manifest.json`. The detector uses its declared **640 × 640** input and BGR 0–255 planes. Five-point alignment produces a **112 × 112** RGB SFace input without unrelated pixel normalization. The OpenCV.js UMD wrapper has a documented `globalThis` adaptation for module workers in `setup-assets.mjs`; the underlying package is pinned.

The default cosine threshold of 0.363 and the image-quality cutoffs are experimental, not calibrated for STK. A model/hash/preprocessing change requires compatible enrollment or re-enrollment. Review the exact code/model notices in `public/licenses/` before redistribution. Test images are upstream OpenCV sample fixtures, used for development only; they are excluded from the static production build.

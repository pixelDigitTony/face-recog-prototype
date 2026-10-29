# STK facial recognition prototype specification

Status: implemented prototype; see IMPLEMENTATION.md for validation and remaining device acceptance.  
Updated: 2026-10-28.  
Companion: [UML source](STK_FACE_RECOGNITION_PROTOTYPE_UML.puml).

Implemented extension: [live tracking, multiple-face overlays, above-85% matching and basic liveness](STK_LIVE_FACE_TRACKING_SPEC.md). The extension supersedes the original manual capture and liveness exclusions below; see IMPLEMENTATION.md for validation evidence.

## 1. Objective and scope

Build a standalone React **JavaScript** prototype with **Material UI (MUI)**. A tester can enroll a person, capture a face, verify it against that person's enrollment, and inspect every saved application record in a localStorage database viewer. All face processing, decisions, and application data storage happen in the browser.

Implementation is authorized in the standalone `facial-recog-prototype/` project. This copy records the design baseline; IMPLEMENTATION.md describes implemented choices and acceptance evidence. Existing STK applications, attendance routes, databases, and deployments are outside this phase.

### Required capabilities

- React components in `.jsx`; JavaScript modules in `.js`, with JSDoc contracts where useful.
- MUI forms, navigation, feedback, dialogs, and tables using the free Material UI packages.
- Real YuNet face detection and SFace embeddings in the browser; no random or hard-coded matching results.
- Person enrollment and replacement of an existing face template.
- Manual, single-capture **1:1 verification** against a selected person.
- localStorage persistence for people, face templates, completed capture attempts, settings, and database metadata.
- A database viewer with table tabs, filtering, sorting, pagination, record details, and full JSON export.
- Recoverable camera, model, inference, and persistence failures.
- Clear interfaces allowing the prototype UI and workflows to be adapted to STK later.

### Excluded from the prototype

Express, Python/FastAPI, MongoDB, server endpoints, external recognition APIs, authentication, production attendance writes, payroll decisions, face-only 1:N employee lookup, QR scanning, training, and liveness/anti-spoofing. Selecting a person stands in for the identity supplied by STK's QR flow later.

Persistent product copy: **"Prototype — data is stored in this browser. Liveness is not checked."** A match is a prototype comparison result, never an attendance authorization or proof of physical presence.

## 2. Technology decisions

| Area                   | Decision                                                                  | Purpose                                                                                          |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Application            | React 19, React DOM, Vite, JavaScript ES modules                          | Standalone static web application; use a lockfile and pin tested versions during implementation. |
| UI                     | `@mui/material` and `@mui/icons-material`, aligned with STK's MUI 7 major | Reusable components and compatible theme conventions.                                            |
| Styling                | `@emotion/react`, `@emotion/styled`, MUI theme and `sx`                   | One design system; local/system fonts.                                                           |
| Navigation             | `react-router-dom` 6, owned by the standalone app shell                   | Align with STK's current router major; avoid a nested router when integrated.                    |
| Inference              | `onnxruntime-web`, WASM execution provider                                | Execute YuNet and SFace ONNX models locally.                                                     |
| Image preparation      | A pinned, locally served OpenCV.js build plus JavaScript helpers          | Color conversion, resizing, five-point alignment and cropping.                                   |
| Background work        | A dedicated browser Web Worker                                            | Keep inference and image operations off the React rendering thread.                              |
| Persistence            | Browser `localStorage` behind an asynchronous repository interface        | Pretend database today; replaceable storage boundary later.                                      |
| Tests when implemented | Vitest and React Testing Library; Playwright for browser workflows        | Test persistence, decisions, UI behavior, and static-build operation.                            |

Use MUI `Table`, `TableContainer`, `TableHead`, `TableBody`, `TableRow`, `TableCell`, `TableSortLabel`, and `TablePagination`. No MUI X Pro/Premium, commercial templates, or license keys are required. MUI's documented installation uses Emotion; its standard table components support this prototype's needs. [MUI installation](https://mui.com/material-ui/getting-started/installation/), [MUI tables](https://mui.com/material-ui/react-table/).

### Browser inference feasibility gate

The original OpenCV recommendation remains the model choice, but its native convenience APIs are not assumed to exist in the standard OpenCV.js build. Implement the YuNet input/output adapter and SFace preprocessing explicitly, using ONNX Runtime Web for inference. Do not replace this with a Python server or simulated recognition to claim frontend completion.

First validate one real image end to end with the pinned browser assets. Candidate weights are `face_detection_yunet_2023mar.onnx` and `face_recognition_sface_2021dec.onnx`; these are deliberate baseline candidates, not a claim that they are the newest releases. Record exact source revisions, SHA-256 hashes, input/output names and dimensions, preprocessing version, runtime versions, and license notices in a model manifest before accepting the implementation. A model change requires repeating the parity checks and invalidating incompatible enrollments. [YuNet models](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), [SFace models](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface).

WASM is the required baseline; start with single-threaded WASM to avoid requiring cross-origin isolation for shared memory. WebGPU is a future optimization, not a prerequisite. Runtime JavaScript and WASM assets must come from the same tested package version. Browser support for a runtime does not prove that this exact pipeline works on every device. [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [deployment guidance](https://onnxruntime.ai/docs/tutorials/web/deploy.html).

## 3. Architecture and file organization

Use feature-oriented UI modules with explicit workflow, recognition, and persistence boundaries. Keep business rules out of React components. Use small JavaScript modules and dependency injection, not a new global state framework or a generic enterprise architecture framework.

Proposed organization, to be created during implementation:

```text
facial-recog-prototype/
  package.json
  package-lock.json
  index.html
  vite.config.js
  README.md
  public/
    models/                         # ONNX weights and model-manifest.json
    runtime/                        # pinned ORT WASM and OpenCV.js assets
    licenses/                       # notices for the shipped artifacts
  src/
    app/
      App.jsx                       # standalone shell only
      providers.jsx                 # theme and service composition
      router.jsx                    # standalone routes
      config.js                     # prototype scope and asset URLs
    features/face-recognition/
      index.js                      # supported public exports
      FaceRecognitionModule.jsx     # feature entry; no root router/theme
      contracts.js                  # JSDoc DTO and interface definitions
      constants.js                  # outcome codes and schema versions
      pages/
        EnrollmentPage.jsx
        ScanPage.jsx
        DatabasePage.jsx
        SettingsPage.jsx
      components/
        CameraPreview.jsx
        ModelStatus.jsx
        ScanResult.jsx
        LocalDatabaseTable.jsx
        StorageUsage.jsx
    components/dialogs/faceRecognition/
      PersonDialog.jsx
      RecordDetailsDialog.jsx
      DeleteDataDialog.jsx
    utils/hooks/faceRecognition/
      createPrototypeServices.js     # dependency composition
      useCamera.js
      useFaceWorkflow.js
      useLocalDatabase.js
      workflows/
        enrollPerson.js
        verifyPerson.js
        deletePersonData.js
      repositories/
        localStorageRepository.js
        databaseSchema.js
        databaseMigrations.js
        writerLock.js
      recognition/
        browserFaceEngine.js         # worker client; implements FaceEngine
        workerHandler.js
        modelLoader.js
        yunetAdapter.js
        sfaceAdapter.js
        alignFace.js
        cosineSimilarity.js
        imageQuality.js
    workers/
      faceRecognition.worker.js     # worker entry; imports workerHandler
    theme/
      theme.js
  tests/
    unit/
    integration/
    browser/
    fixtures/                       # controlled test fixtures; not employee data
```

The feature grouping follows modern React module boundaries while respecting [STK's documented placement rules](../../sparkle-timein-client/AGENTS.md): custom hooks and standalone utility functions go under `utils/hooks/`, and dialogs/overlays go under `components/dialogs/`. The standalone project's named subfolders make later migration straightforward without copying hooks into feature folders. Shared UI should be extracted only when it has multiple real consumers.

### Dependency rules

1. Pages/components call `FaceWorkflow` and repository query interfaces through hooks; they never call `localStorage`, ONNX sessions, or future HTTP endpoints directly.
2. Prototype workflows depend on `FaceEngine`, `PrototypeRepository`, and a supplied context. They do not import application routes, STK auth globals, or MUI.
3. The localStorage adapter owns serialization, validation, migrations, write coordination, capacity limits, and subscriptions. It is the only module allowed to read or write the prototype database key.
4. The worker owns models, tensors, and OpenCV allocations. It sends structured results; it never accesses localStorage or React state.
5. The app composition root injects implementations and configuration. Avoid module-level mutable service singletons so tests and future host applications can create isolated instances.
6. Feature consumers import the public entry point or documented contracts. Use an `@/` source alias, named exports, and consistent naming; avoid cross-feature deep imports and circular barrel imports.

### Stable interfaces

| Interface             | Operations and contract                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FaceWorkflow`        | `enroll(request)`, `verify(request)`, `retrySave(attemptId)`, `deletePersonData(request)`; returns a typed outcome plus `persisted`, `attemptId`, `authoritative: false`, and an optional recoverable error. Future STK integration may replace this whole workflow with an API adapter. |
| `FaceEngine`          | `initialize(manifest)`, `extract(frame, options)`, `dispose()`; extraction returns face count, quality measurements, normalized embedding when valid, model identity, and timings.                                                                                                       |
| `PrototypeRepository` | `load()`, `query(collection, filters)`, `commit(operation)`, `exportJson()`, `reset()`, `subscribe(listener)`; asynchronous return values despite localStorage being synchronous. `commit` supports one atomic enrollment or scan operation.                                             |
| `FeatureContext`      | `environment`, `companyId`, optional `storeId`; provided by the standalone shell now and trusted STK host context later.                                                                                                                                                                 |
| Worker messages       | `requestId`, `type`, `payload`; response echoes `requestId` and returns `ok/result` or a stable `errorCode`. Ignore responses from disposed sessions.                                                                                                                                    |

Use discriminated outcome codes, JSDoc types, and runtime validation at storage/worker boundaries. UUIDs are strings; timestamps are UTC ISO 8601; embeddings are finite numeric arrays. Do not couple UI models to MongoDB `_id`, Mongoose documents, or network response envelopes.

## 4. Screens and MUI component mapping

The standalone shell has **Enroll**, **Scan**, **Local Database**, and **Settings** navigation. Show model readiness, person count, scan count, and storage usage near the page header.

| Screen         | Behavior                                                                                                                                          | MUI components                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Enroll         | Create/select a test person; acknowledge browser storage; start camera; capture; show enrollment result; replace an existing template explicitly. | `Card`, `Stack`, `TextField`, `Autocomplete`, `Checkbox`, `Button`, `Alert`, `Chip`.       |
| Scan           | Select an enrolled person; show live preview; click **Scan face**; show score, threshold, result, processing time, and whether saved.             | `Autocomplete`, `Card`, `Button`, `CircularProgress`, `Alert`, `Chip`, `Typography`.       |
| Local Database | Collection tabs, search, result/person/date filters, sortable columns, pagination, JSON details, export, and scoped deletion.                     | `Tabs`, `Tab`, `TextField`, `Select`, standard `Table` components, `IconButton`, `Dialog`. |
| Settings       | Adjust prototype match threshold and thumbnail retention; inspect active model identity and storage schema; export/reset.                         | `TextField`, `Switch`, `List`, `LinearProgress`, `Alert`, `Dialog`.                        |

Use MUI `ThemeProvider` and `CssBaseline` once at the standalone root. Define spacing, typography, colors, and status styles in the theme. Reuse the host theme when integrated into STK. Use text as well as color for results, visible labels, keyboard-accessible controls, dialog focus management, and an announced status region. On narrow screens stack camera and result panels; allow the table container to scroll horizontally.

## 5. User workflows

### Enrollment

1. Create a person with employee code and name. The demo uses fixed `companyId = "stk-prototype"`; `storeId` is optional. Codes must be unique within that company, ignoring surrounding whitespace and case.
2. Record acknowledgement that the face template and optional thumbnail will be stored in this browser. This is a prototype acknowledgement, not a production consent system.
3. Start the camera explicitly. Enable capture only after the models and camera are ready and the tab owns the writer lock.
4. Capture one unmirrored frame. Run detection and quality checks. Exactly one usable face is required.
5. Align the face, produce one normalized SFace template, and build an enrollment attempt record.
6. Commit the new template, person status, and enrollment attempt together in one database write. Show **Enrolled and saved** only after success.
7. For re-enrollment, replace the active template only after successful processing and persistence; preserve the previous template on failure. Historical attempts retain their template/version snapshots.

The MVP uses **one accepted enrollment capture per person**. Multiple-template aggregation is a later extension that requires fresh threshold evaluation.

### Verification

1. Select an enrolled person. Freeze person, scope, active template/version, and settings for the attempt.
2. Click **Scan face**. Generate an `attemptId`; prevent a second in-flight capture.
3. Capture a frame and run the same detection, quality, alignment, and embedding pipeline as enrollment.
4. Compare only with the selected person's compatible active template. Never search all people silently.
5. Build the completed attempt, including failures after the attempt begins. Persist it before displaying a saved result or adding a saved row to the table.
6. A persistence error leaves the result visibly **Not saved** in memory. **Retry save** uses the same attempt ID and does not rerun inference. **Scan again** starts a new attempt ID.

Live preview is not continuous scanning. No database record is written for each preview frame. Leaving during processing cancels the attempt, stops the camera/worker operation as appropriate, and discards late callbacks. No success is fabricated after navigation or page closure.

## 6. Recognition contract

1. Read the original camera frame; mirroring is a preview-only CSS effect.
2. Prepare YuNet input using the manifest's pinned dimensions, channel order, and resize policy. Decode boxes, five landmarks, confidence, and non-maximum suppression according to that exact model variant; map coordinates back to the original image.
3. Require exactly one detected face above the detector threshold. Reject unusable size, blur, exposure, out-of-bounds landmarks, or failed alignment using versioned quality settings. Initial quality values must be measured during the feasibility work; their calibration is not complete in this document.
4. Use the same five-point similarity alignment and 112 × 112 crop convention as the OpenCV SFace reference. Match channel order and pixel scaling to the model; do not apply an unrelated normalization recipe. Release OpenCV matrices in `finally` blocks. [OpenCV recognition implementation](https://raw.githubusercontent.com/opencv/opencv/4.x/modules/objdetect/src/face_recognize.cpp).
5. Produce a 128-value embedding for the baseline SFace model, reject non-finite/zero-norm output, and L2-normalize it. Validate actual output dimensions against the pinned manifest.
6. Compute cosine similarity: `dot(probe, enrolled) / (norm(probe) * norm(enrolled))`. Match when the unrounded score is greater than or equal to the attempt's threshold. Display a rounded score without changing the comparison.
7. Default experimental match threshold: **0.363**. This is an OpenCV example benchmark reference, not a calibrated STK threshold or an identity probability. Settings must label it experimental; threshold changes affect future attempts only. [OpenCV face tutorial](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html).

A template is compatible only when recognizer model hash, embedding dimension, and preprocessing version match. A detector/preprocessing upgrade must trigger an explicit compatibility decision; the prototype's safe default is re-enrollment. Model errors never fall back to a simulated match.

Terminal outcome codes:

| Code                                               | Meaning                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ENROLLED`                                         | A usable enrollment template was produced; persistence is reported separately. |
| `MATCH` / `NO_MATCH`                               | Valid 1:1 comparison at or above / below the frozen threshold.                 |
| `NO_FACE` / `MULTIPLE_FACES`                       | Detection did not yield exactly one usable candidate.                          |
| `LOW_QUALITY`                                      | Face failed the recorded quality checks.                                       |
| `NOT_ENROLLED` / `MODEL_MISMATCH`                  | No usable compatible enrollment exists.                                        |
| `CAMERA_ERROR` / `MODEL_ERROR` / `INFERENCE_ERROR` | Capture or processing failed after an attempt started.                         |

Preflight problems before a capture is requested appear as readiness errors, not fabricated scan rows. Every terminal attempt has `livenessStatus = "not_implemented"`. The UI must never label a similarity score as a confidence percentage or claim photo/video replay protection.

## 7. localStorage database design

### Namespace and envelope

One key per environment and company:

```text
stk:face-prototype:v1:<environment>:<companyId>:db
```

The initial values are `environment = "standalone"` and `companyId = "stk-prototype"`. Validate/encode key segments. Never read, export, or clear unrelated localStorage keys.

```json
{
  "schemaVersion": 1,
  "databaseId": "<uuid>",
  "revision": 0,
  "createdAt": "<UTC ISO timestamp>",
  "updatedAt": "<UTC ISO timestamp>",
  "scope": { "environment": "standalone", "companyId": "stk-prototype" },
  "people": [],
  "templates": [],
  "attempts": [],
  "settings": {
    "matchThreshold": 0.363,
    "saveThumbnails": true,
    "maxPeople": 50,
    "maxAttempts": 200,
    "maxEstimatedBytes": 3145728,
    "displayTimeZone": "Asia/Manila"
  }
}
```

This is a schema illustration; placeholder UUIDs/timestamps are not valid seed data. The application starts with empty collections and no fake employees or scan results. Storage caps are prototype defaults, not a scaling claim.

### Record definitions

| Record           | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Person`         | `id`, `companyId`, nullable `storeId`, `employeeCode`, `normalizedEmployeeCode`, `displayName`, optional `department`, nullable `acknowledgedAt` (required before capture), `createdAt`, `updatedAt`, nullable `activeTemplateId`.                                                                                                                                                                                                                                              |
| `FaceTemplate`   | `id`, `personId`, `companyId`, nullable `storeId`, `version`, `embedding` (128 finite numbers), `modelIdentity`, `preprocessingVersion`, `qualityPolicyVersion`, capture quality measurements, nullable `thumbnailDataUrl`, `createdAt`. One active template per person.                                                                                                                                                                                                        |
| `CaptureAttempt` | `id`, `purpose` (`enroll` or `verify`), `personId`, `companyId`, nullable `storeId`, `personSnapshot` (code/name), nullable `templateId` and `templateVersion`, `startedAt`, nullable `capturedAt`, `completedAt`, `outcome`, nullable `reasonCode`, nullable `similarity`, `thresholdSnapshot`, nullable `modelIdentity`, `preprocessingVersion` and `qualityPolicyVersion`, `quality`, `timingsMs`, nullable `probeEmbedding`, nullable `thumbnailDataUrl`, `livenessStatus`. |
| `ModelIdentity`  | Detector and recognizer filenames, hashes and versions, runtime version, execution provider, and embedding dimension. Store a snapshot in records, not model binary contents.                                                                                                                                                                                                                                                                                                   |

`quality` contains the measurements actually available, such as detection confidence, face count/size, blur and exposure metrics. `timingsMs` separates detection, alignment, embedding, comparison and total processing time; wall-clock timestamps are not used to calculate inference duration. Unavailable values are `null`, never invented zeroes. `probeEmbedding` is retained when extraction succeeds, including a valid `NO_MATCH`, to make the temporary database inspectable.

Templates and attempts retain creation-time snapshots. Editing a person's name or changing the threshold must not rewrite old attempt results. Replacing a template can remove its old vector while retaining the historical attempt's template ID/version/model snapshot. That historical reference is descriptive, not a foreign-key requirement to keep old biometric vectors forever.

### What "everything in localStorage" means

All application records above are persisted in localStorage, including generated embeddings and optional bounded thumbnails. Full camera video, full-resolution source frames, tensors, OpenCV allocations, worker state, and ONNX/WASM program assets are transient or static program resources, not database records. No IndexedDB, backend, cloud database, or remote image storage is substituted for localStorage.

Thumbnails are compressed JPEG data URLs, at most 96 × 96 pixels and 4,096 characters including the prefix. For rejected captures with no unambiguous face, use a reduced full-frame thumbnail. If the bound cannot be met, store `null` and record a thumbnail omission reason in quality metadata. The retention toggle affects new records only; deletion controls remove existing data explicitly.

## 8. Persistence, consistency, and recovery

1. Validate parsed JSON, schema version, required fields, finite vectors, uniqueness, and scope before exposing the database. Match thresholds must be finite and within `[-1, 1]`; reject empty/invalid numeric settings. Reject unknown future versions. A migration must validate the complete candidate before replacing the old envelope.
2. Acquire one exclusive, lifetime **Web Lock** for the database's writer tab. Other tabs remain read-only and observe `storage` events. If Web Locks are unavailable, disable writes with an unsupported-browser message; do not pretend localStorage provides cross-tab transactions. [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
3. Serialize mutations through one in-tab repository commit queue as well as the cross-tab writer lock. For every operation, validate against the latest envelope, construct the next envelope, increment `revision`, serialize once, and call `setItem` once. Enrollment commits template, person link, and attempt together. Recheck person existence, scope and expected template version at commit; a changed/deleted enrollment requires a new capture, not silently applying the old result. Emit same-tab subscriptions only after the write succeeds.
4. Treat duplicate attempt IDs as an idempotent retry only if their immutable content matches. Reject conflicting reuse. A second click while processing cannot create another attempt.
5. Set an approximate application budget of 3 MiB using a documented conservative string-size estimate; show an 80% warning. Also enforce 50 people and 200 attempts. The first reached limit blocks additions; no silent eviction. The counter is not a claim of exact browser quota availability.
6. Catch storage access errors and `QuotaExceededError` even when the estimate is below budget. Keep the previous database and leave the new result visibly unsaved. Offer export, explicit deletion, and retry. Never automatically call `localStorage.clear()`.
7. Corrupt storage enters recovery mode: preserve the original string, disable writes, allow downloading it, and offer an explicit reset of this prototype key. Do not silently replace a corrupted database with an empty one.
8. A browser refresh restores only committed data. A pending in-memory result is lost on reload; communicate this while it is unsaved. Storage is per browser profile and origin, not shared across devices or deployment URLs. [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

Web Storage has a small quota; MDN documents up to 5 MiB for localStorage per origin and the need to handle quota exceptions. Images make that limit easy to reach. The implementation must measure its actual serialized records; changing host or using private browsing can change persistence behavior. [Storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## 9. Local Database viewer

Display **"Local Database — this browser only"**, the active key, schema version, revision, record counts, and estimated usage. All tabs read committed repository data. No table should synthesize records from camera preview state or a pending unsaved result.

| Tab                 | Default columns                                                                   | Record details                                                                |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| People              | Employee code, name, department, enrollment status, created/updated date, actions | Every stored person field and current template link.                          |
| Templates           | Person, version, model, embedding dimension, thumbnail, created date              | Full embedding, model hashes, quality data, scope and JSON.                   |
| Captures            | Time, purpose, selected person, outcome, score, threshold, duration, thumbnail    | Every attempt field, probe embedding when present, rejection reason and JSON. |
| Settings / Metadata | Key, value, type                                                                  | Complete settings, scope, database ID, timestamps and revision.               |

- Search people by code/name; filter captures by person, purpose, outcome and date. Use stable sorting with an ID tie-breaker and pagination of 10/25/50 rows.
- Display dates in `Asia/Manila` by default; raw JSON retains UTC. Similarity and threshold use the same visible precision, with exact values available in details.
- Every row exposes a details dialog containing all stored fields; avoid rendering long vectors/data URLs in the main table.
- **Export database JSON** downloads the exact validated envelope, including embeddings and thumbnails. Show what is included. Import is outside this MVP.
- **Delete capture** removes one attempt. **Clear capture history** removes all attempts after confirmation, retaining enrollment templates.
- **Delete person and data** removes that person, its templates and all associated attempts in one commit; preview counts first. **Reset prototype database** affects only this prototype key.
- **Refresh from storage** re-reads and validates the envelope; same-tab updates and other-tab storage events refresh automatically. Read-only tabs can inspect/export but cannot mutate.

## 10. Integration with STK

The following current host details were checked in the local checkout: React 19, MUI 7, React Router 6, the existing theme provider, and `src/routes.js` mapping the store biometric route to `QrScanTimeKeep`. The spec aligns with these major versions; it does not assume the route already implements facial recognition.

| Boundary           | Standalone prototype                                            | Later STK integration                                                                                                                                     |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell/theme/router | Own root providers and routes                                   | Mount exported feature screens under STK's existing providers; avoid duplicate `BrowserRouter` or theme roots.                                            |
| Person identity    | Local test person selected in `Autocomplete`                    | Receive the employee ID from STK's existing QR/authenticated workflow. Use real IDs, not display names or employee code alone.                            |
| Scope              | Fixed demo company and optional demo store                      | Receive company/store/account context from the host; server must independently authorize it.                                                              |
| Workflow           | `BrowserFaceWorkflow` performs local processing and persistence | Replace with `StkFaceWorkflowAdapter` for authoritative server verification/enrollment; retain a local engine for capture assistance only if appropriate. |
| Storage/query      | `LocalStorageRepository`                                        | API-backed data adapter with matching DTOs and explicit error mapping.                                                                                    |
| Result             | `PrototypeVerificationResult`, `authoritative: false`           | Server-issued verification result tied to employee, scope and action; production attendance must not trust a client boolean or score.                     |
| Database viewer    | Full local records, embeddings and reset controls               | Keep prototype-only; design production administration separately with access controls.                                                                    |

Export screens, contracts and the feature entry from `features/face-recognition/index.js`. Pass services/context as dependencies. Do not embed a backend URL, STK access token, hard-coded employee list, or imports from the production checkout in the standalone prototype.

Preserve model identity, preprocessing version, decision threshold and structured reason codes across adapters. A future move from browser inference to native OpenCV must pass the same fixture/parity checks before reusing templates. The adapter boundary makes migration easier; it does not make frontend-local biometric decisions secure for production.

Integration remains a later task: add a feature flag, scoped backend endpoints, authoritative decisions, actual retention/access controls, liveness evaluation, and attendance binding before enabling production timekeeping. Preserve STK's existing QR/manual fallback during that rollout.

## 11. Running and hosting the future prototype

Implement as a Vite static build with conventional `dev`, `build`, `preview`, `test`, and `test:e2e` scripts. Local operation uses `localhost`; a shared camera demo requires HTTPS. Use `getUserMedia({ video: ..., audio: false })`, stop tracks on exit, and handle denial, unavailable devices and camera-in-use errors. [Camera API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Serve application, runtime and model assets from the same origin where possible. The browser may download static assets, but no captured images, embeddings or application records are uploaded. No server runtime, Render private service or MongoDB connection is needed for this phase. Static assets must load without third-party font or inference services.

Cloudflare Pages currently limits a single asset to 25 MiB; the baseline full-precision SFace model is larger. Do not assume the entire build can be uploaded unchanged. Before a shared deployment, select static hosting that accepts the pinned model size, or implement a tested model-asset packaging strategy. Localhost development is unaffected. Hosting is not part of this documentation deliverable. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

Offline reload is not promised in the MVP. An already loaded session should process captures without network access once its models are ready. Browser storage clearing, changing origin and private-session termination can remove or separate data.

## 12. Implementation order

1. Prove real browser inference and OpenCV parity using fixed, permitted fixtures. Record model/runtime hashes and preprocessing details; calibrate initial quality gates.
2. Create the isolated Vite/React JS project, MUI theme, feature entry and interfaces.
3. Implement the repository, schema validation, writer coordination, capacity controls and a database viewer with empty collections.
4. Add person creation and enrollment; commit the template/person/attempt atomically.
5. Add 1:1 scanning, result persistence, raw record details, filters, deletion and export.
6. Verify failure behavior, built-asset loading, responsive UI, real-camera behavior and integration boundaries. Publish validation evidence separately from this proposed specification.

## 13. Acceptance criteria

| ID    | Required evidence when implemented                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01 | A separate React JavaScript/Vite app runs without starting any STK server or connecting to MongoDB.                                                                                                                                                          |
| AC-02 | Screens use MUI and the specified standard table components; no paid component license or recognition service is required.                                                                                                                                   |
| AC-03 | Browser network inspection shows static asset requests only during recognition; no frames, templates or records leave the browser.                                                                                                                           |
| AC-04 | Both real models load, an actual face embedding is produced, and malformed/missing assets show a model error without a mock fallback.                                                                                                                        |
| AC-05 | Fixed fixtures validate channel order, landmark mapping, crop alignment and normalized vectors against the pinned native OpenCV reference; record numeric tolerances and results. A local reference test is a development check, not an application backend. |
| AC-06 | Enrollment persists one person-linked template and its capture attempt together; failed replacement leaves the prior template usable.                                                                                                                        |
| AC-07 | Verification compares only to the selected person. Exactly-at-threshold and just-below-threshold numeric fixtures exercise the comparison rule.                                                                                                              |
| AC-08 | No face, multiple faces, low quality, camera failure, inference failure and incompatible templates have distinct outcomes and appropriate nullable fields.                                                                                                   |
| AC-09 | Reload restores committed people, vectors, settings and capture history; results are identical to exported JSON.                                                                                                                                             |
| AC-10 | All database fields are reachable in the table tabs and details, including template/probe vectors, timestamps, model identity and settings.                                                                                                                  |
| AC-11 | Search, filters, sorting and pagination operate on stored records and update after commits and cross-tab storage events.                                                                                                                                     |
| AC-12 | Quota or denied-storage failures preserve existing data, mark the new result unsaved, and allow an idempotent retry without duplicate attempts.                                                                                                              |
| AC-13 | Capacity warnings appear; limits block additions without deleting records. Thumbnail limits are enforced before serialization.                                                                                                                               |
| AC-14 | Two tabs cannot write concurrently; the observer tab stays read-only. Unsupported Web Locks do not fall back to unsafe concurrent writes.                                                                                                                    |
| AC-15 | Corrupt JSON and unsupported schemas preserve the original content and enter explicit recovery mode.                                                                                                                                                         |
| AC-16 | Deletion and reset affect only the selected prototype data; a sentinel unrelated STK localStorage key survives every destructive operation.                                                                                                                  |
| AC-17 | A repeated click makes at most one in-flight attempt; navigation/unmount stops camera tracks and ignores stale worker results.                                                                                                                               |
| AC-18 | UI is usable by keyboard and at narrow phone/desktop widths; processing/status and storage failures are announced.                                                                                                                                           |
| AC-19 | All results state liveness is unimplemented and `authoritative: false`; a browser result never calls attendance/timekeeping APIs.                                                                                                                            |
| AC-20 | Public feature exports can mount in a test host using injected services and an existing MUI theme/router without duplicate providers or production imports.                                                                                                  |
| AC-21 | Production static build loads local ONNX/WASM assets. Already initialized recognition completes with network disabled; cold offline reload is reported separately.                                                                                           |
| AC-22 | Record real-camera results and latency on the actual target devices. Chrome/Edge desktop are the initial target; Android Chrome and iOS Safari require separate validation before claiming support.                                                          |

Accuracy, device support, liveness, production security and scaling are not validated by these documents. Unit/browser fixture checks must be distinguished from real-camera and STK integration acceptance.

## 14. UML contents

[STK_FACE_RECOGNITION_PROTOTYPE_UML.puml](STK_FACE_RECOGNITION_PROTOTYPE_UML.puml) contains five named diagrams: component boundaries, stored domain model, enrollment sequence, verification/persistence sequence, and capture state machine. The diagrams describe this proposed frontend-only architecture.

The source can be rendered locally with PlantUML. Its Smetana layout option avoids a separate Graphviz installation: `java -jar <plantuml.jar> -Playout=smetana -tsvg STK_FACE_RECOGNITION_PROTOTYPE_UML.puml`. The renderer is documentation tooling, not an application dependency.

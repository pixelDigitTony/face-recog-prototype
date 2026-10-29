# Implementation and validation record

## CPU timing correction — 2026-10-29

Reproduced the deployed **Analysis delayed** loop using controlled 411 ms recognition passes, pose-worker delays and watchdog ticks during inference. Both the 500 ms observation-gap limit and the watchdog's use of capture age revoked otherwise continuous progress. The UI also displayed recognition time before pose inference, understating the full pipeline cost.

`liveTiming.js` now defines the explicit `cpu-cadence-v2` budget: maximum frame age, inter-observation gap and stalled-pipeline limit of 1.5 seconds. The watchdog distinguishes in-flight work from the last completed pipeline. True capture timestamps still govern evidence age; the UI's full-analysis measurement includes pose work. New attempts retain the timing policy with liveness evidence. Track continuity and stable comparisons use the same bounded observation gap. The strict >85% cutoff, three comparisons, pose/hold requirements, multiple-face rejection and five-second liveness expiry remain enforced. Single-face quality is assessed once per frame instead of twice.

Regression coverage includes complete synthetic motion-and-match sessions at 0, 561 and 1,000 ms pipeline costs, progress at 411 ms recognition, genuine stalls, and rejection of frames older than the fixed budget. These tests exercise the timing failure deterministically; physical webcam and deployed-device acceptance remain necessary.

Validation: **49 unit tests passed; 11 development Chrome tests passed; production-preview Chrome: 8 passed, 3 development-only cases skipped**. Production build, formatting and patch checks passed. No Vercel deployment was performed by this correction.

## Live tracking extension — 2026-10-29

Implemented the [live extension](STK_LIVE_FACE_TRACKING_SPEC.md) in the renamed `face-recog-prototype/` project. Enrollment and verification now start an explicit camera session. YuNet returns every post-NMS box/confidence/quality result; the UI mirrors and scales overlays and exposes an accessible detected-face list. Temporary geometric track IDs do not identify additional people. Multiple, missing, poor-quality or ambiguous faces revoke pending liveness and matching evidence.

The session coordinator runs one frame pipeline at a time, targets at most 8 detection samples/second and 3 identity comparisons/second, and skips intermediate frames. MediaPipe Face Landmarker 1.2.0 runs in a separate classic worker with CPU WASM and locally served, hash-verified model/runtime assets. A neutral baseline and cryptographically randomized left/right turns plus returns establish **basic motion liveness**. Tracking interruption, stale evidence, wrong/incomplete motions and timeouts cannot pass. A pre/post frontal embedding continuity check also revokes the challenge on a dissimilar face. Physical left/right prompt interpretation and target-camera usability still require device acceptance.

Live matching requires three consecutive fresh raw cosine scores **strictly greater than 0.85**, spanning at least 600 ms, and unexpired liveness for the same session/person/template/track. The minimum accepted score is retained. Matching exactly 85% fails. Percentage is a direct positive-cosine display conversion, not identity probability. Enrollment requires an explicit capture action after basic liveness and revalidates the next frame. Test images produce diagnostic-only results/templates, excluded from live verification.

One immutable terminal attempt is committed per session. Boxes continue after a terminal result; the result card is labelled as the last completed attempt. Explicit rearm starts another challenge. Storage failures remain unsaved and retry the same ID/evidence. Schema 1 migrates atomically to schema 2 under the existing writer lock/key, preserving historical outcomes and threshold snapshots. Migration failure keeps original bytes available for export. New columns expose percentage, source, liveness, face count and policy; JSON details/export expose the bounded challenge summary. Per-frame images, tracking histories and bystander embeddings are not stored.

Validation for the extension:

- **41 unit tests**: existing persistence/math/workflow coverage plus strict boundary/rounding semantics, stable score windows, randomized challenge completion/expiry/timing, wrong/stale motions, track ambiguity, migration preservation/failure, repository evidence validation, no high-score bypass, one terminal write and session cancellation. Complete passing session orchestration uses synthetic pose observations; this does not prove physical anti-spoofing.
- **11 desktop Chrome tests** in the development suite: real MediaPipe bundle loading and finite pose evidence, real YuNet/SFace/native parity, two-face streamed fixture with both rendered boxes and zero frame records, camera enrollment model readiness, missing liveness assets, responsive layout, media-track release, diagnostic enrollment/comparison, quota retry, reload, writer coordination and corruption recovery.
- Production build passed; static-preview Chrome suite: **8 passed, 3 intentionally skipped**. The omitted cases use development-only source imports/fixture endpoints; the remaining camera/model/error/storage/UI cases exercise bundled assets.
- PlantUML syntax check succeeds for the updated seven-diagram file; original capture diagrams are retained as baseline, with live sequence and state diagrams added. Desktop and mobile screenshots were inspected in `.local/`.

Remaining acceptance: physical webcams, Android/iPhone/Safari, accessibility with assistive technology, genuine/impostor calibration at 0.85, sustained 10-minute target-device performance/memory measurements, and photo/screen/replay/mask/virtual-camera attack evaluation. The model fixture tests demonstrate operation and parity, not population accuracy or validated PAD. No deployment, STK attendance integration or production biometric authority is claimed. The existing Vite chunk-size advisory remains nonfatal.

The sections below record the original 2026-10-28 implementation and its evidence; the extension above supersedes their manual-only behavior and `not_implemented` liveness description.

Implemented on 2026-10-28 in `facial-recog-prototype/`.

## Delivered behavior

- React 19 JavaScript/Vite application with MUI 7 and React Router 6.
- Explicit camera controls and a labelled test-image input; neither input uploads source images.
- Real YuNet/SFace ONNX inference in a dedicated worker using single-threaded WASM and local OpenCV.js image operations.
- Person creation/editing, acknowledged browser storage, one active face template, and explicit replacement on enrollment.
- Selected-person 1:1 verification with experimental threshold snapshots and structured outcomes.
- One scoped localStorage envelope with an in-tab commit queue, exclusive cross-tab Web Lock, idempotent attempt commits, bounded thumbnails, conservative capacity limits, and corruption recovery.
- MUI data tables for captures, people, templates, settings and metadata, including full JSON details and export, filters, sorting, pagination and explicit deletion.
- Injectable workflow/storage/engine boundaries and public feature exports for later STK integration.

The project-local specification reflects the user-selected folder. The original workspace-level design remains the earlier baseline. The included UML describes the implemented component, data, sequence and state boundaries; test-image capture uses the same frame interface as camera capture.

## Implementation choices made after the design

1. **YuNet uses 640 × 640 input.** The official 2023mar ONNX file has fixed 640 × 640 input metadata in ONNX Runtime Web. Native OpenCV can reshape it, so a native-only 320 × 320 test would not establish browser compatibility. Both browser and reference fixtures now use 640 × 640. The selected preprocessing identity is `opencv-yunet640-sface-rgb112-v1`.
2. **OpenCV.js stays a local program asset.** Its upstream UMD wrapper is adapted from top-level `this` to `globalThis` for loading in an ESM worker. This adaptation is explicit in `scripts/setup-assets.mjs`; package version is pinned.
3. **One workflow module.** `faceWorkflow.js` owns enrollment, verification, pending save retry and person deletion. There are no forwarding-only use-case files or a schema migration framework for a single supported version.
4. **Image test mode is additional.** It exercises the real recognition path without camera permission, with explicit UI labelling. It provides no liveness evidence.
5. **Resource lifetime is explicit.** Route exit stops camera tracks and aborts pending captures. Page exit disposes the worker and writer lock; a page restored from the back/forward cache reloads to reacquire services safely.

## Tests and measurements

`npm test`: **23 unit tests passed** across persistence, workflow and recognition/query math. Coverage includes competing same-tab writes, duplicate IDs, failed quota writes, idempotent save retry, prior-template preservation on failed replacement, stale enrollment snapshots, corrupt/future schemas, company scope, capacity, deletion isolation, cancellation, match boundaries, and Manila date filtering.

Development browser suite: **6 tests passed in installed desktop Chrome**. The tests cover real enrollment/verification and reload, failed-save retry, a read-only second tab, corrupt-store recovery, missing-model readiness errors, unsupported Web Locks, local-only network traffic, mobile layout overflow, native parity, and camera stream cleanup using Chrome's synthetic camera device.

Production static build is verified separately with `npm run build` and the browser suite against `npm run preview`: **5 passed, 1 intentionally skipped**. The source-level native-parity case is intentionally skipped in production-preview mode because the native fixture generator and source module imports are development-only.

Native baseline: `opencv-python-headless==4.12.0.88`, installed only in ignored `.local/reference-env` for testing. There is no Python application service.

| Fixture                       | Browser/native embedding cosine | Maximum landmark difference |
| ----------------------------- | ------------------------------- | --------------------------- |
| OpenCV Lena sample            | 0.99999796                      | 0.000017 pixels             |
| OpenCV Messi sample, upscaled | 0.99999977                      | 0.000041 pixels             |

Acceptance tolerances were cosine greater than 0.995 and maximum landmark error below 2 pixels. Both clear those tolerances. Browser comparison between the two different sample identities produced **0.14027**, below the experimental 0.363 threshold. A blank frame returns `NO_FACE`; a two-face image returns `MULTIPLE_FACES`; the original small Messi face returns `LOW_QUALITY`. Already initialized inference also completed with the browser network disabled.

These two fixtures validate pipeline parity, not population accuracy or a production operating threshold. Observed fixture processing was approximately 0.2–0.3 seconds on this desktop Chrome run; this is not a promise for mobile devices or other hardware.

## Acceptance boundaries

| Criteria | Evidence / remaining work                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01–04 | Standalone build, MUI screens, same-origin GET-only browser traffic, real model initialization and explicit missing-model error.              |
| AC-05    | Native parity fixtures and numeric tolerances above.                                                                                          |
| AC-06–09 | Atomic persistence/workflow unit tests, real browser enrollment and matching, threshold/math tests, model mismatch and reload.                |
| AC-10–11 | Database tabs, details, exports and query controls implemented. Rendered desktop/mobile checked; Manila query boundaries tested.              |
| AC-12–16 | Quota retry, write serialization, observer tab, unsupported coordination, recovery/schema tests and scoped deletion checks.                   |
| AC-17    | Pending capture cancellation test and browser synthetic-camera track cleanup. Physical camera behavior remains to be checked.                 |
| AC-18    | MUI labels, roles, keyboard-focus controls, live status and responsive renders. Full assistive-technology acceptance remains to be checked.   |
| AC-19    | Prototype copy and non-authoritative workflow result. Browser traffic contains no attendance/API writes.                                      |
| AC-20    | Services are injected and feature exports have no router/theme root. Mounting in the actual STK application remains a later integration test. |
| AC-21    | Static build and local preview verification; initialized offline inference passed. Cold offline reload is excluded.                           |
| AC-22    | Desktop Chrome fixture evidence only. Physical webcam, Android, iOS Safari, employee accuracy and performance acceptance remain pending.      |

## Remaining product acceptance

Test the actual target cameras, lighting, employees, devices and browsers before drawing conclusions about recognition accuracy. Calibrate threshold and quality gates with genuine/impostor samples; evaluate liveness separately. Production authentication, biometric data protection, retention, authorization and STK timekeeping binding are outside this frontend prototype.

The Vite build may report an initial JavaScript chunk-size advisory; it still builds successfully. The large SFace model is deliberate and locally served. This task does not deploy to Cloudflare/Render or connect to MongoDB.

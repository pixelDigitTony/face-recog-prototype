# Implementation and validation record

## Automatic multi-person identification — 2026-10-29

Implemented [the automatic identification specification](STK_AUTOMATIC_FACE_IDENTIFICATION_SPEC.md). `/scan` now starts a continuous 1:N gallery search without a person selector, motion instructions, challenge progress or manual next-verification step. Every detected face receives its own track, current score, accepted name/code or Unknown/Ambiguous/quality/waiting status. Multiple faces are independent; enrollment retains its single-person active challenge and explicit capture with retained completion/readiness.

The recognition worker holds one source frame, detects once, extracts at most two selected faces from that exact frame, ranks against the complete scoped gallery, then releases the source. Scheduling is fair across tracks and bounded to six embeddings/second overall and three/second per track. Identity windows require three fresh samples for the same person/template/gallery across at least 600 ms. Every winning score must be strictly above 0.85, uniquely above that threshold, and at least 0.05 above a runner-up when present. The displayed percentage is unchanged raw cosine conversion. Conflicting tracks cannot both claim one identity. Stale/contradictory evidence clears current names; tracking geometry never serves as identity proof.

Schema v3 adds `identificationEvents` with nullable identity for unknown/ambiguous searches and explicit `livenessStatus: not_checked`, `liveness: null`, `authoritative: false`. The new collection stores bounded score evidence without probe vectors or thumbnails. v1/v2 migration preserves old records and policy interpretation, uses the same key/writer lock, and writes the migrated envelope atomically. Combined attempts/identifications share the existing 200-record and 3 MiB limits. The database viewer supports the new history, filters, details, export, scoped deletion and explicit clearing. Failed saves retain one immutable event and pause identification until retry/discard. Deduplication is per encounter/outcome/gallery, with a 10-second person cooldown across track churn and a bounded 200-key recent decision cache per track.

Implemented the review corrections: guarded compatibility checks handle absent legacy detector metadata, an independent content-hashed gallery version prevents scan writes from invalidating their own search, per-track ambiguity protects unrelated faces, five-second recognition stalls end the session, and cancellation/disconnection releases streams/workers. Stop while camera permission is pending releases the late stream. Scan does not initialize or request MediaPipe/liveness assets; enrollment still fails explicitly if those assets are unavailable. Selected-person image comparison is available in Settings as diagnostics.

Validation includes 88 passing unit cases covering ranking/cutoff/margin behavior, 50-person gallery/three-track scheduling, unknown/ambiguous decisions, duplicate identity conflicts, gallery mutation during analysis, deduplication across gallery changes and cooldown, immutable retry, combined capacity, migration/reload/deletion, missing detector metadata and retained enrollment behavior. Real-model browser tests identify two distinct image subjects in one feed with separate current/history labels, changed brightness/position relative to enrollment, no scan liveness asset requests, and no repeated events. The app does not seed these test-only fixtures. Desktop/mobile screenshots were inspected in `.local/automatic-identification-*.png`.

Nine local worker timing samples cover 1/2/3 detected faces and galleries of 1/10/50, with no more than two comparisons per frame; measurements are in `.local/identification-performance.json`. They are fixture inference timings, not target-device throughput or accuracy certification. Physical-camera genuine-user/unknown-person testing, shift-length memory/thermal behavior, target-device calibration and deployed Vercel acceptance remain separate. The strict 85% rule and 0.05 margin can reject genuine users and have not been calibrated for STK. No deployment was performed.

Final local checks: **88 unit tests passed; all 14 development Chrome tests passed; production-preview Chrome: 9 passed, 5 development-only cases skipped**. The final production build, full Prettier check, eight-diagram PlantUML syntax check and patch whitespace check passed. The five preview skips use source-level fixture/model imports; they passed in the development suite. The build retains the existing nonfatal large-bundle advisory.

## Latched enrollment and direct saved-template matching — 2026-10-29

Reproduced both reported failures with regression tests. Completed enrollment still ran repeated pose/identity validation, causing ready-state flicker. Verification also required an extra pre/post-challenge probe similarity above 0.85 before comparing with the saved template. Two probes can each match a reference at 0.9 yet have mutual similarity 0.62; that extra gate incorrectly blocked the real comparison.

Enrollment now prepares a canonical embedding after the challenge, then performs detection/tracking alone while ready. There is no candidate-age countdown or repeated pose/SFace validation while waiting for a click. Clicking requests one new capture taken at or after the click and checks its quality, pose against the recorded neutral baseline, track continuity and similarity to the post-challenge candidate. Rejected quality/pose/reference checks show corrective feedback and return to ready with completion retained. Real tracking/context breaks still prevent capture; a saved attempt still needs a fresh final observation. The neutral baseline is shared by the challenge and final capture instead of applying conflicting relative/absolute yaw gates.

Verification now compares eligible frames directly with the selected saved enrollment. The strict raw cosine >0.85 rule and stable three-sample window remain unchanged. Three valid below-threshold samples save `NO_MATCH` with `BELOW_MATCH_THRESHOLD` and show the measured percentage and retry guidance. This fixes blocked comparisons; it does not guarantee that every genuine face exceeds the requested threshold.

New coverage includes ready-state stability with no pose calls during detection-only frames, post-click quality/pose/reference rejection and retry, a biased neutral baseline, real template matches with dissimilar pre/post probes, and explicit below-threshold results. A new browser integration test uses real YuNet/alignment/SFace with a streamed still-image fixture and **simulated pose observations** to exercise enrollment, stable readiness, local persistence and a saved-template `MATCH`. It validates UI/model integration, not physical liveness or spoof resistance. The following sections retain prior implementation evidence; this section supersedes their continuous readiness checks and pre/post probe gate.

Validation: **63 unit tests passed; all 12 development Chrome tests passed; production-preview Chrome: 8 passed, 4 development-only cases skipped**. The production build, full formatting check, seven-diagram PlantUML syntax check and patch checks passed. Inspected `.local/enrollment-latched-ready.png` and `.local/saved-template-match.png`. The fixture matched its saved embedding above 99%; this is integration evidence using the same image, not a genuine-user accuracy measurement. These changes have not been deployed. Physical-camera enrollment/verification, target-device timing and matching calibration remain acceptance work.

## Retained challenge progress — 2026-10-29

`head-turn-v2` retains completed steps for the same tracked face. Wrong or incomplete motions restart only the current hold, and the current instruction remains available to retry. Removed the former 8/25-second action limits and five-second completion expiry. Active challenge/completed progress is exempt from the 45-second acquisition deadline. A completed challenge stays ready while that same face continues in the same camera session; no wall-clock timer clears it.

Temporary quality/landmark failures, brief missed detections and identity uncertainty pause capture without erasing completed steps. A fresh pose and compatible original-face embedding must confirm readiness again. Multiple/ambiguous faces, prolonged lost continuity, changed identity/template context or camera stop/restart still require a new challenge. Pending enrollment cannot be saved using stale or unconfirmed observations.

New saved attempts bind liveness to their session and track and store `validity: continuous_session`, `expiresAt: null`, original step completion timestamps and a fresh `lastValidatedAt`. Validators require the final observation to be at most 1.5 seconds old. Existing `head-turn-v1` history keeps its original timed rules, so no database reset/migration is needed. Matching still requires three raw scores strictly above 0.85.

Unit coverage includes a two-minute wait before enrollment, a minute of incorrect motion before resuming the next step, temporary quality/missed-face recovery, blocked identity uncertainty, and rejection of stale/cross-session/cross-track completion evidence. The next sections describe earlier implementation decisions superseded by this progress policy.

Validation: **59 unit tests passed; 11 development Chrome tests passed; production-preview Chrome: 8 passed, 3 development-only cases skipped**. Tests also cover turning away for nine seconds and returning without repeating the completed challenge. Production build, formatting, UML syntax and patch checks passed. Deployment and physical-camera acceptance remain separate.

## Stable enrollment readiness and instruction placement — 2026-10-29

Reproduced the enrollment flicker by observing all workflow notifications after liveness passed: the same session alternated between `comparing` and `ready_to_enroll`, including frames without a new embedding. Enrollment now retains an explicit candidate bound to its track and capture time, publishes one appropriate phase per observation, and keeps readiness between embedding updates. The capture click latches `capturing_enrollment` until the next fresh validated embedding can be committed. Missing/multiple faces, unsuitable pose, stale evidence and expired liveness still revoke readiness; repeated capture clicks cannot create duplicate enrollments.

The next-step prompt and challenge progress are anchored directly above each tracked face's details label inside the live camera feed. Labels follow the face box and stay within the preview; each contains its face ID and detection confidence, with similarity when available. Until a face is detected, instructions appear at the top of the camera preview. One full prompt is announced accessibly while visual per-face copies remain hidden from screen readers. Ready-to-enroll copy names the actual action button; the adjacent list retains full face details.

Unit coverage now totals **53 passing cases**, including stable ready notifications, click latching/one save, a second face before capture, turning away and liveness expiry. Browser assertions check instructions inside the camera on desktop/mobile, instructions above each tracked label's details and matching track IDs. Physical-camera and deployed-device acceptance remain pending; no deployment is performed here.

Validation: **11 development Chrome tests passed; production-preview Chrome: 8 passed, 3 development-only cases skipped**. Production build, formatting, UML syntax and patch checks passed. Desktop and mobile instruction-placement screenshots were inspected.

Latest placement clarification: instructions now follow tracked face labels within the feed. The **5 focused live-camera Chrome tests** and production build passed for this UI correction; the browser assertions cover fallback instructions in the feed, per-track prompt/details ordering, matching box IDs and mobile label bounds. Workflow logic is unchanged by this placement correction.

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

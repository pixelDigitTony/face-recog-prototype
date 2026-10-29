# STK live face tracking, matching percentage and liveness

Status: implemented extension; see IMPLEMENTATION.md for automated evidence and remaining physical-device, calibration and spoof evaluation.  
Date: 2026-10-29.  
Project: `face-recog-prototype`.  
Baseline: [implemented prototype specification](STK_FACE_RECOGNITION_PROTOTYPE_SPEC.md) and [implementation evidence](IMPLEMENTATION.md).

## 1. Requested outcome and selected design

Extend the React JavaScript/MUI prototype with continuous camera analysis, boxes and details for every detected face, a matching percentage, and a basic liveness challenge. Keep computation and application data in the browser, with localStorage as the pretend database. Preserve injectable feature boundaries for later STK integration.

Recommended scope: **live multi-face detection and tracking, with selected-person 1:1 verification and randomized head-turn liveness when exactly one face is visible**. Multiple-face detection does not mean identifying everyone. Temporary track IDs label detections, not employee identities. Do not silently add a search across all enrolled people.

This extension supersedes the baseline's manual-verification-only behavior, raw-score-only display, adjustable 0.363 default and exclusion of basic liveness. The baseline records the original capture flow; implementation evidence records the verified extension and acceptance limits. No deployment has been performed.

## 2. Options and recommendation

### Live operation

| Option                                     | Behavior                                                                                                                   | Tradeoff                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A. Live guidance                           | Draw face boxes and quality guidance; user clicks to capture and compare.                                                  | Least work and lower recognition workload; matching is still manual.                                                             |
| **B. Live 1:1 verification — recommended** | Draw all faces; select an enrolled person; automatically run a challenge and stable comparison once only one face remains. | Fits the current workflow and future QR-supplied identity; requires session control and duplicate suppression.                   |
| C. Live 1:N identification                 | Compare faces against every enrolled person and label possible identities.                                                 | Adds ambiguity handling, candidate margins, gallery-scale testing and multi-person liveness association; outside this extension. |

### Liveness

| Option                                                           | Tools                                                                                         | Decision                                                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Randomized active challenge — recommended for this prototype** | Add `@mediapipe/tasks-vision` Face Landmarker for head orientation; retain YuNet and SFace.   | Browser-only, with no hosted recognition API/account. Checks prompt response; does not establish robust spoof resistance.                                                     |
| Passive presentation attack detection (PAD)                      | Evaluate a model such as upstream Silent-Face-Anti-Spoofing/MiniFASNet with ONNX Runtime Web. | Possible later layer; exact weights/license, export correctness, browser operators, preprocessing, thresholds and target-camera performance must be verified before adoption. |
| Active challenge plus validated passive PAD                      | Combine motion response with a separately evaluated anti-spoof model.                         | Preferred investigation before production attendance use; more assets, device load and validation work. Not claimed delivered by this phase.                                  |

MediaPipe supplies landmarks and facial transforms, not a certified liveness verdict. Its web inference can block its calling thread; execute analysis in workers. See the [official web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js). The passive-model upstream warns that results depend on camera and scene; its advertised mobile metrics are not this browser's performance ([upstream documentation](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/README_EN.md)).

## 3. Matching percentage: strict rule

Use an explicitly versioned display conversion, not an invented confidence calibration:

```js
// s is finite cosine similarity from normalized SFace embeddings.
const matchPercentage = 100 * Math.max(0, Math.min(1, s));
const similarityPassed = s > 0.85;
```

- Label: **Match similarity**. Helper: **Similarity score, not identity probability**.
- The user rule is **above 85%**: exactly `0.85` / `85%` fails. Do not use `>=`.
- Compare unrounded raw cosine; show two decimal places. For values rounded to `85.00%` on either side, also show the raw score and whether it is above the cutoff. Never let display rounding determine the outcome.
- Negative cosine displays `0%` and fails; preserve its raw value. Missing/invalid scores show `—` and cannot pass. Invalid vectors/nonfinite or materially out-of-range scores cause an inference error; clamp only normal numerical drift at cosine bounds.
- Set `scoreMappingVersion: cosine-positive-percent-v1`, `decisionPolicyVersion: live-85-strict-v1`, raw threshold `0.85`, percentage threshold `85`, and operator `>`.
- The new workflow does not offer a settings override that silently weakens the requested threshold. Historical records keep their own threshold and operator.
- A high similarity alone must never display final **MATCH** while liveness is pending, failed or expired.

This changes recognition behavior substantially. OpenCV documents an example SFace LFW cosine cutoff of **0.363**, with different cutoffs on other datasets; `0.85` is much stricter. Do not relabel 0.363 as 85%, or claim that 85% means 85% accuracy. Measure false rejection and false acceptance using target users/cameras before deciding whether to revise the requested rule ([OpenCV reference](https://docs.opencv.org/4.9.0/d0/dd4/tutorial_dnn_face.html)).

| Raw cosine | Display | Similarity gate         |
| ---------- | ------- | ----------------------- |
| 0.8499     | 84.99%  | Fail                    |
| 0.8500     | 85.00%  | Fail                    |
| 0.8501     | 85.01%  | Pass                    |
| 0.9200     | 92.00%  | Pass                    |
| null / NaN | —       | Unavailable; never pass |

## 4. Camera, multiple people and face overlays

1. Start only after the user presses **Start live scan**. Tracking can run without a selected person; matching requires a selected acknowledged enrollment. Audio stays off.
2. Run YuNet on sampled frames and return the full post-NMS detection list, including boxes, five landmarks and detector confidence. Today the worker returns face count but omits boxes; extend its result contract. Do not discard extra detections before checking the multiple-face gate.
3. Render a box for every returned detection. Labels show `Face #<trackId>`, **Detection confidence**, and status such as **Detected**, **Too small**, **Poor lighting**, **Multiple faces — verification paused**, **Checking liveness** or **Comparing**.
4. For the single eligible face, also show selected employee name/code as **Verifying against …**, live match similarity and liveness step. A name in this label is the selected reference, not a recognized identity. Label a final result **Matched to …** only after all gates pass. Other faces have **Match: — (not compared)** and **Liveness: not checked**.
5. Use blue for detection/checking, amber for blocked/quality states, green only for a completed match, and red for a terminal failed check. Pair colors with text. A score over 85% with incomplete liveness remains blue.
6. Track IDs use deterministic one-to-one geometric association (IoU plus normalized center displacement), expire after 1.5 seconds unseen, and reset when the camera/session resets. Crossing faces or ambiguous assignment invalidate continuity. Do not infer real-world identity from a track ID.
7. If two or more faces appear, clear the score/stability window, revoke any pending liveness pass, and pause verification immediately. Draw all detections and show **Only one person may complete verification at a time**. A small/background second face still blocks; detection is limited by model visibility/quality and cannot promise to find every person in a scene.
8. When exactly one face remains stable for 1 second, issue a fresh challenge with a fresh track/session binding. Never choose the largest face automatically to bypass the multi-face gate. A second face during finalization cancels the pending decision before commit.
9. Mirror overlays exactly with the front-camera preview, using the actual frame size, `object-fit: cover` scale/crop offsets, container size and device pixel ratio. Keep labels upright and within the preview. Cover resize, orientation and rear-camera unmirrored behavior.
10. Clear score/boxes if the current pipeline exceeds 1.5 seconds or no completed analysis arrives for 1.5 seconds. The watchdog uses completion time to distinguish bounded CPU work from a stalled scan; evidence freshness still uses capture time and a 1.5-second maximum frame age. Show actionable **Analysis is taking too long** feedback for an actual stall. Do not interpolate identity or liveness evidence between frames.
11. For crowded scenes, preserve all returned detections and the actual detected count. Labels may collapse to IDs with a scrollable MUI **Detected faces** list for full details; never silently report one face because rendering or inference was capped. If processing cannot keep up, pause verification with a resource error.

The face list duplicates overlay information for keyboard/screen-reader access. Announce state changes, not every percentage update. No thumbnails or embeddings of additional bystanders are persisted.

## 5. Live scheduling and resource lifecycle

- Use `requestVideoFrameCallback` where available, with a feature-detected animation-frame fallback that checks for a new video timestamp. Throttle to a target of 8 analysis samples/second, adapt down on slower devices, and measure actual throughput. This is a target, not a promised frame rate ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)).
- Maintain at most one analysis pipeline in flight. Skip intermediate frames rather than queueing video. YuNet runs first; only a single eligible face enters the liveness/embedding stages. Perform SFace comparison at no more than 3 samples/second, prioritizing liveness sampling while prompts are active. Do not synthesize scores between comparisons.
- Add `analyzeFrame` and pure comparison operations; do not repeatedly call the existing `verify()` method, which persists each call. Keep high-frequency frame results in memory. Generate thumbnails only for a terminal attempt, not every frame.
- Tag every request/result with session generation, frame ID, monotonic capture timestamp, person/template version and track ID. Reject out-of-order or obsolete replies and free transferred buffers, ImageBitmaps, Mats and tensors promptly.
- Stop remains usable while loading or analyzing. On stop, route exit, hidden tab, camera disconnect, context/template changes or writer-lock loss: cancel scheduled work, invalidate session/challenge, clear transient data and stop tracks. Returning to the page requires explicit restart. Hidden-tab handling follows [MDN visibility events](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event).
- Aborting the UI promise alone does not stop existing worker inference. Do not start a new overlapping job until it finishes, or terminate and reinitialize the worker. A hung worker causes an error and cannot release a stale success later.
- A read-only tab may inspect saved data but cannot start a verification/enrollment session. Retain current single-writer Web Lock and serialized persistence semantics.

## 6. Basic liveness challenge

### Protocol

Use Face Landmarker in video mode for a single-face candidate; YuNet remains the authoritative multi-face gate. Cross-check the landmark face against the YuNet box in the same frame. Preserve unmirrored model coordinates and explicitly test the mapping to **your left/right** prompts.

1. Acquire one continuous track and a frontal neutral baseline for 1 second.
2. Generate a fresh challenge ID and cryptographically randomized ordering of two actions: **Turn your head left** and **Turn your head right**, each followed by **Look straight ahead**. Never persist/reuse a previously passed challenge on reload.
3. Derive yaw from the facial transformation matrix against the neutral baseline. Initial experimental thresholds: neutral within 10 degrees; directed turn at least 20 degrees and no more than 40 degrees; hold each turn and return for at least 300 ms with at least 2 fresh observations. Require the full observed transition; already being turned when the prompt starts does not satisfy it.
4. Allow 8 seconds per directed-turn-and-return action, with a 25-second total challenge limit. Use monotonic capture time: frames older than 1.5 seconds and observation gaps greater than 1.5 seconds cannot advance the challenge. `cpu-cadence-v2` records these explicit timing limits with new attempts. The former 500 ms limit reset ordinary CPU inference; completed-frame and in-flight timing are now tracked separately. Pose/hold requirements and the 5-second pass lifetime remain mandatory.
5. Any second face, missing face, ambiguous track, cross-model disagreement, unacceptable landmark quality, discontinuous pose jump, person/template change, or camera/session restart invalidates progress. Reacquire a stable frontal face and issue a new challenge. Do not keep partially completed steps across these interruptions.
6. Hold SFace scoring during large turns when recognition quality is poor. Compare frontal observations before and after the challenge; every accepted identity sample must reference the same selected template and uninterrupted track. This is a continuity heuristic, not proof against face swaps or injected frames.
7. A challenge pass is valid for at most 5 seconds and only for that session, person, template and track. Require a final fresh single-face frontal observation and stable match window before using it. Reuse for another attempt is prohibited.

Store method `active_head_turn_v1` and status `passed_basic`, `failed`, `expired`, `not_checked` or `unavailable`. Display **Basic liveness passed — motion challenge only**. Do not use a made-up liveness percentage, or label an unavailable check as passed.

Blink detection may be added later using landmark/blendshape temporal evidence; a single closed-eye frame is not a blink. It is not required by this design. If a user cannot complete the movement, allow cancel/retry and record that outcome; do not provide a button that marks liveness passed.

### Limits and model assets

This is a basic interactive motion check. It does not reliably reject all printed photos, moving screens, replayed video, masks, real-time synthesis or virtual-camera injection. Browser-local decisions and localStorage can be modified by the device user. Keep `authoritative: false`; never grant STK attendance/authentication from this result alone.

Pin the exact MediaPipe package, WASM and model bundle during implementation; record source, version, hash and code/model redistribution notices in the existing asset manifest/lock and licenses directory. Serve assets locally. Missing assets, failed integrity checks or unsupported workers produce **Liveness unavailable**, never a fallback success. The exact asset compatibility and license check is an implementation prerequisite, not evidence already obtained by this spec.

Evaluate spoof handling separately from similarity accuracy. NIST's PAD work assesses attacks presented to face capture systems; motion completion alone is not equivalent to a tested PAD result ([NIST PAD overview](https://pages.nist.gov/frvt/html/frvt_pad.html)).

## 7. Session, decision and persistence behavior

States: `idle → loading → tracking → acquiring_single_face → challenging → comparing → saving → completed`. Exceptional states: `multiple_faces`, `quality_blocked`, `liveness_failed`, `save_failed`, `camera_error`, `model_error`, `stopped`. Tracking/blocked states continue updating boxes; they do not create database rows per frame.

After liveness passes, require **3 consecutive eligible frontal comparisons, each raw cosine > 0.85**, spanning at least 600 ms with gaps no greater than 1.5 seconds. All samples must be fresh, same track/template/session and within the 5-second liveness validity window. Do not average a below-threshold sample into a pass. Save the minimum of these three similarities as the terminal score; label the live latest score separately from the final minimum.

Final `MATCH` requires: compatible template + exactly one continuous face + quality gates + unexpired basic liveness + stable similarity window + unchanged context at commit. Mark **Saved locally** only after persistence succeeds. `MATCH` is an experimental prototype outcome, not permission for attendance.

- Three consecutive eligible comparisons at or below 0.85 after a completed challenge yield `NO_MATCH`; preserve the most recent comparison as the terminal score and label aggregation `last`. Mixed results that do not stabilize before expiry yield `INCONCLUSIVE`, not `NO_MATCH`.
- Challenge timeout yields `LIVENESS_FAILED`; expired successful evidence yields `LIVENESS_EXPIRED`. An acquisition/challenge session has a 45-second overall limit so repeated face interruptions cannot loop forever. At overall timeout record the current blocking reason (`MULTIPLE_FACES`, `NO_FACE`, `LOW_QUALITY` or `INCONCLUSIVE`).
- An attempt session begins only once a person/template is selected and scanning is armed. Observe-only tracking never writes attempts. Manual stop cancels an unfinished attempt without a row; explicit timeout/error decisions may save one bounded summary.
- Save exactly one terminal attempt per session. After completion keep face boxes updating, but freeze the previous result in a card labelled **Last completed attempt**. Clear current similarity/liveness. Require **Start next verification** for a new attempt/challenge; remaining in frame must not repeatedly log the person.
- Save failure retains the immutable terminal attempt in memory and blocks new attempts until retry/discard. Retry uses the same attempt ID and evidence, without rescanning. Never display an old completed result as the current face's result.
- Enrollment remains explicit: require basic liveness before saving a new camera enrollment; show **Capture & enroll** only while the pass is valid for the same uninterrupted track. Do not automatically replace existing templates. Historic enrollments may remain references but are labelled **Enrollment liveness not checked**.
- Test images remain a clearly separated diagnostic mode. They may display similarity and `similarityPassed`, but cannot pass liveness or produce a live `MATCH`/liveness-approved enrollment. Use `DIAGNOSTIC_ONLY` attempt outcome. A diagnostic enrollment, if retained for fixtures, is marked as such and excluded from live verification until replaced by camera enrollment.

## 8. Local database contract and migration

Introduce envelope schema version 2. Retain the current scoped storage key as a stable namespace despite its existing `v1` prefix, and the same lock; do not create an uncoordinated second database. Validate schema 1, migrate a clone in memory under the writer lock, validate v2 and commit with one atomic `setItem`. Preserve the original on migration/quota failure and offer raw JSON export. Unknown/corrupt versions remain in recovery mode. Old app builds must reject v2 without resetting it. Recommend exporting before deploying a schema upgrade; no implicit destructive reset or duplicate backup that consumes the quota.

Keep historical people, templates, attempt IDs, timestamps, outcomes and raw scores. Assign old records policy `legacy-cosine-v1`, operator `>=`, their original threshold and `not_implemented` liveness. Derived percent may be displayed but must not reclassify historical results under the new 85% policy. Existing settings migrate to the fixed new live policy; original historical threshold snapshots remain intact. Add template enrollment source/liveness provenance, using `legacy_unknown` for existing templates rather than inventing a pass.

New attempt fields, in addition to the existing context/model/quality/timing fields:

| Field                                                                    | Requirement                                                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessionId`, `source`                                                    | Unique attempt session; `live_camera` or `test_image`.                                                                                                 |
| `scoreMappingVersion`, `decisionPolicyVersion`                           | Explicit conversion and decision rule IDs.                                                                                                             |
| `similarity`, `matchPercentage`                                          | Unrounded terminal raw cosine and derived percent; both null when unavailable.                                                                         |
| `thresholdSnapshot`, `percentageThresholdSnapshot`, `comparisonOperator` | `0.85`, `85`, `>` for new live attempts.                                                                                                               |
| `scoreAggregation`, `stableSampleCount`, `stableDurationMs`              | `minimum` for a stable match, `last` otherwise; sufficient summary to explain final score.                                                             |
| `faceCountAtDecision`, `maxFaceCountObserved`, `trackId`                 | Session summary only; track ID is not an employee ID.                                                                                                  |
| `livenessStatus`, `liveness`                                             | Method/policy/asset IDs, challenge ID, ordered prompts, step completion timestamps, started/passed/expiry times and failure reason. No frame sequence. |
| `authoritative`                                                          | Always `false`.                                                                                                                                        |

Validate invariants in the repository, not just the UI: new `MATCH` records require all gate summaries and matching source/policy; diagnostic records cannot claim liveness; percentage must agree with raw cosine; retries cannot change evidence. Add new outcomes to validators, filters, result styling and export readers together.

Retain 50-person, 200-attempt and estimated 3 MiB capacity limits. Store a bounded challenge summary, selected final embedding and optional existing bounded thumbnail only. Do not store per-frame boxes, landmark streams, bystander details or video. People/templates/attempts/settings/metadata remain inspectable through the existing tables and full JSON details. Add columns for **Match similarity**, **Liveness**, **Source**, **Face count**, **Policy**, **Outcome** and **Saved at**; raw cosine and challenge summary remain available in details/export. Deletion must remove associated new evidence as well.

## 9. File organization and integration seams

Preserve `.jsx` components, `.js` utilities and existing aliases/service injection. Proposed additions:

```text
src/features/face-recognition/components/
  LiveScanWorkspace.jsx       # camera controls and MUI state presentation
  FaceOverlay.jsx             # all boxes; no recognition or persistence
  DetectedFacesList.jsx       # accessible per-face details
  LivenessPrompt.jsx          # challenge instructions/progress
src/utils/hooks/faceRecognition/
  useLiveFaceTracking.js      # React lifecycle and scheduler subscription
  workflows/liveFaceWorkflow.js
  recognition/frameScheduler.js
  recognition/faceTracker.js
  recognition/matchPolicy.js
  liveness/activeChallenge.js # pure temporal state machine
  liveness/faceLandmarkerAdapter.js
  repositories/migrateDatabase.js
src/workers/liveness.worker.js
```

Extend existing `browserFaceEngine.js`/`workerHandler.js` to return all detections and separate analysis from persistence; reuse YuNet preprocessing, SFace alignment and existing math. The coordinator serializes work across recognition and liveness workers. Keep `CaptureWorkspace` for explicit enrollment/diagnostics; compose shared camera/overlay components rather than forking inference code. Update contracts, constants, services factory, schema validation, result/table components and settings together. Place any new dialogs under `src/components/dialogs/faceRecognition`.

Contract boundaries: `FaceEngine.analyzeFrame(frame, options, signal)` yields frame-tagged detections/optional embedding; `LivenessEngine.observe(frame, face, timestamp, signal)` yields pose evidence; pure `ActiveChallenge.update(evidence)` yields state; `LiveFaceWorkflow` owns sessions, gates and one terminal commit. UI never writes directly to localStorage or decides an identity from display text.

STK integration supplies scoped identity from its eventual QR flow and replaces local workflow/repository decisions with a server API. Preserve company/store/person/template binding; do not introduce imports from the production STK app. Keep the local database viewer prototype-only. Static Vercel deployment remains sufficient for this phase; no Render/MongoDB service or API secret is required.

## 10. Acceptance and verification plan

| ID    | Required evidence                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LT-01 | Start/stop live camera; real boxes move with all detected faces without requiring repeated captures. No fake/random scores.                                                                                                                                |
| LT-02 | Two, three and crowded-face fixtures produce all returned boxes and correct counts; background/small second faces block verification; crossing faces revoke continuity.                                                                                    |
| LT-03 | Desktop/mobile, mirrored/unmirrored, resized and cropped previews align boxes/labels with source faces. Details are keyboard-accessible and do not rely on color.                                                                                          |
| LT-04 | Numeric tests cover below/equal/above 0.85, near-boundary rounding, negatives, missing/nonfinite scores and final minimum aggregation. Exactly 85% cannot match.                                                                                           |
| LT-05 | A 99% similarity without a completed fresh challenge cannot return `MATCH`. Three eligible >85% samples are necessary, with documented timing gates.                                                                                                       |
| LT-06 | Correct randomized actions pass; wrong direction/order, stale/repeated timestamps, no return to neutral, insufficient hold, missing/multiple faces and expired evidence do not pass.                                                                       |
| LT-07 | Person/template/context changes, face swapping/ambiguous association, camera restart and replay of a previous challenge ID cannot reuse evidence.                                                                                                          |
| LT-08 | Image upload cannot pass liveness or live matching; diagnostic enrollment is not selectable for live verification. Legacy records retain original interpretation.                                                                                          |
| LT-09 | One terminal attempt per session; continuously visible face produces no duplicate writes. New attempt requires explicit rearm. Per-frame inference never calls repository commit.                                                                          |
| LT-10 | Hidden tab, route change, disconnect, stop, abort and hung-worker recovery release resources and ignore late replies. StrictMode remount does not create two loops.                                                                                        |
| LT-11 | Storage failure/retry preserves immutable evidence; migration failure preserves original bytes; repeat migration is idempotent; old/future schemas and competing tabs fail safely.                                                                         |
| LT-12 | Tables/details/export show all new stored fields and truthful outcomes. Deletion and storage capacity remain scoped and bounded.                                                                                                                           |
| LT-13 | Record measured detection/recognition rates, p50/p95 latency, dropped frames and memory trend over a 10-minute run. No frame backlog or unbounded retained buffers. Test target desktop, Android and iPhone cameras.                                       |
| LT-14 | Measure genuine/impostor outcomes at the requested 85% threshold across target people, lighting, eyewear and poses; publish sample counts and false accepts/rejects separately. Do not infer accuracy from fixture parity.                                 |
| LT-15 | Test printed photos, moving photos, phone-displayed stills/replays, wrong-order prerecorded motion and available virtual-camera injection. Document passes/failures honestly; success completing motions does not constitute production PAD certification. |
| LT-16 | Offline after asset initialization, missing/corrupt liveness assets, unsupported workers and slow-device frame gaps produce explicit behavior without bypasses. Verify no source-frame uploads.                                                            |
| LT-17 | Vercel direct-route refresh still works; model/WASM assets resolve with correct content types; a fresh deployment works with persisted legacy browser data.                                                                                                |

Implementation is recorded in IMPLEMENTATION.md and the companion UML. Automated tests cover policy, orchestration, migration, actual browser models and rendered flows. Physical-camera, target-user calibration and spoof evaluation remain acceptance work; no deployment is claimed.

# STK automatic face identification

Status: **Implemented locally — see IMPLEMENTATION.md for validation and remaining device acceptance.**
Date: 2026-10-29 (Asia/Manila).  
Project: `C:\Users\USER\projects\Starwinner\face-recog-prototype`.  
Review baseline: working tree based on commit `31645a3`, including the existing uncommitted enrollment/readiness fixes. Findings below describe source inspection, not a new physical-camera or deployed-site test.

## 1. Requested behavior and scope

Change **Scan face** from selected-person verification (1:1) to automatic identification against the eligible local enrollment gallery (1:N). After the user starts the camera, detect faces, compare each usable face with the enrolled templates, and show the matching person's name, employee code and similarity without asking the user to select a person or follow movement instructions.

Keep **Enroll** as the guided flow: select/create a person, complete the motion challenge, then explicitly capture or replace that person's enrollment. Preserve completed steps and stable enrollment readiness from the existing fixes.

This proposal interprets the earlier multiple-person requirement as **independent identification of each visible face** on Scan face. Multiple faces continue to block enrollment, where a single person must own the capture. Scan face must not stop identification solely because another face appears.

The application remains React JavaScript with MUI, frontend-only, with localStorage as the prototype database. Keep the existing feature/module injection boundaries for later STK integration. No backend, hosted recognition service, MongoDB connection or production STK change is part of this phase.

When implemented, this document supersedes the selected-person, single-face-only, scan-challenge and manual-rearm requirements for `/scan` in [the live tracking specification](STK_LIVE_FACE_TRACKING_SPEC.md). Enrollment requirements and historical records retain their existing meaning. This proposal does not claim that the application already behaves this way.

## 2. Product decisions

| Area              | Required behavior                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera start      | Keep explicit **Start scanning** and **Stop** controls. Matching becomes automatic after Start; entering the route does not silently start the camera.                                                                                          |
| Person selection  | No person dropdown, selected-person hint, Add person button or manual candidate choice on Scan face.                                                                                                                                            |
| Instructions      | No head-turn prompts, step numbers, challenge progress bars or hidden screen-reader challenge instructions on Scan face. Keep them above the tracked face details on Enroll.                                                                    |
| Scan feedback     | Show descriptive states such as **Searching**, **Recognized**, **Unknown face**, **Ambiguous match**, **Low image quality**, **Waiting for analysis** and actionable camera/storage errors. These are status messages, not movement challenges. |
| Recognition       | Compare each eligible probe with every eligible active enrollment in the current scope. Do not stop at the first template above threshold.                                                                                                      |
| Similarity        | Preserve direct cosine percentage and the user's strict **above 85%** requirement; exactly 85% fails.                                                                                                                                           |
| Multiple faces    | Separate track, score, candidate, stability history and result for every detected face. Do not use one global score/name for all boxes.                                                                                                         |
| Repeated scanning | Continue automatically after a result. New visible people do not require **Start next verification**.                                                                                                                                           |
| Enrollment        | Keep person selection, randomized active challenge, explicit capture/replacement, retained passed steps and validation on capture click.                                                                                                        |

### Liveness on Scan face

The current implementation obtains liveness from instructed head turns. Removing scan instructions also removes that active challenge from Scan face; merely hiding the prompts would leave scanning waiting indefinitely.

For this implementation scope, automatic scan results carry `livenessStatus: 'not_checked'`, `liveness: null`, and `authoritative: false`. A discreet explanation in the scan summary says **Similarity identification · Liveness not checked**. Enrollment liveness is separate provenance and must never be copied into a later scan as if the current face passed.

A no-instruction scan must work without initializing MediaPipe or downloading its liveness assets. Enrollment still requires those assets. Passive liveness would require a separately specified model, policy and evaluation; YuNet/SFace scores or visible movement must not be relabelled as a passive liveness pass. This prototype identification result does not authorize STK attendance or authentication.

## 3. Scan page and face labels

Use the existing MUI theme, cards, buttons, chips, lists and responsive grid.

1. Header: **Automatically find enrolled people.** Supporting text: **Faces are compared with enrollments saved in this browser.** Remove verification/challenge wording from this route and the shared application banner.
2. Gallery summary: **N eligible enrollments**, with excluded/incompatible counts and a link to Enroll when none are eligible. An empty gallery displays **No eligible enrollments** and may keep drawing detection boxes; it must not label everyone Unknown or save scan events.
3. Preview: box every returned face. Labels follow the correct face, remain upright in the mirrored preview, and remain within the camera bounds.
4. Before acceptance, show a temporary face ID, detection confidence, search/status text and best similarity when available. Do not display an unaccepted candidate's name as an identity.
5. Once accepted, show **Recognized: Name (Employee code)**, the current face's similarity and detection confidence. Detection confidence and match similarity remain separate values.
6. For a rejected probe, show **Unknown face · Best similarity 74.12%**, or **Ambiguous match** when several enrollments are plausible. Do not assign the closest person's name to an unknown face. A pending/unevaluated face shows a dash, never a fabricated 0%.
7. Replace the single global **Current match similarity** card with the per-face **Detected faces** list. Each row contains the matching overlay track ID, current status, accepted identity if any, similarity and last-analysis age.
8. Replace **Last completed attempt** with **Recent scan results**, clearly separated from current boxes. Show identified, unknown and ambiguous events with truthful Saved locally/Not saved status. Old results must not label a different current face.
9. Remove **Start next verification** from Scan face. Stop, camera disconnect, tab hiding or navigation end the session; a later camera session requires explicit Start.
10. Keep diagnostic image tools available under an explicitly labelled diagnostic area in Settings. They must not reintroduce selected-person verification into the normal Scan face experience or produce live identification records.

Recognized boxes use green, searching blue, and unknown/ambiguous/quality states amber, with text labels as well as color. For crowded/overlapping labels, compact them to track ID and status; retain all details in the adjacent MUI list. Announce identity/state transitions politely, not every score or video frame. Retain visible keyboard focus, accessible Start/Stop labels and mobile overflow checks.

## 4. Enrollment gallery

Build an immutable gallery snapshot from the repository, once per relevant gallery change rather than once per video frame.

An eligible entry must have:

- An acknowledged person in the current environment/company scope, with an active template that belongs to that person.
- A valid finite, normalized 128-value embedding and compatible detector/recognizer hashes, embedding dimension and preprocessing version.
- A supported enrollment source: `live_camera`, or compatible `legacy_unknown` with its unknown enrollment-liveness provenance retained. Exclude `test_image` templates and inactive/historical templates.
- Scope matching the injected host context. The current standalone context has no store restriction; a future host supplying a store-restricted gallery must enforce that restriction in the repository/API adapter and include it in the gallery identity.

Do not silently clear existing enrollments or require all users to re-enroll merely to enable identification. Incompatible legacy entries receive a management status and can be replaced through Enroll. A structurally corrupt database still enters existing recovery mode; it must not be silently converted to an empty gallery.

Each gallery entry contains `personId`, display snapshot, `templateId`, template version, embedding and enrollment provenance. A deterministic `galleryVersion` changes when eligible identities, display snapshots, templates, acknowledgments, model compatibility or scope change. Ordinary scan-history writes must not change it: using the database's every-write `revision` directly would reset scanning after every saved event.

Compute this version from a canonical, person-ID-sorted representation including embedding content and model/preprocessing hashes. Gallery input order or unrelated settings/history changes must not affect it.

On gallery change, clear current identities and comparison windows, replace the worker gallery, and automatically resume against the new snapshot. Discard in-flight results for the old gallery generation. Before saving, recheck the exact gallery and active winning template; removal/replacement cannot leave an obsolete identification eligible for a new write.

## 5. Identification policy

Version the new policy as `identify-85-strict-v1`, distinct from the existing `live-85-strict-v1` verification/enrollment policy.

### Per-probe ranking

For each quality-approved face embedding, compute cosine similarity against **all** eligible templates. Rank by raw similarity. Sort exact ties deterministically only for reproducible diagnostics; the sort order cannot choose an identity from a tie.

Let `s1` be the highest raw cosine and `s2` the highest score belonging to a different person. Display `100 * clamp(score, 0, 1)` with two decimals and decide using the unrounded raw values.

An eligible identity candidate must satisfy all of:

1. `s1 > 0.85`.
2. Exactly one distinct person has a score above 0.85 in that probe.
3. If a runner-up exists, `s1 - s2 >= 0.05`.

The 0.05 separation is a **proposed conservative prototype parameter**, not a calibrated confidence measure. Snapshot it as `minMargin: 0.05` and evaluate it with target users before changing the policy version. It adds an ambiguity check; it does not weaken or rescale the requested 85% cutoff. With one eligible person, the runner-up and margin are null and the margin rule is inapplicable. With zero eligible people, identification is unavailable.

| Example                   | Per-probe classification                                                        |
| ------------------------- | ------------------------------------------------------------------------------- |
| Best 85.00%               | Unknown; exactly 85% fails.                                                     |
| Best 92%, runner-up 78%   | Eligible candidate.                                                             |
| Best 92%, runner-up 87%   | Ambiguous; two different people exceed 85%.                                     |
| Best 88%, runner-up 84%   | Ambiguous; insufficient separation.                                             |
| Best 90%, runner-up 85%   | Eligible candidate at the exact configured margin, subject to unrounded values. |
| Best 82%, runner-up 80%   | Unknown; no person passes.                                                      |
| Nonfinite embedding/score | Analysis error; never Unknown or Identified.                                    |

“Unknown” means no eligible enrollment met this policy. It does not prove that the person was never enrolled. Keep the actual measured score available because lighting, pose, enrollment quality and this strict threshold may cause false rejections. Do not automatically lower the cutoff to improve the apparent success rate.

### Stability and current identity

- Accept **IDENTIFIED** only after three consecutive eligible comparisons for the **same person and active template**, on the same session/track/gallery generation, spanning at least 600 ms, with no inter-sample gap over 1.5 seconds.
- Every sample must independently meet the threshold and ambiguity rules. Reset the window when the winning identity changes, not just when the above/below-threshold boolean changes.
- Use the minimum winning similarity across the three accepted samples for the saved result; snapshot each sample's winning score, runner-up score and margin. Label the live latest score separately from the saved minimum.
- Three consecutive valid below-threshold classifications produce **UNKNOWN**. Three consecutive ambiguous classifications produce **AMBIGUOUS**. Mixed classifications keep searching. Quality failures, missing embeddings and overload skips are not below-threshold samples.
- After any decision, continue comparing this track. A contradictory candidate, ambiguous association or failed identity/quality evidence clears its current recognized name; an unrefreshed name expires after at most 1.5 seconds. Historical events remain in Recent scan results.
- A track ID is temporary geometry association, not identity proof. A fresh identity window is required after continuity is lost, faces cross ambiguously, or a different person becomes the winner.
- If two currently visible tracks compete for the same enrolled identity, display **Identity conflict** on both rather than claiming two distinct people are that employee. Suppress new positive events for that conflict until resolved and rebuilt from fresh comparisons. Earlier saved events remain historical.

## 6. Multi-face pipeline and scheduling

The current worker returns many boxes but only one embedding. Add explicit operations for detecting a frame and extracting selected faces from that **same retained frame**; do not reuse a global embedding for every face.

Proposed sequence, serialized in one pipeline:

1. Capture one unmirrored frame and assign `sessionGeneration`, `frameId` and monotonic `capturedAt`.
2. `detectFrame(frame, frameId)` runs YuNet once, assesses each face and returns all boxes with stable per-frame detection IDs. The recognition worker retains only this frame's source until release.
3. The coordinator associates detections with tracks and marks ambiguous associations per affected track. Publish geometry with cleared/valid per-track identity state atomically.
4. Choose quality-eligible tracks fairly, oldest unprocessed first, and call `extractFaces(frameId, detectionIds, galleryVersion)`. Each extraction uses its own landmarks, crop and normalized SFace embedding; rank against the current worker gallery and return bounded score summaries mapped to detection IDs.
5. Reject stale frame/gallery/session results. Update each track's independent comparison window and deduplication state. Release the retained frame in `finally`, disposing Mats/tensors/crops even after cancellation or failure.

Keep the existing `extract`/`analyzeFrame` contracts available for enrollment and diagnostic flows until their callers are deliberately migrated. Do not change their single-person evidence semantics as a side effect of adding scan operations.

Scheduling defaults to validate during implementation:

- At most one pipeline and one retained source frame in flight; no unbounded frame queue.
- Detection target remains at most 8 frames/second, adapting to actual CPU throughput.
- At most two face embeddings per pipeline, six embeddings/second in aggregate, and three comparisons/second per track. Compare an embedding with the complete gallery; do not run SFace again for each enrolled person.
- Round-robin/fair scheduling must prevent the largest or first face from monopolizing work. All detected boxes remain visible even when some faces await recognition.
- Retain the 1.5-second evidence-age and per-track comparison-gap limit. A slow/overloaded track shows **Waiting for analysis** or **Analysis delayed** and drops stale identity, rather than producing Unknown or silently increasing evidence validity.
- The supported local gallery remains at most 50 people. Measure throughput with 1, 2 and 3 simultaneous faces and galleries of 1, 10 and 50. These are test scenarios, not a promise of a fixed recognition frame rate on every device.

Never initialize the active-challenge or MediaPipe worker on the Scan face path. Recognition model initialization failure blocks identification explicitly; failure of enrollment-only liveness assets must not block this scan route.

Keep the existing single-writer policy: only the writable tab can start a session that saves identification events. Read-only/recovery tabs can inspect/export available data and show the storage status; they do not silently start unsaveable identification sessions.

## 7. Continuous sessions and duplicate suppression

Global phases: `idle`, `loading`, `scanning`, `gallery_empty`, `save_failed`, `error`, `stopped`. Per-track phases: `detected`, `searching`, `identified`, `unknown`, `ambiguous`, `quality_blocked`, `waiting_for_analysis`, `identity_conflict`, `lost`.

A result completes a track observation, not the entire camera session. Scanning and other tracks continue automatically. The global workflow must not reuse `session.completed` to stop all comparisons after the first person's result.

An encounter is a session-local track visit. Brief missed detections up to 1.5 seconds retain the encounter but cannot advance a score window; longer absence ends it. Automatic re-identification still needs three new valid samples.

- Save at most one event for each `(sessionId, encounterId, outcome, acceptedPersonId-or-null, galleryVersion)` combination. Repeated frames or score fluctuations do not produce duplicate rows.
- An Unknown/Ambiguous encounter may later become Identified without any user action; that is a new outcome and may save one event. A gallery change may also produce one new decision, even for the same continuous track.
- Suppress additional identified history rows for the same person/gallery within a 10-second session-local cooldown across track-ID churn. Continue showing the current recognized identity even when logging is suppressed. Stop clears the cooldown; a new explicit camera session starts a new encounter history.
- Keep live track state and pending deduplication keys bounded and in memory. Store one immutable decision event, not video frames or every state transition. Do not write at capture frame rate.
- Serialize saves through the existing writer lock. On save failure, retain one immutable pending event with its ID, mark **Not saved**, and pause identification/persistence globally while detection may continue. Do not accumulate an unbounded retry backlog. Retry saves that exact event, or discard it explicitly; then resume with fresh comparison windows. A discarded event remains suppressed for that encounter.
- Deleting/replacing a referenced enrollment before retry returns a stale-context error unless that exact event is already saved. Do not silently retarget an old result to the replacement template.

## 8. Persistence and database viewer

### Schema v3

Add an `identificationEvents` collection alongside `people`, `templates`, `attempts` and `settings`. This preserves existing enrollment/1:1 records and their validators while allowing an identification outcome with no known person. Do not manufacture an Unknown person or attach a failed search to whichever employee happens to score highest.

Keep the current scoped localStorage key and writer-lock name. Migrate v1 to v2 using the existing mapping, then v2 to v3 by adding an empty identification collection and necessary schema metadata. Validate the complete migrated envelope and persist it atomically under the writer lock. Generalize the repository's current `schemaVersion === 1` migration-write condition to include v2 upgrades.

On quota/migration failure, preserve original stored bytes and recovery export. A read-only tab may inspect a migrated in-memory view but cannot write it. Old builds must reject v3 without resetting it. Preserve old IDs, timestamps, vectors, scores, policy snapshots and liveness evidence; do not reinterpret old matches under the new identification policy.

### Identification event contract

| Field                                                                                   | Requirement                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `sessionId`, `encounterId`, `trackId`                                             | Immutable event ID plus bounded session/track binding.                                                                                                                                                                                               |
| `purpose`, `outcome`, `source`                                                          | `identify`; `IDENTIFIED`, `UNKNOWN` or `AMBIGUOUS`; `live_camera`. Identity conflicts remain transient and do not create positive rows.                                                                                                              |
| `environment`, `companyId`, `storeId`                                                   | Snapshot of the injected scope; validated at commit.                                                                                                                                                                                                 |
| `personId`, `personSnapshot`, `templateId`, `templateVersion`                           | Required for Identified; null for Unknown/Ambiguous.                                                                                                                                                                                                 |
| `galleryVersion`, `eligibleCount`                                                       | Exact gallery used, separate from unrelated history-write revision.                                                                                                                                                                                  |
| `similarity`, `matchPercentage`, `runnerUpSimilarity`, `margin`                         | Raw and display evidence. Identified uses minimum accepted winning score; rejected outcomes use the last evaluated probe's best score. No candidate names for rejected outcomes.                                                                     |
| `samples`, `stableSampleCount`, `stableDurationMs`, `scoreAggregation`                  | Exactly three bounded decision samples with timestamps, raw best/runner-up scores and classification; aggregation is `minimum` for Identified and `last` otherwise. Runner-up fields for the summary accompany the same sample as its summary score. |
| `decisionPolicyVersion`, `scoreMappingVersion`                                          | `identify-85-strict-v1`, `cosine-positive-percent-v1`.                                                                                                                                                                                               |
| `thresholdSnapshot`, `comparisonOperator`, `minMargin`                                  | `0.85`, `>`, `0.05`; include number of above-threshold candidates per sample so ambiguity rules are auditable.                                                                                                                                       |
| `livenessStatus`, `liveness`, `authoritative`                                           | `not_checked`, null, false. Enrollment provenance, if shown, is stored separately.                                                                                                                                                                   |
| `startedAt`, `completedAt`, `decisionTimestamp`                                         | Wall-clock encounter/result timestamps plus monotonic decision time for in-session evidence checks.                                                                                                                                                  |
| `modelIdentity`, `preprocessingVersion`, `qualityPolicyVersion`, `quality`, `timingsMs` | Reproducible model/processing and this face's quality evidence.                                                                                                                                                                                      |
| `faceCountAtDecision`, `recognitionAgeMs`                                               | Actual total visible detections and age of this face's evidence. Multiple faces are valid for identification.                                                                                                                                        |
| `probeEmbedding`, `thumbnailDataUrl`                                                    | Null for automatic identification events. Probe vectors/crops stay transient; existing enrollment and diagnostic storage behavior is preserved.                                                                                                      |

The new validator must check event identity/scope, timestamps and freshness, sample count/duration, same accepted person/template binding, model/gallery compatibility, outcome-specific threshold/margin rules and truthful liveness fields. Accept only explicit known policy versions on new commits. Do not weaken the old `MATCH`/`ENROLLED` liveness validator to accommodate new events.

Identified samples also carry their accepted `personId`, `templateId` and version; all three must agree with the event. Reject missing/nonfinite sample values and unbound timestamps. Check active-gallery compatibility when committing a new decision. When loading historical events, validate their recorded evidence without requiring their gallery/template to remain current. Evaluate freshness relative to the recorded decision time, not the time of a storage retry; retry still requires unchanged referenced context unless the event is already saved.

Use the existing **200-record limit as a combined limit for `attempts + identificationEvents`**, the existing 50-person limit and estimated 3 MiB byte limit. Surface this in storage usage/settings. No automatic eviction. The first reached limit pauses new decision persistence with export/delete actions, rather than silently dropping records.

### Viewer behavior

Add a MUI **Identification scans** tab with time, outcome, recognized name/code or Unknown/Ambiguous, similarity, threshold, face count, liveness status and save/source information. Details expose the complete event and policy; no selector is needed to scan, though viewer filters may include person/outcome/date.

JSON export includes the new collection. Deleting a person removes that person's templates, legacy attempts and identified events in the same transaction; unknown/ambiguous events have no person link. Clearing identification history is explicit and leaves enrollments intact. Existing Clear captures remains scoped to the original attempts collection and must be labelled accordingly. Scoped full reset clears all prototype collections only.

## 9. Architecture and file organization

Keep feature UI under `src/features/face-recognition`, reusable workflow/model/repository logic under `src/utils/hooks/faceRecognition`, and dialogs under `src/components/dialogs/faceRecognition`. Use named exports, JavaScript/JSDoc contracts and injected services consistent with this checkout. Do not create a parallel state store, storage key or second model implementation.

Proposed additions:

| Path                                                                      | Responsibility                                                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/features/face-recognition/components/IdentificationWorkspace.jsx`    | Scan-only MUI composition, controls, per-face list and recent results; no selected-person or active-challenge state.   |
| `src/utils/hooks/faceRecognition/useLiveFaceIdentification.js`            | React subscription, camera lifecycle and scheduling for identification. Reuse existing camera and scheduler utilities. |
| `src/utils/hooks/faceRecognition/workflows/liveIdentificationWorkflow.js` | Gallery/session generations, per-track windows, continuous decisions, deduplication and persistence coordination.      |
| `src/utils/hooks/faceRecognition/recognition/identificationPolicy.js`     | Pure ranking, ambiguity checks and identity-aware stability windows.                                                   |
| `src/utils/hooks/faceRecognition/recognition/enrollmentGallery.js`        | Eligible scoped gallery construction and deterministic versioning.                                                     |

Extend `workerHandler.js` and `browserFaceEngine.js` with explicit detection/extraction/gallery messages. Extend tracker output with per-track ambiguity/continuity information; retain the existing aggregate flag for enrollment callers. Extend repository operations, migration, schema, exports, constants, table formatting and DatabasePage together. Inject the identification workflow through `createPrototypeServices.js` and document it in `contracts.js`/module exports.

Make `FaceOverlay` and `DetectedFacesList` consume per-track display data. Their enrollment caller may still supply challenge instructions; the identification caller has no prompt prop or hidden prompt tree. Keep `LiveScanWorkspace` for enrollment and existing diagnostic/legacy code until deliberately refactored. Avoid filling the shared workspace with conditionals that allow verification requirements to leak back into scanning.

Later STK integration replaces the local gallery/decision repository with an authenticated scoped service adapter. The UI receives the same explicit per-track display states. Browser-local search remains experimental until a separately validated server decision contract is supplied.

## 10. Implementation review: issues and required corrections

These are source-confirmed current behaviors or contract gaps relevant to this proposal. They are not claims that new 1:N code has already failed in production.

| ID   | Finding and source                                                                                                                                                                                                   | Impact / required correction                                                                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | `LiveScanWorkspace.jsx` requires `personId`; `liveFaceWorkflow.js:start/process` creates no matching session without a person and returns early without one.                                                         | Removing only the dropdown would leave detection-only mode. Add a gallery-backed identification session with no claimed identity.                                                                                                                                                     |
| R-02 | `liveFaceWorkflow.js` initializes/observes liveness for selected people; its matching path waits for `passed_basic`.                                                                                                 | Hiding prompts alone would stall matching. Remove active-challenge dependency from the new scan workflow while preserving enrollment.                                                                                                                                                 |
| R-03 | `workerHandler.js` extracts an embedding only inside `faces.length === 1`; `liveFaceWorkflow.js` blocks multiple/ambiguous faces globally.                                                                           | Current multi-face boxes are not multi-face identification. Add mapped per-face extraction and isolate failures/ambiguity to affected tracks.                                                                                                                                         |
| R-04 | `matchPolicy.js:createStableWindow` stores score/timestamp/pass only.                                                                                                                                                | It could accept three scores from different winning people if reused for 1:N. Add candidate/template/gallery/session/track binding.                                                                                                                                                   |
| R-05 | `liveFaceWorkflow.js` marks the session completed after one result and returns before further comparison; UI exposes manual next verification.                                                                       | Continuous scan requires per-encounter decisions and deduplication rather than a global completed switch.                                                                                                                                                                             |
| R-06 | `FaceOverlay.jsx` and `DetectedFacesList.jsx` consume global similarity/status/person/liveness; multiple faces are styled blocked.                                                                                   | Names/scores cannot be assigned safely to multiple faces with this contract. Use per-track state and atomic updates to prevent stale-name transfer.                                                                                                                                   |
| R-07 | `databaseSchema.js` requires every attempt to belong to a known person and restricts purpose to enroll/verify; positive legacy policy requires one face plus liveness. `faceWorkflow.js:run` also requires a person. | Add a separate identification collection and explicit validator/commit path. Do not fake a person or bypass old positive-result checks.                                                                                                                                               |
| R-08 | `migrateDatabase.js` only migrates v1, and `localStorageRepository.js:read` only persists migration when original schema is v1.                                                                                      | A v2-to-v3 in-memory migration alone would not update disk and later commits could reject it. Update both migration and atomic writer persistence.                                                                                                                                    |
| R-09 | `faceTracker.js` is geometric and reports one global `ambiguous` flag.                                                                                                                                               | Crossing faces must not carry accepted identity between tracks or stop unrelated faces. Return affected-track continuity and rebuild their identity evidence.                                                                                                                         |
| R-10 | `FaceOverlay.jsx` uses only blue/amber box colors and has no accepted-name field; `App.jsx` says all live camera sessions use a motion challenge.                                                                    | Update result-specific labels/colors and route-aware copy. Remove visible and accessibility-tree scan prompts.                                                                                                                                                                        |
| R-11 | `databaseSchema.js` checks recognizer metadata but does not require detector metadata; `faceWorkflow.js:compatibleTemplate` directly accesses `template.modelIdentity.detector.sha256`.                              | A legacy record accepted by schema can throw during compatibility checks. Make compatibility checks total and explicit; missing model metadata becomes Incompatible, while structurally corrupt data remains recoverable.                                                             |
| R-12 | Current selection filtering excludes test images but does not perform the complete compatibility check until Start.                                                                                                  | Gallery counts must reflect usable enrollments; incompatible entries must not crash or inflate the available gallery.                                                                                                                                                                 |
| R-13 | Every repository write increments database revision; it currently has no independent gallery revision.                                                                                                               | Resetting on that revision would make automatic scan saves invalidate their own gallery. Use the deterministic content-based gallery version from section 4.                                                                                                                          |
| R-14 | `browserFaceEngine.js` has a 120-second request timeout; `liveFaceWorkflow.js:stale` clears display evidence at 1.5 seconds without aborting the in-flight worker.                                                   | A genuinely hung worker may leave an apparently active but non-progressing scan. Clear identity at 1.5 seconds; after 5 seconds with no completed recognition operation, terminate the worker, release the camera and enter a recoverable error. Keep model-loading timeout separate. |
| R-15 | `useLiveFaceTracking.js` handles camera error by stopping scheduling and failing the workflow, without calling its full `stop()` cleanup.                                                                            | Unify disconnection/error cleanup in the new hook so recognition resources, track state and camera references are released. Test Stop during pending camera permission and route changes.                                                                                             |
| R-16 | Existing positive browser test uses the same still image for enrollment/probe and simulated head poses.                                                                                                              | It verifies current UI/model plumbing, not genuine-user accuracy, multi-identity ranking or multi-face continuity. Add distinct-frame/identity tests and record physical-camera acceptance separately.                                                                                |

Review findings R-11, R-14 and R-15 are implementation robustness issues beyond the requested UI change; include them in the implementation work and regression coverage. No fixes are applied by this document.

## 11. Acceptance criteria and verification plan

| ID    | Required evidence before implementation is considered complete                                                                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-01 | `/scan` has no person selector or challenge instructions in visible UI or accessibility tree; `/enroll` retains its selector and prompts above the tracked-face details.                                                                                                                       |
| AI-02 | Start scanning with several eligible enrollments automatically recognizes the correct person from the complete gallery; changing gallery order cannot change a valid winner.                                                                                                                   |
| AI-03 | Test raw scores below, exactly at and above 0.85; test margin below/at/above 0.05 and rounding near boundaries. Exact ties and two above-threshold people remain ambiguous.                                                                                                                    |
| AI-04 | Alternating top candidates never form a stable identity. Three eligible samples for one person across at least 600 ms can identify; stale/gapped samples cannot.                                                                                                                               |
| AI-05 | Unknown and ambiguous outcomes include truthful scores and null identity; later valid evidence can identify automatically in the same encounter.                                                                                                                                               |
| AI-06 | Two and three faces receive separate boxes, scores and correct names; an unknown/blurred face does not block an unrelated clear enrolled face. Crossing faces, duplicate-identity conflicts and disappearance never transfer stale labels.                                                     |
| AI-07 | A continuously visible recognized face does not repeatedly write events. Unknown/ambiguous stability, track churn, return within cooldown and return after cooldown follow section 7. Other people can be recognized without restarting.                                                       |
| AI-08 | Empty gallery, only diagnostic templates, incompatible/missing detector metadata and legacy enrollments are handled explicitly; no silent database reset.                                                                                                                                      |
| AI-09 | Delete/replace a template or change scope while extraction/save is in flight: obsolete candidates/events cannot commit. Saving ordinary history does not invalidate the gallery.                                                                                                               |
| AI-10 | Identification works when MediaPipe/liveness assets are blocked and requests none of them. Enroll still reports missing-liveness errors. Identification events never claim liveness passed.                                                                                                    |
| AI-11 | v1/v2 migrations preserve records and write valid v3 once; read-only tabs, quota failure, corrupt/future schemas, reload, full JSON export and scoped reset remain correct. Old positive-result validation is retained.                                                                        |
| AI-12 | Identification table/filter/details/deletion work with null identities; deleting a person removes linked events. Combined record/byte limits and immutable save retry/discard do not generate duplicates or false Saved labels.                                                                |
| AI-13 | Hidden tab, navigation, camera disconnection, Stop during loading/permission/inference, worker error and hard timeout clear labels, stop streams and release workers. Late replies cannot publish or save.                                                                                     |
| AI-14 | Measure capture-to-overlay and capture-to-identity latency, per-track comparison rate, time to identify, discarded/stale samples and memory growth for 1/2/3 faces with 1/10/50 gallery entries. Overload uses explicit waiting states and fair scheduling.                                    |
| AI-15 | Desktop/mobile layout, mirrored/cropped overlay coordinates, crowded labels, color-plus-text statuses, keyboard controls and restrained screen-reader announcements pass rendered browser checks.                                                                                              |
| AI-16 | Enrollment regression checks retain completed steps/readiness and explicit post-click validation, reject multiple faces, and preserve replacement/save-failure behavior.                                                                                                                       |
| AI-17 | Real model browser checks use distinguishable identities and changed probe frames. Real-camera tests record same-person recognition, non-enrolled people, lighting/pose variation, crossing faces and false accept/reject observations. Same-image fixtures alone are not accuracy acceptance. |
| AI-18 | Production build and preview load recognition assets correctly; `/scan` and `/enroll` direct-route refresh works after deployment. Report deployed/physical-device results separately from local automated checks.                                                                             |

## 12. Implementation order and completion boundary

1. Implement/test the gallery and identity-aware decision policy as pure logic.
2. Add per-face worker operations and tracking association contracts, preserving enrollment inference.
3. Add schema v3, event validation, atomic migrations, persistence/idempotency and database viewer support.
4. Add the continuous identification coordinator/hook and scan-only UI; update shared labels and application copy.
5. Address the recorded robustness findings, run targeted regressions and browser checks, then update the live specification, UML, README and implementation evidence to the delivered behavior.
6. Complete physical-camera/gallery evaluation and document unresolved recognition thresholds or device limitations honestly; do not weaken the requested cutoff without a separate decision.

Implementation was authorized after the specification-only phase. The local application now implements the architecture and policy above. Validation evidence and physical-device/deployment boundaries are recorded in IMPLEMENTATION.md. No production deployment or STK integration is performed by the implementation task.

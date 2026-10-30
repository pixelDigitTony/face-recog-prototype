# Anthony's Face Lab: Equal Samples, Configurable Liveness and Guided Enrollment

Status: **Specification only — not implemented.**  
Date: 2026-10-30 (Asia/Manila).  
Project: `C:\Users\USER\projects\Starwinner\face-recog-prototype`.

## 1. Purpose and authority

Remove primary-sample selection, consistently use every eligible sample when identifying an enrollee, add configurable enrollment liveness with optional blinking, and offer guided capture of three reference samples.

This specification records the approved plan and the user's explicit choices. Creating this document does not authorize application implementation or deployment. When subsequently implemented, it supersedes primary-sample, paired-evaluation and fixed-challenge requirements in `ANTHONYS_FACE_LAB_MULTI_SAMPLE_EVALUATION_SPEC.md` and earlier specifications only where revised here. Historical decisions keep their original meaning.

The application remains **Anthony's Face Lab**, using React JavaScript, MUI, browser-side recognition and localStorage. No backend, paid service, model replacement, automatic learning, attendance authorization or deployment is included.

### 1.1 Confirmed choices

- Configurable liveness applies to **Enroll only**. Scan remains automatic, without an enrollee selector or challenge instructions; Scan liveness remains `not_checked`.
- All enrollment challenges may be disabled. Capture then records **Not checked — disabled in Settings**, never a fabricated pass.
- Offer an optional guided set of three samples alongside single-sample enrollment.
- Once a face is confirmed, retain the sample and score supporting confirmation until that tracking association ends. Do not keep comparing merely to update its thumbnail.
- Preserve the five-sample limit, 85% Scan boundary, existing sample eligibility, stable-match checks and storage limits.

### 1.2 Current implementation baseline

The current schema-4 implementation already compares all eligible samples, selects each person's highest-scoring sample, and ranks distinct people. A primary sample receives no extra weight in normal Scan matching. However, `primaryTemplateId` still drives sample-management controls, some enrollment/verification paths, enrollment status and the primary-only evaluation baseline.

Implement this change by removing those remaining dependencies and preserving the correct existing matching algorithm. Do not describe an extra pass over the same scores as independent verification.

## 2. Reference-demo assessment and rationale

The [SyntaxLab face demo](https://syntaxlab.ae/demos/face) was reviewed through its public live-recognition, ID-comparison and photo-search interfaces. The review establishes exposed features, not measured recognition accuracy, camera performance or spoof resistance.

| Capability observed in the demo             | Decision for this prototype                               | Reason                                                                                                |
| ------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Guided capture from three angles            | Add an optional guided set.                               | Helps operators collect useful reference variations in one visit.                                     |
| Blinking and head movement                  | Add optional blinking and independent head-turn controls. | Adds a different observable action while allowing accessibility and device tradeoffs.                 |
| Liveness before live recognition acceptance | Keep outside Scan.                                        | The user selected automatic Scan without challenge instructions.                                      |
| Recognition strictness presets              | Retain threshold exploration in Evaluate only.            | Preserve the requested live boundary; thresholds from another model cannot be copied directly.        |
| Selfie-to-ID image comparison               | Defer.                                                    | Separate onboarding scope; face comparison does not establish document authenticity.                  |
| Group-photo search and enrollment           | Defer.                                                    | Does not improve the requested live flow; uploaded photos must not bypass live-enrollment provenance. |
| Optional device persistence                 | Retain the current localStorage database.                 | Browser persistence is an explicit prototype requirement; retain export/deletion controls.            |
| Recognition log with repeat suppression     | Preserve existing history and cooldown behavior.          | Already covered by the prototype.                                                                     |
| Local-processing explanation                | Update existing explanatory copy.                         | Clearly describe disabled liveness and guided captures without adding a new consent flow.             |

### 2.1 Is blinking necessary?

Blinking is **useful as an optional enrollment challenge, not necessary as a mandatory test**. It supplements head movement with an eye action, but a recording can also contain blinking. It does not independently prove that a live person is present. Glasses, frame rate and individual accessibility needs can affect usability.

Keep blinking disabled by default until the operator enables it. Continue describing successful challenges as **basic liveness**, without claiming certified or validated spoof resistance. Identity similarity and liveness are separate results. [NIST guidance](https://pages.nist.gov/800-63-4/sp800-63b.html) treats presentation-attack resistance as a separately evaluated capability; this prototype makes no compliance claim.

[MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) already supports optional facial blendshape output and worker-based processing. Extend the existing worker instead of introducing another recognition model or service.

## 3. Equal-sample management and matching

### 3.1 Remove primary selection

Remove **Set as primary**, primary badges, primary selectors and primary-dependent live behavior. Keep editable sample labels, add, replace and delete actions. Do not silently nominate the oldest or newest sample as a replacement primary.

Derive sample membership from `template.personId`. A person with no samples remains present but unenrolled. Distinguish having saved samples from having eligible samples when all saved samples are diagnostic or incompatible. Use `enrollmentRevision` for concurrent-change checks rather than `expectedTemplateId` or a primary pointer.

Apply this consistently to enrollment, diagnostic comparison, database tables, public contracts, gallery construction and evaluation. A sample-card list may have deterministic display ordering; ordering must not affect matching eligibility or weight.

### 3.2 Two-level ranking

For each unconfirmed tracked face with a valid embedding:

1. Compare against every compatible, eligible sample in the current scoped gallery.
2. Select each enrollee's highest raw cosine similarity and its exact template identifier/version.
3. Rank those enrollee winners, then apply existing acceptance and stability rules.

For person `p`, use `personScore(p) = max(cosine(probe, sample))` over that person's eligible samples. Resolve exact ties deterministically using person ID and template ID, as currently implemented. Never average appearances together, weight one sample more heavily, inflate scores or lower the live threshold.

Preserve scope, acknowledgment, model/preprocessing, embedding-validity and source eligibility checks. Diagnostic-only samples remain excluded. Live-camera samples captured with explicitly disabled liveness remain eligible for this non-authoritative prototype, with their actual provenance retained.

Green recognition requires all existing conditions:

- Raw similarity **>= 0.85**; exactly 85% qualifies on Scan.
- Exactly one distinct enrollee at or above the threshold.
- A margin of at least `0.05` over the next different enrollee, when a runner-up exists.
- Three valid observations over at least 600 ms, respecting existing observation-gap limits.
- The same enrollee across the stability window; the winning sample may change without restarting that window.
- Existing duplicate-identity protection across simultaneously tracked faces.

Multiple samples from one enrollee must never count as multiple candidate identities or each other's runner-up. Decisions use unrounded scores. Similarity percentages are not identity probabilities.

### 3.3 Per-face presentation and confirmation

Each tracked face's attached label and accessible detected-faces entry show its closest enrollee's name/code, winning sample label, saved thumbnail and similarity. Resolve display metadata on the main thread by exact person/template identity. Use a placeholder if that sample has no thumbnail; never substitute another reference or the live face image.

Below-threshold, unstable, ambiguous or competing identities remain amber and unconfirmed. Preserve `closestCandidate` separately from accepted identity. Low-scoring candidates must not become recognized identities in persisted history.

Before confirmation, candidate presentation follows current valid analysis. Clear stale details on expired analysis, uncertain association, disappearance or invalidated enrollment data.

At confirmation, preserve the existing minimum-score summary across the three accepted observations and the exact sample supporting that summary, including deterministic tie handling. Display **Confirmed similarity** and **Tracking confirmed face**. Freeze the score and reference choice, while allowing name/label metadata updates.

Continue detection, lighting feedback and tracking without repeated SFace calls for an uninterrupted confirmed track. Preserve supporting-template fingerprints from all three observations. Deletion, replacement, biometric modification or ineligibility of any supporting template invalidates confirmation. Adding samples, deleting unused samples or renaming labels must not cause repeated confirmation. Tracking loss or ambiguity clears the binding and requires fresh recognition.

## 4. Enrollment liveness configuration

### 4.1 Settings and defaults

Add a MUI **Enrollment liveness** card with independent switches and explicit Save behavior:

| Test key    | Label      | Default  |
| ----------- | ---------- | -------- |
| `turnLeft`  | Turn left  | Enabled  |
| `turnRight` | Turn right | Enabled  |
| `blink`     | Blink      | Disabled |

Persist configuration as versioned settings, for example `settings.enrollmentLiveness = { version: 1, turnLeft: true, turnRight: true, blink: false }`. Validate explicit booleans and supported versions; malformed settings must not silently disable checks. Deep-copy nested defaults and session snapshots.

Changes apply to the next enrollment session, including sessions in other tabs. Snapshot configuration at session start and keep it unchanged throughout capture, review and saving. Save controls respect the existing writer-tab restrictions.

With all tests disabled, show **Not checked — disabled in Settings** in Settings, the enrollment feed/status, sample details and saved attempt details. Keep single-face, image-quality, pose, fresh-capture and continuity gates. Disabling challenges does not disable these gates or alter Scan's acceptance rules.

### 4.2 Challenge behavior

Build the challenge sequence only from enabled tests, randomized at session creation. Preserve existing neutral calibration and head-turn thresholds/dwell rules. Each head turn is followed by return to neutral; blinking runs while facing forward. Neutral positioning is a capture prerequisite/transition, not a configurable liveness test.

All enabled tests must pass before enrollment is ready. Missing assets or unavailable observations for an enabled test must block that test with an actionable message, never silently convert it to disabled or passed.

Wrong movement or poor observations retry/pause only the current incomplete step. Previously completed steps remain valid for the same continuously tracked face. A completed challenge does not expire merely because time passes; preserve existing continuous-session freshness and association safeguards. Genuine loss of reliable association requires a fresh session rather than transferring evidence to another face.

Keep prompts attached to the face box, inside the preview, and mirror their text accessibly. Completed challenges must not cause a recurring comparing/ready loop that toggles the enrollment button. Scan receives no challenge prompts.

When all challenges are disabled, no challenge completion evidence is required. Store `status: 'not_checked'` and `reason: 'disabled_in_settings'`, with an empty completed-test list and no fabricated pass timestamp. The settings snapshot is still required. Pose measurement may still be needed for capture-quality and guided-angle requirements.

### 4.3 Blink observations and state machine

Extend the existing liveness worker to enable `outputFaceBlendshapes` when blinking is enabled and return `eyeBlinkLeft`, `eyeBlinkRight`, yaw, face box and capture timestamp. Missing scores remain unavailable, never zero-filled. Observe unmirrored input; mirror only presentation.

Require the ordered sequence **open -> closed -> open** for both eyes while facing forward. Initial experimental constants:

| Condition                  | Requirement                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Open                       | Both blendshape scores <= 0.30.                                                              |
| Closed                     | Both scores >= 0.60 in an observed frame.                                                    |
| Open baseline and recovery | At least two consecutive qualifying observations each.                                       |
| Cycle duration             | 80–1,500 ms from the final baseline-open observation to the first recovery-open observation. |
| Observation continuity     | Consecutive observation gaps <= 200 ms; strictly increasing capture timestamps.              |
| Pose                       | Neutral yaw within the existing forward-facing tolerance.                                    |

Intermediate scores do not independently establish open or closed states. A wink, sustained closure, missing face/eye data, unsupported pose or incomplete sequence cannot pass. A continuity violation resets only the current blink cycle, not previously completed challenges.

Schedule lightweight liveness observations independently of slower recognition work, targeting 20 observations per second. Keep at most one liveness inference in flight, discard obsolete work, and never accumulate a frame backlog. Bind outputs to session generation and current face association; asynchronous results must not attach to a new face.

If actual sampling cannot satisfy the timing requirement, explain that blink detection needs a clearer/faster feed and retry the current step. Do not auto-pass, interpolate a missing blink or change user settings. These thresholds require physical-camera evaluation and are not calibrated spoof-resistance claims.

## 5. Guided three-sample enrollment

### 5.1 Flow and capacity

Offer **Add one sample** and **Guided set — three samples**. Single-sample add/replace remains available. Guided mode adds three samples; it does not bulk-replace existing samples.

Guided mode requires at least three free slots within the five-sample limit. If fewer remain, explain capacity and offer the existing single-sample or explicit delete/replace controls. Do not delete anything automatically or silently shrink the guided set.

The operator selects an acknowledged enrollee and starts a session. Complete configured liveness once, or explicitly use the disabled configuration. Then guide three distinct captures:

1. Front-facing, within the existing neutral tolerance.
2. Slight left, approximately 10–20 degrees relative to calibrated neutral.
3. Slight right, approximately 10–20 degrees relative to calibrated neutral.

Keep all prompts inside the tracked face's label. These capture poses are reference-collection instructions, not additional liveness tests when those tests are disabled.

### 5.2 Capture and review

Each stage needs fresh, quality-valid evidence from the same continuously associated face. Require the existing stable pose hold before making the explicit capture action available. Preserve current hard image-quality gates and advisory lighting feedback.

Use separate captures for all three samples. Each final capture must score strictly **> 0.85** against its own fresh candidate at the same pose. Do not compare a side capture against the frontal candidate as its consistency gate. Do not require a new appearance to exceed 85% against an older saved enrollment.

A failed current-pose or capture-consistency check retries that stage while retaining earlier completed stages and liveness progress for the same reliably tracked face. Actual tracking loss, multiple-face ambiguity, camera/session restart or changed enrollee invalidates the unsaved set. Changing the selected person's enrollment revision prevents a stale save; unrelated people changing must not reset progress.

After three successful captures, stop camera processing and show a review with all three references and editable labels, initially **Front**, **Slight left**, **Slight right**. Labels use existing 1–60-character rules. Save does not require the person to remain in front of the camera during review: each sample carries evidence valid at its capture time. Review is a sealed pending capture set, not permission to collect more frames after continuity ends.

Save all three templates and their three corresponding enrollment attempt records in one atomic repository commit. Recheck enrollment revision, five-sample limit, combined-history capacity and storage budget immediately before persistence. Failure leaves all previous records unchanged and retains the review for retry when safe. Cancel/discard removes the pending set only. Prevent duplicate records on repeated Save/retry.

Temporary review images stay in memory. Persist only existing bounded thumbnails when thumbnail saving is enabled; otherwise save no thumbnail. Never persist full frames or video. Clear temporary buffers after save, discard, session replacement or page teardown.

Explain that capturing several angles complements samples gathered on different days with/without makeup or glasses. Recommend clear, evenly lit references; do not promise 95% similarity or make poor lighting a target variation.

## 6. Interfaces, architecture and data compatibility

### 6.1 Interface changes

| Boundary                | Required change                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Person/sample model     | Remove `primaryTemplateId`; retain monotonic `enrollmentRevision` and template ownership.                            |
| Gallery and diagnostics | Remove primary flags and filters; use all eligible samples for person comparisons.                                   |
| Recognition result      | Preserve separate `closestCandidate`, accepted identity and supporting-template evidence.                            |
| Settings                | Add validated, versioned enrollment-liveness switches.                                                               |
| Liveness worker         | Return optional eye-blink scores plus timestamped pose/association data.                                             |
| Challenge evaluator     | Accept immutable enabled-test configuration; expose typed tests, progress, pass/disabled reason and timing evidence. |
| Enrollment workflow     | Support single capture and sealed guided-set review, each bound to a session and enrollment revision.                |
| Repository              | Remove `setPrimarySample`; add atomic `addSampleSet` with idempotency and expected-revision checks.                  |
| Evaluation              | Generate new all-sample reports without primary-dependent exclusions.                                                |

Keep scoring and challenge state machines pure and independently testable. React components render state and invoke workflows; workflows coordinate camera/model services; repositories validate and persist. Preserve dependency injection so later host-app integration does not require rewriting recognition math or UI flows. Do not introduce direct localStorage access inside components.

### 6.2 Schema and policy versions

Advance the database schema to **5**. Introduce these explicit policy identifiers:

- Enrollment decisions: `enrollment-configurable-liveness-v1`.
- Challenge evidence: `configurable-challenge-v1`.
- Evaluation reports: `evaluation-all-samples-v2`.

New enrollment attempts record the configuration snapshot, actual liveness status/reason, test sequence and completion evidence, session/track binding, capture timestamp, model asset identity when used, timing policy and existing capture-consistency metadata. New templates retain the corresponding enrollment provenance; guided samples also share a capture-set identifier. Enabled tests require evidence matching the recorded configuration. All-disabled captures require explicit disabled evidence and the normal capture gates, not a fake `passed_basic` result.

Keep `identify-85-multisample-v3` for Scan: ranking, threshold and acceptance semantics are unchanged. Preserve older strict/inclusive identification and enrollment validators. Historical records with four head-turn steps must continue loading under their original rules; new records must not evade validation by claiming a historical policy.

### 6.3 Migration and persistence

Support schema 1–4 inputs through validated migration into schema 5. Remove obsolete active/primary pointers only after preserving sample ownership and enrollment revisions. Install the default liveness configuration for migrated settings.

Preserve database/person/template IDs, embeddings, sample labels, thumbnails, consent, scope, attempt history, identification events and evaluation trials. Do not retroactively relabel old samples as having passed the new challenge or as intentionally disabled. Keep legacy provenance as recorded.

Use the existing storage key, writer coordination, atomic persistence and original-data recovery behavior. Validate the complete migrated database before committing. A migration or quota failure must not destroy the original bytes.

Preserve limits: 50 people, five samples per person, 200 combined capture/identification records, 100 evaluation trials and 3 MiB estimated shared storage. No automatic eviction. A guided set consumes three sample slots and three capture-history slots.

### 6.4 Evaluation compatibility

New reports use every eligible sample, including people whose former primary was ineligible. Remove primary-only controls from new evaluation flows. Preserve fresh, manually labeled evaluation probes, existing threshold exploration, stable person-level ranking and no automatic application of thresholds to Scan.

Historical paired reports remain readable with their original policy and mode labels. Do not relabel old primary-only outcomes as all-sample outcomes. New gallery fingerprints exclude primary selection. Mark reports based on previous gallery/policy semantics as historical/outdated; explicit reruns calculate the current all-sample policy from compatible stored probes. Keep policy versions visible and do not mix old and current aggregates silently.

## 7. Implementation documentation and UML requirements

During a later authorized implementation, update README, implementation notes, interface contracts and affected matching/enrollment/evaluation specifications to describe the resulting behavior and actual validation evidence. Existing historical document filenames need not be renamed.

Update the existing UML source to show:

- One person with multiple equal samples, with no primary pointer.
- Sample scoring -> per-person maximum -> distinct-person ranking -> stable confirmation -> tracking without reconfirmation.
- Versioned settings -> immutable session configuration -> enabled challenge sequence or explicit disabled evidence.
- Blink observation state machine and asynchronous observation/session association.
- Guided capture -> sealed review -> atomic three-sample save, with cancel, continuity loss and persistence failures.
- Schema migration and legacy-policy validation paths.

This specification-only task does not modify those implementation documents, UML or application files.

## 8. Acceptance criteria and verification

### 8.1 Sample matching and presentation

- All eligible samples participate regardless of former primary selection; diagnostic/incompatible/out-of-scope samples remain excluded.
- Two samples from one person never become runner-up identities or create false ambiguity. Exact ties are deterministic.
- Cover below, exactly and above 85%; 0.05 margin boundaries; unstable winners; same-person winning-sample changes; multiple people choosing the same record.
- Each face shows the correct exact-sample thumbnail/label; missing thumbnails use placeholders. Low scores remain unconfirmed in UI and history.
- Confirmed tracks stop SFace comparisons and retain their confirmation reference. Unrelated sample additions and metadata edits do not cause reconfirmation.
- Supporting-sample deletion/replacement and uncertain tracking invalidate appropriately. Face IDs must not increment continuously for an uninterrupted face.

### 8.2 Liveness and settings

- Cover all eight combinations of the three switches, including all disabled, defaults, persistence, malformed settings and read-only tabs.
- Settings edits do not alter an active session. Existing and new records retain their true liveness provenance.
- Only enabled tests are required; unavailable enabled tests cannot silently pass or disable themselves.
- Wrong instructions and temporary invalid observations retain completed steps for the same face; completed challenges do not trigger enrollment-button flicker.
- Blink fixtures cover valid cycles, exact timing/score boundaries, winks, sustained closure, noise, missing scores, nonmonotonic timestamps, excessive gaps, pose changes, worker failure and stale responses from previous sessions.
- Scan remains free of challenge instructions and does not initialize an enrollment challenge.

### 8.3 Guided capture and storage

- Cover single capture, three-sample sets, exactly three available slots and insufficient capacity.
- Verify distinct pose captures, per-pose consistency, quality retries, disabled liveness, retained prior stages and loss of association.
- Verify sealed review can be saved after camera shutdown, without accepting any new capture under the sealed session.
- Cover cancel, duplicate save, revision conflict, person deletion, quota/write failure and successful atomic retry. No partial set or history write is permitted.
- Thumbnail-off mode persists no images. Temporary buffers clear at lifecycle boundaries.
- Migrate fixtures from schemas 1–4 without losing samples/history. Validate old strict policies and paired reports unchanged; new reports use all eligible people.

### 8.4 Completion evidence

Run relevant unit tests, desktop/mobile browser checks, formatting, production build and UML syntax validation during implementation. Verify keyboard access, labels, face-overlay placement and readable multi-face details at mobile sizes.

Separately exercise physical cameras across normal/dim/uneven lighting, glasses, makeup, natural blinks and slower devices. Measure actual liveness cadence and genuine/different-person scores; do not infer accuracy or spoof resistance from mocked tests. Printed-photo and replay-video trials document prototype limitations rather than establish certification.

Record implementation checks and remaining physical-camera acceptance separately. Until implementation is authorized and verified, this document remains a specification only.

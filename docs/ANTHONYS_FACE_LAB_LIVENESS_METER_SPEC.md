# Anthony's Face Lab: Per-Face Liveness Evidence Meter

Status: **Implemented and locally verified on 2026-11-04. Two GPT-6.1 Terra xhigh agents handled coding; the parent performed QA and the requirement audit. Physical-camera acceptance remains separate.**
Date: 2026-11-03 (Asia/Manila).  
Project: `C:\Users\USER\projects\Starwinner\face-recog-prototype`.

The live meter no longer uses the 50/50 face and head buckets or the 15-second reset from the [live movement retention amendment](ANTHONYS_FACE_LAB_LIVE_MOVEMENT_RETENTION_SPEC.md). Detected blink, expression, and head movement now set one calculated 0–100 score, and that score changes only when a new movement calculates a different amount. The original capture-proof scoring and enrollment gates remain unchanged. The [physical evaluation specification](ANTHONYS_FACE_LAB_PHYSICAL_CAMERA_EVALUATION_SPEC.md) adds an operator-run measurement workflow; real-camera acceptance still requires recorded trials.

## 1. Purpose and scope

Add a percentage meter to each tracked face, alongside detection confidence and matching similarity. Observe blinking, slight head movement and facial-expression changes over time. Keep this motion-evidence meter separate from the explicit enrollment liveness challenge; new live enrollment requires both gates.

Implement in the existing React JavaScript/MUI frontend, shared browser workers and localStorage repository. This document originated in the specification-only phase; the user subsequently authorized detailed implementation. The latest role assignment on 2026-11-04 uses two GPT-6.1 Terra xhigh coding agents with parent orchestration, QA and specification checking. Deployment is outside this authorization. Proposed numeric defaults below are experimental engineering choices, not measured accuracy or externally recommended security thresholds.

The meter appears on Enroll and Scan. Enroll uses it as an additional capture requirement. Scan displays it as an independent advisory status without adding instructions, changing identity recognition, or saving a new event on every meter update. Diagnostic uploaded images cannot earn live-camera evidence.

### 1.1 Meaning of the percentage

Use **Liveness evidence: 65%**, not “65% alive,” “65% genuine,” or “65% spoof-proof.” The score measures completion of defined temporal motion observations. It is neither a probability nor the output of a trained presentation-attack detector.

MediaPipe provides landmarks, facial-expression coefficients and transformation matrices; these are suitable inputs for observing movement, not a calibrated liveness probability. Its documentation also states that built-in smoothing applies only with one face, so this prototype's multi-face mode needs its own per-track temporal filtering. [MediaPipe Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)

A stationary picture should not complete valid motion events. Moving a picture or camera must not earn credit merely because its bounding box moves. However, replayed videos can contain blinking and expression changes, and moving prints can produce misleading estimates. Successful meter and challenge results must remain labeled **basic motion checks**. This iteration cannot guarantee that the input is a live person rather than a presentation attack. [Alan Turing Institute technical briefing, sections 4.2–4.3](https://www.turing.ac.uk/sites/default/files/2023-05/attacks_against_facial_recognition_systems_technical_briefing_final_copyedit.pdf)

## 2. Verified implementation baseline and changes in policy

At the pre-meter baseline, the code had:

- A shared MediaPipe worker returning each face's box, yaw and optional left/right blink coefficients.
- Independent per-track enrollment sessions, challenge progress, capture checks, guided reviews and retry state in `multiEnrollmentWorkflow.js`.
- Exclusive overlap association between worker observations and tracked faces; result-array order is not identity.
- Configurable left-turn, right-turn and blink challenges; all-disabled currently permits captures recorded as `not_checked`.
- Schema 5, historical policy validation, atomic per-person writes, and separate Scan recognition policies.

The meter must not be the existing challenge's completed-step count presented under another label. Give it its own observation state, event evidence and policy. The same valid observation may feed both algorithms, but neither may copy the other's passed flag or describe their shared signals as independent security factors.

**Intentional behavior change:** this specification interprets “liveliness test is separate but still needed before enrollment” as requiring at least one enabled explicit challenge for new live enrollment. Individual challenge switches remain configurable. All-disabled historical settings and records still load, but new Enroll actions show **Enable at least one enrollment challenge in Settings** and cannot save until configuration is valid. Do not silently enable a switch, rewrite old evidence, or label a disabled challenge as passed. This supersedes the earlier all-disabled live-enrollment allowance only for the new policy.

## 3. Per-face UI and enrollment flow

### 3.1 Camera overlays and accessible details

Add a compact MUI determinate progress bar and numeric text to each face's attached label. Mirror the same state in that face's match card and accessible detected-faces entry. Keep labels inside the preview and preserve mobile layout and track association.

Example:

```text
Face #2 · Detection 98%
Closest record: Alex · Match 89%
Liveness evidence 65% · Basic motion checks met
Enrollment challenge: Turn slightly left
```

Detection, matching and liveness retain separate values and labels. Meter green must not turn an unconfirmed identity green. A recognized identity can remain green while its independent liveness badge is amber or unavailable. Use text/icons as well as color; avoid announcing every frame to screen readers. Announce state transitions with a polite live region and throttle visual meter updates to at most five per second.

| Meter state            | Presentation                                                    | Enrollment effect                                     |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| `initializing`         | Neutral, “Starting liveness analysis,” no numeric value         | Wait                                                  |
| `collecting`           | Amber, numeric evidence score and missing-signal status         | Wait                                                  |
| `passed_basic`         | Green, “Basic motion checks met,” accepted score                | Meter gate satisfied for this continuous face session |
| `insufficient_quality` | Amber, “Cannot assess reliably,” prior progress marked paused   | Wait for fresh usable observations                    |
| `unavailable`          | Neutral/error, “Liveness unavailable,” no invented percentage   | Block new capture; preserve other faces               |
| `invalidated`          | Clear score and evidence, “Rechecking liveness” if face returns | Require new meter evidence                            |

Only Enroll gives corrective instructions, attached to the affected face box: e.g. **Blink naturally or change your expression**, **Move your head slightly**, or **Improve lighting so your eyes are visible**. Explicit challenge instructions take priority; display the missing meter signal as secondary text. Scan shows status only.

### 3.2 Flow

1. Explicitly start the camera; begin independent meter observation for every usable tracked face, including people not yet named.
2. Match each face as today. A stable unknown face accepts its name in its own match card; Enter confirms it.
3. Bind a fresh enrollment-session identifier to that face and snapshot the challenge configuration and meter policy. Start fresh meter evidence for this enrollment; pre-name preview evidence does not authorize saving.
4. Run the explicit challenge and meter concurrently. Preserve each one's completed observations for the same continuous face. No second instruction sequence is required for the meter.
5. Capture only when the meter, enabled challenge and existing association, image-quality, pose and consistency gates all pass.
6. Save the person/sample atomically, or collect the guided set and seal its review. One face waiting or failing does not pause another face.

Apply the same requirement to live Add sample and Replace sample. Start a new meter session for a new enrollment operation, even if the person remains visible. Already sealed captures retain their recorded evidence through review and storage retry; retries must not manufacture new timestamps or re-run liveness.

## 4. Observation and scoring contract

### 4.1 Shared eligibility and timing

Use a deterministic pure reducer, one instance per track and camera session. Accept only fresh, monotonically increasing observations with exclusive face association and usable face/eye/mouth geometry. Include frame sequence, capture timestamp, source track ID and worker generation. Duplicate frames never advance progress.

Target 20 observations/second through the existing bounded worker scheduler. Measure actual per-face intervals; elapsed wall time alone earns no progress. Before passing, require at least 12 valid observations spanning at least 2 seconds, and complete event evidence within a rolling 10-second collection window. Missing or low-quality samples do not count. Do not fail a person merely for not blinking within a deadline; continue collecting and show what is missing.

An event cannot bridge an observation gap above 200 ms. Pause and clear that unfinished event's phase when the gap is too large; retain other completed, still-valid events and the separate challenge's passed steps. If device throughput cannot support event recognition, report insufficient sampling rather than weakening timing gates. Apply a timestamp-aware per-track filter and hysteresis; do not let smoothing erase brief blinks or synthesize missing frames. Store only a bounded in-memory observation buffer, at most 200 observations per track.

### 4.2 Signals and initial event rules

All values in this table are initial experimental defaults in a versioned policy object. Evaluate and tune them against recorded consented fixtures and physical cameras before treating them as operational thresholds.

| Signal                  | Required temporal event                       | Proposed initial rules                                                                                                                                                                                                                         | Maximum points |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------: |
| Blink                   | Both eyes open → closed → open                | Reuse existing coefficient hysteresis: open <=0.30, closed >=0.60; at least two valid open observations before and after closure; observed closed phase; complete cycle 80–1500 ms, no >200 ms observation gap                                 |             40 |
| Slight head movement    | Stable pose → small yaw/pitch change → return | Baseline from at least 300 ms; change of 4–15 degrees held >=150 ms with >=2 observations; return within 3 degrees for >=150 ms; total cycle <=4 seconds                                                                                       |             25 |
| Non-eye facial movement | Baseline expression → change → return         | At near-frontal pose (absolute yaw/pitch <=15 degrees), observe jaw opening or bilateral smile increase >=0.20 from baseline, peak >=0.35, held >=150 ms with >=2 observations; return within 0.10 of baseline for >=150 ms; cycle <=4 seconds |             35 |

Blink coefficients are expression coefficients, not liveness confidence. Do not infer emotion from a smile coefficient. Count a blink only in the blink family; eye movements cannot also earn the expression-family points. The expression event uses a consistent channel throughout its cycle. Use neutral baseline observations, not a forced assumption that every person's neutral coefficient is zero.

Head motion must come from the facial transformation rotation, not translation, face-box scale, device motion or mirrored screen coordinates. Expression motion must be supported by normalized internal landmark changes after removing estimated rigid pose/scale; blendshape fluctuation alone is insufficient. At implementation, pin the selected landmark indices, normalization, displacement thresholds and filter parameters in the same versioned policy, with synthetic rigid-transform and jitter fixtures proving that they do not earn expression credit. This is an explicit implementation/evaluation requirement, not a claim that perspective-warped prints can never fool the model.

### 4.3 Score and pass rule

For each signal, use `progress = 0, 1/3, 2/3, 1` for no valid baseline, baseline established, valid changed phase, and completed return phase respectively. Reset only an invalid unfinished event. A completed event contributes full points while its evidence remains in the collection window.

```text
score = 40 * blinkProgress + 25 * headProgress + 35 * expressionProgress
pass = score >= 60
       AND at least two distinct signal families have completed events
       AND at least one completed family is blink or expression
       AND observation-count, duration, freshness and association gates pass
```

Valid completed pairs are blink + head (65), head + expression (60), or blink + expression (75). All three completed families produce 100. Partial phases may raise the displayed score but cannot replace the two completed events. Clamp the display to 0–100, round only for presentation and apply gates using the unrounded score. The **60-point motion-evidence boundary is a proposed product default**, unrelated to the existing 85% identity-matching boundary. It does not mean 60% certainty that someone is alive.

This allows a person who cannot blink reliably to contribute head and expression evidence. It does not guarantee accessibility for everyone; if the required signals cannot be observed, show a clear blocked reason rather than silently bypassing the gate. Additional accessibility policies need separate design and validation.

### 4.4 Completion retention and freshness

Before pass, expired events leave the 10-second evidence window and may reduce the collecting score. Keep explicit challenge progress separate and intact.

At pass, seal the accepted score and event summary for the current continuous face/enrollment session. Show **Basic motion checks met** with its time; do not keep demanding repeated blinking, let a quiet face's accepted score decay, or repeatedly disable capture after completion. The frozen number is a session result, not a fresh per-frame estimate. Head/expression changes can continue without re-running the passed gate.

Capture still requires a current usable face/pose observation no older than 1500 ms and all existing capture checks. Temporary poor lighting or a dropped analysis result pauses capture without erasing passed evidence if track continuity remains established. Show paused freshness explicitly; a stale face cannot appear actively assessed.

Actual disappearance, ambiguous/crossed association, camera stop/navigation/hiding, worker restart, stale analysis beyond the continuity limit, or a new enrollment operation invalidates that track's meter evidence. Never reuse evidence merely because a numeric track ID is reused. Retain sealed guided reviews and pending saves. Losing one face must not reset another face's progress. The explicit challenge keeps its existing same-face progress rules; meter invalidation never implies a fabricated challenge failure.

## 5. Separate enrollment gates and Settings

New live enrollment requires all of:

```text
valid confirmed name or explicit Add/Replace action
AND meter.status == passed_basic for this enrollment session
AND at least one explicit challenge enabled
AND every enabled challenge completed for this enrollment session
AND fresh exclusive face/pose association
AND existing quality, capture-pose and >0.85 self-consistency checks
AND repository identity/revision/capacity validation
```

Keep challenge toggles for Turn left, Turn right and Blink. Explain that these choose prompted tests. Turning off the prompted Blink test does not disable passive blink observation; expression + head is also a valid meter combination. Meter signals are not configurable per operator in this iteration; removing signals or arbitrary threshold tuning could invalidate the scoring rule.

Settings shows a read-only **Liveness evidence meter required for live enrollment** explanation, the score meaning and basic-motion limitation. Prevent new all-off challenge settings with inline validation; allow existing all-off databases to open and recover normally, but block starting new enrollment until the operator selects a test. Configuration changes affect the next enrollment session only, preserving current immutable settings. Reading settings or updating stored configuration does not mutate an existing session snapshot. Navigating away from an active camera still ends live continuity under section 4.4; sealed reviews and pending saves retain their proof.

Missing models, unavailable blendshapes, malformed observations and camera errors never produce an automatic pass. Scan recognition continues to follow its existing matching rules when meter analysis is unavailable; clearly show the liveness status independently.

## 6. Architecture and implementation boundaries

Extend the existing feature structure rather than place inference or state machines inside UI components:

| Area                                                                    | Required change                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/workers/liveness.worker.js`                                        | Emit per-face pitch, required blendshape coefficients and compact normalized expression-motion features alongside current yaw/box/blink data; enable blendshapes whenever the meter needs them |
| `src/utils/hooks/faceRecognition/liveness/faceLandmarkerAdapter.js`     | Add explicit meter-output capability/configuration; cache it independently from the prompted-blink switch; preserve asset verification and bounded requests                                    |
| `src/utils/hooks/faceRecognition/liveness/livenessMeterPolicy.js` (new) | Immutable numeric defaults, policy identifiers, summary validator and deterministic score/pass rules                                                                                           |
| `src/utils/hooks/faceRecognition/liveness/livenessMeter.js` (new)       | Pure per-track event reducer, window, completion latch and invalidation; no React/storage dependency                                                                                           |
| `src/utils/hooks/faceRecognition/liveness/associateFacePoses.js`        | Reuse exclusive association; reject uncertain or stale observations before either consumer receives them                                                                                       |
| `src/utils/hooks/faceRecognition/workflows/multiEnrollmentWorkflow.js`  | Session-bound meter lifecycle, separate challenge/meter status, capture gate, frozen evidence for each sample and retry isolation                                                              |
| Scan workflow and `useLiveFaceTracking.js`                              | Advisory meter lifecycle for every detected track, including already-confirmed identities; keep SFace confirm-once optimization; no Scan challenge prompts                                     |
| `createPrototypeServices.js`                                            | Inject meter factory/policy through existing services; dispose shared worker and state safely                                                                                                  |
| `src/features/face-recognition/components/LivenessMeter.jsx` (new)      | Reusable MUI presentation with accessible value/state text; no decision logic                                                                                                                  |
| Overlays, detected-faces list, enrollment cards, Settings and history   | Present separate results, configuration restrictions and recorded policy meaning                                                                                                               |
| Repository/schema validators and `contracts.js`                         | Validate new evidence independently of challenge evidence and document public interfaces                                                                                                       |

One shared observation pipeline must feed meter and challenge, with no competing `detectForVideo` calls or duplicate camera loops. Worker capability initialization must wait for in-flight work. Initialize observation for preview/Scan even before a name is entered, but snapshot fresh evidence when an enrollment starts. Keep the existing maximum ten active enrollment sessions and bounded SFace batches; these are configuration limits, not measured throughput guarantees.

## 7. Data contract and compatibility

Keep schema 5 and the current storage key, enrollment identities, storage limits and export/delete behavior. Add versioned fields validated only under the new enrollment decision policy:

- Meter policy: `motion-evidence-v1`.
- Live enrollment decision policy: `enrollment-per-face-meter-v3`.
- Existing challenge policy: `configurable-challenge-v1`.

Store a compact `livenessMeter` summary on each new successful live-enrollment attempt and its sample provenance. Include policy/model asset identity, camera-session and enrollment-session IDs, track ID/generation, accepted score, threshold snapshot, state, observation count, start/pass timestamps, event phases/times/channel/peak summaries sufficient to recompute the score, and capture-time continuity/freshness evidence. Use monotonic timestamps only within their camera session; retain normal UTC record timestamps for history. Do not compare performance-clock values across reloads.

Validate finite values and ranges, event chronology/duration, family uniqueness, computed score, qualifying event pair, minimum observation span, session/track binding and fresh capture association. A new-policy `ENROLLED` record without a passed meter or with all challenges disabled must be rejected at the repository boundary. Guided samples share the session's accepted meter proof but each retains its own fresh capture evidence. Failed storage retries use the exact sealed record.

Store challenge evidence separately; do not overload `livenessStatus` or overwrite the historical meaning of `passed_basic`. UI history distinguishes **Motion evidence** from **Enrollment challenge**. Historical attempts without meter fields show **Not recorded** and validate under their original policies, including explicitly disabled challenges. Existing enrollment samples stay eligible under their original rules; do not backfill a synthetic meter pass or force bulk re-enrollment.

Scan meter observations remain transient in this iteration. Existing recognition-history policy and schema meanings do not change. Raw camera frames, videos, full landmark streams and expression timelines stay out of localStorage. Bound the compact persisted evidence and include it in storage-quota tests. Frontend validation checks internal consistency; it cannot attest to an untampered camera or protect against someone modifying browser code/storage.

## 8. Validation and acceptance criteria

### 8.1 Automated checks

1. Score below/exactly/above 60; all qualifying pairs; partial-only high scores rejected; missing/NaN/duplicate/out-of-order observations; expiry before pass; latch after pass.
2. Valid and invalid blink cycles, rigid pose transforms, camera/box translation, constant expressions, landmark jitter, isolated coefficient spikes, large gaps and low frame rate. No time-based automatic completion.
3. Meter passes but challenge incomplete; challenge passes but meter incomplete; both pass; all-off configuration blocked; historical all-off records still load. Disabling prompted blink does not turn off meter blendshapes.
4. Two or more faces performing different actions concurrently; no shared baseline, event, score or pass. Reordered detections, ambiguous crossings, disappearance/return, stale worker results and reused track IDs cannot transfer evidence.
5. Completed evidence remains ready while the same person is still; quality recovery preserves progress; new operation or lost continuity requires fresh meter evidence. One face's invalidation does not affect others.
6. Name confirmation, live Add/Replace, guided capture/review, retries, quota errors and record replacement use the correct session proof. Reject forged/mismatched summary fields and missing new-policy evidence.
7. Desktop/mobile overlays and cards, accessible non-color status, readable instruction priority, preview bounds, startup/unavailable states and no instructions on Scan. Recognized faces keep their identity while the meter updates independently.
8. Real MediaPipe fixtures verify multi-face output shape and needed motion channels, separately from synthetic reducer tests. Run relevant unit/browser suites, formatting and production build; update interface documentation and UML when implementation is authorized.

### 8.2 Physical-camera evaluation

Before presenting this as useful spoof resistance, evaluate genuine participants and attack presentations separately across target desktop/mobile devices, lighting, glasses, makeup, facial mobility, near/far faces, and groups of 1/2/4/up to 10 people where feasible. Measure per-face sampling cadence, time to meter pass, time to enrollment, non-completion, false rejection, cross-track leakage and device load.

Include stationary prints, moved/tilted/bent prints, still photos on displays, camera movement, eye/mouth-cutout presentations and prerecorded videos containing blinks, head turns and expressions. Record attack acceptance as a distinct result, including replay failures; report denominators and conditions. A small fixture suite cannot establish general spoof resistance or justify calling this certified PAD.

Acceptance for this prototype is correct per-face evidence and gating, no progress regression, and honest result labeling. Numeric defaults may require revision after evaluation, with a new policy version and preserved historical interpretation. If stronger protection is needed, separately evaluate a dedicated PAD model/service or suitable sensor-assisted approach, its licensing, deployment and measured attack performance. Do not imply that simply raising the meter threshold solves replay attacks.

## 9. Delivery boundary

The original specification-only request delivered this file. The subsequently authorized implementation must update the existing UML, interface documentation and implementation validation record alongside code and tests. Keep model assets, schema 5 and existing dependency boundaries; deployment and physical-camera acceptance remain separate work. See [implementation coverage](ANTHONYS_FACE_LAB_LIVENESS_METER_IMPLEMENTATION_CHECKLIST.md) for the final requirement audit.

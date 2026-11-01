# Anthony's Face Lab: Curated Samples and Comparative Evaluation

Status: **Implemented locally; see IMPLEMENTATION.md for verification and outstanding physical-camera acceptance.**

Date: 2026-10-31 (Asia/Manila).  
Project: `C:\Users\USER\projects\Starwinner\face-recog-prototype`.

## 1. Purpose and authority

Help operators maintain a small, useful enrollment collection and determine whether one, three or five reference samples per person improve recognition in their actual environment. Measure correct identifications, missed identifications and incorrect identifications separately; a higher similarity score alone is not evidence of better accuracy.

This document records the implemented change. It supplements `ANTHONYS_FACE_LAB_SAMPLE_MATCHING_AND_CONFIGURABLE_LIVENESS_SPEC.md`, superseding its all-samples-only evaluation limitation. Existing live matching, enrollment challenges, guided capture and historical policy semantics remain authoritative.

Application implementation was subsequently authorized in this conversation. Deployment remains outside this local implementation. Existing uncommitted work is preserved; recognition models and the live threshold remain unchanged.

## 2. Evidence and limits

- AWS recommends multiple face instances covering variations such as glasses, facial hair and pose to improve matching. This supports representative variety, not a guarantee for SFace. [AWS FAQ](https://aws.amazon.com/rekognition/faqs/)
- Frigate developers recommend building a diverse collection gradually and warn that bulk additions of similar images can worsen their system's results. [Developer guidance](https://github.com/blakeblackshear/frigate/discussions/21374)
- A Frigate user reported degraded recognition after adding tiny, grainy captures; a collaborator confirmed that additional images can worsen results. This is an anecdotal report about a different pipeline, not a controlled benchmark of this prototype. [User report and response](https://github.com/blakeblackshear/frigate/issues/23385)
- Clear, sharp, evenly lit reference images are preferable to blurred or heavily shadowed captures. [AWS capture guidance](https://docs.aws.amazon.com/rekognition/latest/dg/recommendations-facial-input-images.html)

The current prototype does not retrain SFace when samples are added. It takes the maximum cosine similarity per person, then ranks distinct people. Holding the probe and previous samples fixed, adding a sample cannot lower that person's maximum score. It can also raise an incorrect person's score, shrink the winning margin or produce multiple above-threshold identities. This is a property of the current algorithm, not a measured accuracy result.

Three to five curated samples are a practical starting point, not a proven optimum. Do not copy other products' sample counts, percentages, thresholds or claims about model training into this implementation.

## 3. Scope and preserved behavior

Implement, after authorization:

1. Practical curation guidance and review of existing sample evidence.
2. An evaluation-only comparison of one, three and five samples per person.
3. Structured trial conditions, reproducible reference selection, paired outcomes and explicit evaluation limits.
4. Compatibility, export and validation coverage for the new evaluation policy.

Preserve React JavaScript, MUI, frontend processing, repository/service boundaries, localStorage and the existing scope isolation. Preserve schema 5 and its current limits: 50 people, five samples per person, 100 evaluation trials, 200 combined attempt/identification history records and the 3 MiB estimated storage budget.

Live Scan continues to use every eligible sample and the existing `identify-85-multisample-v3` rules:

- Raw similarity >= 0.85; no rounding before decisions.
- Exactly one distinct person at or above the threshold.
- At least 0.05 margin over the next different person, when present.
- Three valid observations spanning at least 600 ms, with existing gap limits.
- Existing simultaneous-track identity protection and confirmation retention.
- Exact supporting sample thumbnail, or a placeholder; no primary sample.
- Automatic Scan with no enrollee selector or challenge instructions; liveness remains `not_checked`.

No score inflation, automatic threshold adjustment, averaging of embeddings, automatic enrollment, new recognition model, paid service, backend or attendance authorization is included. Multiple-reference support remains available even if a particular evaluation favors one reference.

## 4. Curated enrollment experience

### 4.1 Guidance

Add concise guidance to Enroll and sample management:

> Start with one clear, front-facing sample. Add another when it captures a useful everyday difference, such as makeup, glasses or a different day. More samples are not automatically more accurate.

Explain that slight angle variation is optional. Keep guided three-angle capture available, but do not describe it as mandatory or equivalent to three independent capture sessions. Do not encourage extreme profiles, poor exposure or blur to fill the five slots.

Suggest soft light facing the person and avoidance of strong backlighting or side shadows. A separate day's ordinary lighting is useful for evaluation; an unreadable reference is not useful merely because it is different.

### 4.2 Review and actions

Reuse existing sample cards, labels, thumbnails, timestamps, quality and liveness evidence. Show available lighting warnings and capture-set grouping. For older samples without evidence, show `Not recorded`; never infer a quality pass or reconstruct historical lighting from a small thumbnail.

Encourage descriptive labels such as `No makeup`, `Usual makeup` or `Glasses - different day`. Labels describe operator observations; the application does not infer appearance attributes.

Keep existing add, replace, rename and delete actions and concurrency checks. Do not add a primary selector, silently deactivate samples, automatically delete duplicates or change capture gates. Review guidance is advisory. Existing unsuccessful capture rules and completed liveness progress remain unchanged.

Do not introduce an arbitrary cosine cutoff that rejects makeup or angle variation as an enrollment duplicate or identity mismatch. Automated duplicate/outlier gates require separate evaluation and are deferred.

## 5. Comparative evaluation protocol

### 5.1 Dedicated mode and policy

Keep the existing all-samples evaluation accessible. Add `Compare 1 / 3 / 5 samples` under Evaluate using policy `evaluation-curated-counts-v3` and protocol version 1. This is an evaluation mode, not a Scan setting or a replacement for the live identification policy.

Use the same three probe observations for all modes. Extract each probe embedding once, cache compatible sample similarities and replay the existing person-ranking and stability rules for each reference subset.

Default comparative reports use the live threshold of 0.85. Existing experimental threshold exploration may remain available, clearly separate from the default comparison. Changing an evaluation threshold never changes Scan. Do not tune on these test trials and then describe the same trials as independent validation.

### 5.2 Reference-plan setup

Before showing comparative scores, the operator selects a cohort of acknowledged enrollees and a reference order for each person:

- One clear frontal sample for the one-sample baseline.
- Two additional useful samples for the three-sample set.
- Two further samples for the five-sample set, when available.

Selections exist only in the evaluation plan. They do not create a primary template or affect live matching. Use thumbnails or placeholders, sample labels, capture dates and recorded warnings to support selection. Do not recommend references based on their scores against the test probes.

Require at least one cohort person. With one person, display that the experiment cannot assess confusion between enrolled identities. Recommend multiple people and separate non-enrolled participants for meaningful evaluation.

All compared modes must have the **same people** and exactly the named sample count for every person. Build nested sets: `one` is a subset of `three`, which is a subset of `five`.

- Offer 1 versus 3 only if every selected person has at least three eligible samples.
- Offer 1 versus 3 versus 5 only if every selected person has five eligible samples.
- Show an incomplete plan if only the one-sample baseline is possible.
- Never label a mixture of one-to-five references as a five-sample experiment.
- Never silently remove people or change the cohort between modes to satisfy capacity.

A smaller cohort may be selected explicitly before capture. Display selected and excluded person counts prominently and explain that cohort results do not establish accuracy for the full gallery. Preserve an all-samples evaluation for examining the full gallery separately.

Freeze selected IDs, versions, embedding/model fingerprints, eligibility, cohort and ordering before capture. Any change to reference membership or order creates a new plan ID; do not optimize the plan using observed test scores while presenting it as the original experiment.

### 5.3 Fresh test captures and ground truth

Reuse the existing webcam trial workflow: one continuous face, three valid observations over at least 600 ms and the existing quality/continuity checks. Evaluation remains without liveness challenges.

The operator records the actual person before capture. A positive trial must identify a person in the cohort. A negative trial must be explicitly labeled `Not enrolled` and use a participant not enrolled anywhere in the active scope. Do not relabel an enrolled person excluded from the cohort as an unknown participant. Ground truth is operator supplied, never inferred from the closest result.

Record bounded, operator-selected metadata:

- `captureSessionLabel`: required, 1-100 trimmed characters; reuse for captures from the same visit/session.
- `lighting`: `normal`, `low_light`, `backlit`, `uneven` or `other`.
- `appearance`: `usual`, `makeup`, `no_makeup`, `glasses`, `no_glasses` or `other`.
- `pose`: `frontal`, `slight_left`, `slight_right` or `other`.
- Existing participant label and notes, within their current limits.
- `independentCaptureConfirmed`: explicit operator acknowledgment that the probe was captured separately from enrollment.

These tags describe the test conditions and are not automated demographic or appearance predictions. Do not infer legacy trial conditions from free text.

Do not use enrollment images, enrollment embeddings or frames from the same guided enrollment set as test probes. Where provenance can be compared, reject shared capture/session identifiers and exact reused embeddings; additionally require the acknowledgment because older records cannot prove independent capture. Do not claim this check establishes independence automatically.

Recommend sessions on different days with normal, changed-lighting and relevant appearance conditions, plus separate unknown participants. Capture failures and cancellations must remain visible. Three observations from one trial count as one trial, not three independent tests; repeated trials from one person/session are also correlated.

### 5.4 Mutation and concurrency

Bind capture and save to the frozen plan. If a selected reference is replaced, deleted, becomes ineligible or its embedding/model changes, stop the affected pending evaluation and show the reason. Never substitute a new sample silently. Rebuilding the plan creates a new ID.

An unrelated sample addition does not change explicitly selected subsets. It can change full-gallery evaluation and must invalidate its existing gallery version as before. Display-only renames do not change the numerical experiment; retain the plan's captured labels for reproducible exports and resolve current display names without changing identity bindings.

## 6. Results and interpretation

### 6.1 Per-trial results

Show columns for one, three and five samples, with unavailable modes explicitly labeled. Each available mode reports:

- Correctly identified, missed, wrong enrolled identity, unknown accepted or unknown rejected.
- Diagnostic reason: below threshold, multiple above-threshold people, insufficient margin or unstable observations, as applicable. Capture failure and exclusion are separate from recognition outcomes.
- Expected person's best score, strongest competing person's score and accepted identity, if any.
- Supporting sample ID/label and thumbnail where still available; placeholder after removal.

Keep candidate scores distinct from accepted identity. A higher score with an ambiguous outcome is not an improvement. A wrong identity is not counted as both a miss and a wrong identity.

### 6.2 Aggregate metrics

For the same completed, comparable trial set, show counts and denominators alongside percentages:

| Metric                           | Numerator                                   | Denominator                |
| -------------------------------- | ------------------------------------------- | -------------------------- |
| Correct identification rate      | Positive trials accepting the actual person | Comparable positive trials |
| Missed identification rate       | Positive trials accepting nobody            | Comparable positive trials |
| Wrong-person identification rate | Positive trials accepting another person    | Comparable positive trials |
| Unknown acceptance rate          | Negative trials accepting any cohort person | Comparable negative trials |
| Unknown rejection rate           | Negative trials accepting nobody            | Comparable negative trials |

Use `Unavailable - no trials` for zero denominators. Do not call these rates per-comparison false-match rates or identity confidence. Show separate counts of capture failures, cancellations, excluded/stale trials, distinct people, unknown participant labels and capture sessions.

Show paired changes for 1 to 3 and 3 to 5, including corrected misses, newly missed results, newly wrong identities and newly accepted unknowns. Filters for lighting, appearance, pose and session must apply to the same trial IDs in every mode. Do not compare different cohorts, plans, models, thresholds or trial sets in one aggregate without explicitly separating them.

Show results by person as well as pooled counts so that one heavily sampled participant does not conceal weaker performance for others. Do not imply statistical significance or compute confidence intervals by treating adjacent frames as independent participants.

### 6.3 Decision guidance

Use neutral summaries such as `More correct identifications; unknown acceptances also increased` or `No difference observed in these trials`. If unknown-participant trials are absent, explicitly mark unknown rejection performance untested. Zero observed errors in a small pilot does not demonstrate zero operational risk.

The operator should prefer a larger collection only when it improves recognition under relevant conditions without an unacceptable increase in incorrect identities or unknown acceptances. If results worsen, inspect misleading references and collect better variation rather than adding more images automatically.

Do not automatically choose a winning configuration, remove samples, recommend a new threshold or certify production readiness. Any acceptance targets and minimum study size must be defined for the intended deployment before a production decision. This specification adds measurement, not a claim that five is better than one.

## 7. Storage, compatibility and export

Keep schema 5 with additive, policy-versioned fields on new comparative evaluation trials. No changes to embeddings, enrollment records, liveness settings or live identification event semantics are required. Old trials retain their original policy and report interpretation.

Each new comparative trial stores its existing observations once, plus:

- Policy `evaluation-curated-counts-v3` and protocol version 1.
- The structured condition fields and independence acknowledgment.
- A compact `referencePlan` snapshot: plan ID, scope, creation time, ordered cohort/person/template IDs and versions, reference fingerprints, captured sample labels, model/preprocessing identity and supported modes.
- A report containing plan fingerprint, threshold, evaluation time and per-mode outcomes/evidence at 0.85.

Do not duplicate reference embeddings or thumbnails into each report. Use a deterministic fingerprint of canonical reference membership, order, relevant content and policy; IDs alone cannot detect replacement. Cache shared calculations in memory. Validate nested sets, unique IDs, exact counts, scope, model compatibility, finite scores and correct outcome semantics at the repository boundary.

Historical v1/v2 reports load unchanged. Do not silently convert them into paired comparisons: they lack a preselected reference plan and required trial metadata. They remain available in their historical/all-samples views.

Saved comparative results retain their recorded evidence after a reference disappears, but show `Historical - reference unavailable/changed`; they cannot be rerun with a substitute. Exclude them from current-plan aggregates. A new experiment is explicit. Existing person deletion and data-clear semantics remain in force.

Persist through the existing writer lock and atomic whole-database validation. Preserve the 100-trial and 3 MiB limits, with no automatic eviction. Reject oversize writes without partial records and retain pending results in memory for export/retry. Repeated save attempts with the same trial ID must not duplicate or silently overwrite a different result.

Provide a comparative JSON export with protocol, plan, cohort size, conditions, raw counts, denominators, individual outcomes, policy/model identity and exclusion reasons. Export stored probe vectors only through an explicitly labeled existing full-data export path; the default comparison report need not include biometric vectors. No server upload is introduced.

## 8. Architecture and UI organization

Keep matching math and evaluation planning outside React components:

- `recognition/evaluationReferencePlan.js`: proposed pure plan construction, validation and fingerprinting.
- `recognition/evaluation.js`: policy-specific replay, paired summaries and compact reports using existing ranking primitives.
- `workflows/evaluationWorkflow.js`: trial metadata, frozen-plan lifecycle, capture and pending-save handling.
- Repository/schema validators: policy dispatch, atomic persistence and legacy compatibility.
- `features/face-recognition/components/EvaluationReferencePlan.jsx` and `ComparativeEvaluationResults.jsx`: proposed MUI presentation components.
- Existing `EvaluationPage.jsx`, enrollment cards and contracts: orchestration, guidance and documented interfaces.

Use injected services and scoped repository operations; do not call localStorage from UI components. Preserve model/preprocessing contracts for future integration. Keep comparison selection entirely separate from live gallery construction.

Use MUI cards, tables, selects, alerts and existing thumbnail components. Tables must remain usable on mobile; controls need accessible labels and outcomes need text, not color alone. Explain the selected cohort and sample count in product language rather than exposing policy identifiers as primary UI copy.

When implementation is authorized, update README, interface documentation, IMPLEMENTATION.md and the existing UML with reference-plan setup, shared-probe replay, results and invalidation. Do not mark this specification implemented until code and verification are complete.

## 9. Validation and acceptance criteria

### Automated checks

1. Verify exact nested 1/3/5 sets, deterministic plans, insufficient-sample messaging and equal cohorts across modes. Ensure evaluation baseline selection never affects live matching.
2. Replay identical observations across modes. Prove with synthetic vectors that adding a retained reference cannot decrease a person's maximum score, while a competitor can produce ambiguity or a wrong result.
3. Cover below/exactly/above 0.85, 0.05 margins, ties, multiple samples belonging to one identity, stability-window changes and observation-gap failures.
4. Cover correct, missed, wrong-person, unknown-accepted and unknown-rejected outcomes; verify denominators, paired transitions, zero-trial states and identical filtering across modes.
5. Verify ground-truth restrictions, required condition metadata, enrollment-probe reuse checks and failure/cancellation counts. Do not count three observations as three trials.
6. Cover deletion, replacement, eligibility/model changes, unrelated additions, metadata renames, stale results, scope changes and cross-tab writes.
7. Verify old schemas/policies still load through existing compatibility paths and that v1/v2 trials are never silently relabeled as v3. Validate malformed plans, scores, enums and outcome evidence.
8. Verify missing thumbnails/evidence, immutable prior enrollment data, idempotent saves, 100-trial capacity, quota rejection and pending-result recovery/export.
9. Run unit tests, desktop/mobile browser checks, accessibility-focused interaction checks, formatting and production build. Update and validate UML during implementation.

### Physical-camera acceptance

Use the same held-out captures for all modes, with multiple cohort members, genuinely unknown participants and separate capture sessions. Include relevant makeup/glasses variations, normal light, reduced light, backlighting and uneven light. Keep per-mode cohorts identical and record actual failures without discarding inconvenient cases.

The existing 100-trial limit supports a pilot, not a statistically conclusive deployment study. Export separate labeled batches if needed; do not silently pool incompatible plans. Verify that curated references help on fresh captures rather than merely improving their own enrollment scores.

Browser fixtures validate implementation behavior, not recognition improvement or spoof resistance. Physical-camera results and the remaining uncertainty must be documented before recommending any threshold or production rollout.

## 10. Deferred work

- Automatic duplicate/outlier rejection and quality-based sample weighting.
- Mean embeddings, top-k aggregation, clustering or learned fusion.
- Automatic threshold calibration or production biometric acceptance targets.
- More than five references per person, larger persistent evaluation stores or backend integration.
- Automated proof that a sample's claimed identity is correct.
- Presentation-attack evaluation or changes to liveness challenges.

Each requires separate evidence and authorization; none is necessary to deliver this curation and comparison feature.

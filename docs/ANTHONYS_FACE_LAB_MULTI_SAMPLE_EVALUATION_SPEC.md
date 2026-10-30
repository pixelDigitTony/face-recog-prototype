# Anthony's Face Lab: Multiple Samples and Recognition Evaluation

Status: **Implemented locally; see IMPLEMENTATION.md for validation and outstanding physical-camera acceptance.**  
Date: 2026-10-30 (Asia/Manila).  
Project: `C:\Users\USER\projects\Starwinner\face-recog-prototype`.

## 1. Purpose and authority

Allow one enrollee to retain several face samples captured on different days or with different appearances, such as with makeup, without makeup or with glasses. Add a separate evaluation screen to measure whether those samples improve recognition and to explore threshold tradeoffs without changing normal Scan behavior.

This document records the approved **Samples + evaluation** plan. Application implementation was subsequently authorized in this conversation. Deployment remains outside this local implementation.

When implemented, this specification supersedes the single-active-template assumptions in the earlier prototype and automatic-identification specifications. The existing closest-candidate, lighting, enrollment challenge and continuous-tracking requirements remain in force except where explicitly revised below. Historical policies retain their original meaning.

The app remains React JavaScript with MUI, frontend-only recognition and browser-local storage. Maintain dependency injection between components, workflows, recognition engines and repository adapters so the feature can later use a host application's services. The product name remains **Anthony's Face Lab**.

## 2. Current implementation and scope

The current repository stores one template per person, links it through `activeTemplateId`, and deletes that person's previous template when saving an enrollment. Gallery construction selects only that template. Ranking, stability, event validation and candidate resolution consequently assume one template equals one person.

Simply retaining additional template rows would be incorrect: two samples belonging to the same person could become each other's runner-up, trigger ambiguity or reset the stability window when the winning sample changes.

| Area           | Required behavior                                                                 |
| -------------- | --------------------------------------------------------------------------------- |
| Enrollment     | Retain up to five samples under one person; add, replace and delete individually. |
| Identification | Rank distinct people using each person's best eligible sample.                    |
| Stability      | Follow the person across observations, allowing the winning sample to change.     |
| Presentation   | Show the exact winning sample's thumbnail and label for each tracked face.        |
| Evaluation     | Compare fresh labeled trials against primary-only and all-sample galleries.       |
| Compatibility  | Migrate existing data without losing records or rewriting historical decisions.   |

No backend, paid service, new model, automatic learning, attendance authorization or deployment is included. Scan remains automatic identification with no enrollee selector or movement instructions; its liveness status remains `not_checked` and its results remain non-authoritative.

## 3. Enrollment and sample management

### 3.1 User flow

1. Select or create the person on Enroll.
2. Show their sample count, primary sample and saved sample cards. Each card contains a thumbnail or placeholder, editable label, capture date, source, model compatibility and quality information.
3. For a person without samples, offer **Capture & enroll**. For an enrolled person, make **Add face sample** the default action.
4. Complete the existing live enrollment challenge and explicitly capture the new sample. Save only after the existing capture-quality and challenge-continuity checks pass.
5. Append the new sample to the selected person. Preserve all other samples and existing history.

Use labels such as “With makeup”, “Without makeup” or “Glasses” as optional operator-entered descriptions, never attributes inferred from the face. Default to “Sample 1”, “Sample 2”, and so on when no label is entered. Labels are trimmed, limited to 60 characters and presented as plain text. Labels need not be unique; dates and sample identifiers disambiguate them.

Provide **Replace this sample**, **Delete sample** and **Set as primary** actions. Replacing requires a new successful capture and atomically swaps only the selected sample after saving succeeds. The previous sample remains available if capture or persistence fails. Confirm sample deletion with the specific person and sample displayed.

The first sample becomes primary. Deleting the primary selects the oldest remaining sample, with ID as a deterministic tie-breaker. Deleting the final sample leaves the person record present but unenrolled. Replacing the primary makes the replacement primary. A primary sample is a display/evaluation baseline choice; it receives no extra weight in normal multi-sample matching.

### 3.2 Limits and continuity

- Permit at most five stored templates per person, including diagnostic-only templates. Start by recommending two or three useful appearance variations rather than filling every slot.
- At five samples, disable adding and explain that the user must explicitly replace or delete a sample. Never evict samples automatically.
- Preserve the existing single-person enrollment challenge, retained completed steps, stable readiness and fresh capture validation.
- A new appearance does **not** need to score 85% against an older enrollment. The existing strict `> 0.85` check between the final capture and its own completed challenge remains unchanged.
- Selecting an enrollee establishes the intended association for this prototype; passing the motion challenge does not independently verify that claimed identity. Show the selected person's name/code clearly during capture.
- Do not add samples from ordinary Scan results, evaluation captures or low-confidence candidates.
- Keep lighting feedback advisory and preserve existing hard capture gates. Guide users toward sharp, evenly lit references rather than saving heavily shadowed or poorly exposed samples as variations.
- Changes to another person's records must not reset enrollment progress. A sample-set revision change for the selected person invalidates a pending commit so an outdated capture cannot overwrite newer data.

## 4. Person-level recognition

### 4.1 Gallery and ranking

Build the gallery from all eligible templates, retaining the current scope, consent, source, normalized 128-value embedding, model hash and preprocessing compatibility checks. Diagnostic `test_image` templates stay excluded; compatible legacy templates retain their current eligibility.

For probe embedding `q` and person `p`:

```text
personScore(p) = max(cosine(q, template.embedding))
                over p's eligible templates
```

Retain the winning template's ID/version alongside each person's score. Rank people by descending score, breaking exact person ties by person ID. Within a person, break equal sample scores by template ID. Tie-breaking selects a deterministic preview; it does not bypass ambiguity rules.

Compute the runner-up from the next **different person**. Count people above the threshold, not individual samples. Expose eligible-person and eligible-sample counts separately; a person with five samples remains one candidate identity.

New per-observation identification requires all of:

- Raw cosine similarity `>= 0.85`; exactly 85% qualifies.
- Exactly one distinct person at or above that threshold.
- A margin of at least `0.05` over the next different person, when one exists.

Keep the direct cosine-to-display-percentage mapping and use unrounded values for decisions. A similarity percentage is not an identity probability. Do not inflate scores, average all appearances into one template, weight the primary sample more heavily or lower the live threshold in this iteration.

### 4.2 Stability, confirmation and history

Require three consecutive qualifying observations of the same person over at least 600 ms, retaining the existing maximum 1,500 ms gap and freshness requirements. Bind the window to session, track, gallery version, classification and person. A change of winning sample within that person must not reset it.

Use the minimum person score across the accepted window as the confirmation score. Record the exact supporting template ID/version per observation. The event's summary template is the winning template from the observation that supplies its minimum score; choose the earliest observation on equal minimum scores.

Retain duplicate-identity protection across simultaneous face tracks. A confirmed owner remains confirmed while a competing unconfirmed track stays amber. Preserve current track association, disappearance, uncertainty, freshness and stop/error behavior.

Once confirmed, continue detection and tracking without repeated SFace comparison. Retain the supporting template fingerprints from all three observations. Deletion, replacement, ineligibility or biometric modification of any supporting template invalidates confirmation. Adding other samples, deleting unused samples, changing the primary selection, renaming labels or editing unrelated people does not invalidate an otherwise valid confirmation. Update display metadata without reconfirming.

New decisions use `identify-85-multisample-v3`. Keep validation for `identify-85-strict-v1` and `identify-85-inclusive-v2` unchanged. New policy validation permits different supporting templates for the same accepted person; old policies continue requiring their original sample binding.

For unrecognized or ambiguous outcomes, accepted identity fields remain null and closest candidates remain transient presentation data. Do not save a low-score candidate as a recognized identity. Keep existing encounter deduplication, cooldown, bounded pending-save behavior and retry semantics.

### 4.3 Camera and accessible presentation

Every tracked face shows its own closest person, winning sample label, exact sample thumbnail and similarity. Mirror these details in the accessible detected-faces list.

Keep amber for low scores, unstable matches, ambiguity and identity conflicts. Green requires stable unique acceptance. Once confirmed, retain the existing **Tracking confirmed face** and **Confirmed similarity** presentation using the confirmation summary sample.

Missing or unloadable thumbnails use a neutral placeholder. Never substitute the live probe or another sample's thumbnail. Clear stale candidates when their sample disappears or becomes ineligible. Keep labels attached to their face boxes and bounded within the preview on desktop and mobile.

## 5. Evaluation screen

### 5.1 Capture and ground truth

Add an **Evaluate recognition** navigation item and `/evaluate` route, using the existing MUI layout and injected services.

Before starting each trial, the operator selects either an actual enrolled person or **Not enrolled**. Unenrolled participants require an operator-entered participant label so repeated trials can be grouped without treating every frame as a different person. Optional appearance and lighting notes describe the test conditions. Never infer ground truth from the closest candidate or accepted result.

Collect a fresh webcam trial containing three quality-valid observations of one continuously tracked face over at least 600 ms, with no gap greater than 1,500 ms. Keep the same preprocessing and compatible model identity as recognition. Tracking loss, multiple faces, quality failure, cancellation and inference failure produce explicit incomplete/capture-failed outcomes, not zero similarity values. Partial observations are not scored as completed trials.

Evaluation has explicit Start/Cancel and operator guidance. It does not run the enrollment challenge or create a live identification event; liveness remains `not_checked`. Evaluation probes must never be drawn from stored enrollment embeddings, enrollment thumbnails or ordinary scan history, and must never become reference samples.

### 5.2 Paired comparison and threshold exploration

Evaluate each completed trial twice against the same current gallery snapshot:

1. **Primary sample only:** one designated eligible primary template per person.
2. **All samples:** all eligible templates grouped by person using the maximum score.

If an otherwise eligible person has an ineligible primary template, exclude that person from paired reports until the operator selects an eligible primary. Explain the exclusion and report its count. Do not silently substitute another sample or compare different person populations between the two modes.

Show the expected person's score, strongest competing person's score, predicted person, winning sample and final outcome for each mode. For unenrolled participants there is no expected-person score; show the strongest gallery candidate without treating it as ground truth.

Replay the three observations using the person-level stability rules and thresholds from `0.20` through `0.95` in `0.05` increments, including the current `0.85`. Retain the `0.05` margin and distinct-person uniqueness rule at every threshold. When the observations do not produce a stable accepted identity, report the actual non-acceptance reason; never collapse an unstable winner into a recognized result.

The threshold table is experimental and has no **Apply** action. It does not modify normal Scan, enrollment consistency, history, primary selection or saved settings. Higher thresholds are more restrictive; lower thresholds can increase both genuine acceptance and wrong-person acceptance.

### 5.3 Reports and denominators

Show counts, denominators and percentages separately for:

- Correctly identified enrolled-person trials.
- Enrolled-person trials with no accepted identity, including unknown, ambiguous and unstable outcomes.
- Enrolled-person trials accepted as the wrong person.
- Unenrolled-participant trials accepted as any enrolled person.
- Unenrolled-participant trials with no accepted identity.
- Incomplete/capture-failed, incompatible and otherwise excluded trials.

The first three categories partition completed, comparable enrolled-person trials. The next two partition completed, comparable unenrolled-participant trials. Show zero-denominator rates as unavailable, not 0%. Detection/capture failures remain visible alongside completed-trial metrics, so a clean recognition percentage cannot hide capture failures.

Display distinct participant counts and permit filtering by participant and appearance/lighting notes. Three observations form one trial; they are not three independent tests. Present this as local identification evaluation, not certified accuracy, a calibrated probability, or a measured production false-match guarantee.

### 5.4 Persistence and staleness

Store at most 100 evaluation trial records, including incomplete saved trials, under the existing shared storage budget. Store manual truth labels, participant/condition notes, timestamps, up to three normalized embeddings, quality metrics, model/preprocessing identifiers, gallery version and evaluation-policy version. Store summary outcomes for the two modes; derive threshold tables from the saved probes instead of persisting large redundant matrices.

Do not retain full video, full-resolution frames or probe thumbnails. Support viewing, deleting individual trials, clearing evaluation data and exporting reports separately from the full database export. Failed or partial trials retain their failure reason but no partial embeddings.

Use `evaluation-multisample-v1` for evaluation semantics. Bind reports to gallery contents and primary selections. Relevant gallery changes mark existing reports **Outdated**; an explicit **Rerun against current gallery** recomputes both modes from compatible saved probes. Never silently mix old results with current-gallery aggregates. Model/preprocessing incompatibility requires fresh captures. A gallery change during capture or scoring must prevent publishing a report as current.

Renaming a person updates presentation through their ID without changing manually assigned truth. Deleting a person removes their linked evaluation trials, as it removes other person-linked prototype records. Trials labeled Not enrolled remain, with reports invalidated when the gallery changes. A participant later becoming enrolled requires the operator to relabel or remove their old Not enrolled trials before using those trials in a new report.

## 6. Data, migration and repository contracts

### 6.1 Schema 4

Introduce schema 4 with these conceptual changes:

| Record/interface       | Change                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person                 | Replace the single-active-template assumption with `primaryTemplateId` and a monotonic `enrollmentRevision`. Derive sample membership from templates' `personId`. |
| Template               | Keep ID, version, person/scope, embedding, model, provenance, quality and optional thumbnail fields; add an editable label.                                       |
| Gallery                | Include all eligible templates and explicit eligible-person/sample counts, with deterministic ordering and a version covering recognition-relevant contents.      |
| Identification result  | Retain separate accepted identity and closest candidate; include the exact winning sample per observation.                                                        |
| Identification history | Add v3 policy support and a sample count while keeping `eligibleCount` as the distinct-person count.                                                              |
| Evaluation trial       | Add a separate `evaluationTrials` collection with the data and policy described above.                                                                            |
| Repository             | Add explicit add/replace/delete sample and set-primary operations, plus save/delete/clear/rerun evaluation operations.                                            |

Sample mutations use the expected person enrollment revision for concurrency checks. Replacing creates a new template ID and retains old historical references as historical evidence; sample deletion does not delete previous enrollment/identification history. Advance enrollment revision on membership, replacement and primary changes. Use monotonic versions for new samples rather than deriving versions from the surviving sample count.

An add or replacement transaction saves the sample, updates the person and appends its enrollment attempt atomically. Retry the same operation idempotently; it must not append a duplicate sample or consume another slot. Sample limits and scope checks are enforced in the repository as well as the UI. Names/labels remain main-thread presentation metadata; thumbnail bytes never enter the worker gallery.

Update diagnostic comparisons and database tables to handle multiple samples explicitly. Diagnostic comparison remains non-authoritative and uses the selected person's eligible samples, reporting the winning sample. Diagnostic-only templates never become live candidates merely because they are primary.

### 6.2 Migration and compatibility

- Validate the original database using its original schema rules before migration.
- Migrate schemas 1 and 2 through the existing legacy normalization, then migrate schema 3 to schema 4.
- Preserve database/person/template IDs, embeddings, model metadata, consent, scope, thumbnails, attempts and identification events. Copy the old `activeTemplateId` into `primaryTemplateId`; label the existing sample “Original sample”. Initialize enrollment revision from the existing template version, or zero for an unenrolled person.
- Initialize an empty evaluation collection. Preserve existing scan history and its policy metadata without rescoring or rewriting outcomes.
- Perform migration under the existing writer lock, validate the complete new document and persist atomically. Read-only tabs may inspect a migrated in-memory view but cannot write it.
- Preserve raw storage bytes for recovery if validation, capacity checking or persistence fails. Do not reset the database automatically.
- Preserve the existing internal storage key and context identifiers; changing branding must not orphan previously saved browser data.

Schema 4 readers must reject unsupported future versions. Once schema 4 is persisted, an older app build must not write the database; stale writer attempts must fail validation. Do not implement a lossy downgrade to the single-template schema.

### 6.3 Capacity and deletion

Retain the existing 50-person, 200 combined enrollment/diagnostic-attempt and identification-event, and 3 MiB estimated storage limits. Add the five-template-per-person and 100-evaluation-trial limits. Evaluation records have their own count limit but share the same total byte budget.

These are upper bounds, not a guarantee that all limits fit simultaneously. Explain capacity failures and offer existing export/delete actions. Never silently evict data, remove thumbnails, overwrite another sample or partially save a transaction to make room.

Full database export/reset includes the new data. Person deletion removes all their templates and linked attempts, identification events and evaluation trials. Individual sample deletion preserves historical results but invalidates affected current candidates, confirmation evidence and evaluation reports.

## 7. Architecture and documentation

Keep recognition math and evaluation replay as pure reusable modules, independent of React and storage. Use the same person-ranking and stability semantics in evaluation and Scan, parameterizing experimental thresholds only in evaluation. The live identification entrypoint must continue fixing its threshold at 0.85.

Keep model inference in the existing worker. Multiple reference comparisons reuse each probe embedding; do not run SFace separately for every stored sample. Preserve existing frame scheduling, bounded work, cancellation, resource cleanup and per-track fairness.

Components call workflows; workflows call injected engines and repository operations. Avoid direct localStorage access or policy duplication in UI components. Extend the existing JavaScript interface documentation and test fixtures rather than creating a second independent recognition pipeline.

During implementation, update the existing UML and automatic-identification/closest-match documentation to cover one person with many templates, person-level ranking, evaluation capture/replay, migration and supporting-sample invalidation. Update README and implementation notes with actual validation evidence. Historical document filenames do not require renaming.

## 8. Validation and acceptance criteria

### Enrollment and storage

- Add samples across separate sessions without replacing prior samples or creating duplicate people.
- Replace/delete only the selected sample; verify primary reassignment and deleting the last sample.
- Reject a sixth sample and oversized transactions without changing saved data.
- Preserve retained challenge progress and stable enrollment readiness. A valid new appearance can be added even below 85% against old samples.
- Verify idempotent retries, stale revision rejection, read-only tabs and persistence failure recovery.
- Migrate valid schema 1/2/3 fixtures with IDs, embeddings and history intact; preserve corrupt originals for recovery.

### Recognition and tracking

- Test below, exactly and above 0.85 using unrounded scores.
- Ensure several strong samples of one person are one identity, not an ambiguous tie.
- Test runner-up margin and above-threshold counts across different people.
- Alternate winning samples of one person across three observations without resetting stability; changing person or gallery still resets it.
- Check summary-template/minimum-score consistency and v1/v2/v3 historical validation independently.
- Verify independent closest thumbnails for multiple faces, missing thumbnails, duplicate-identity protection and sample deletion/replacement.
- Confirm continuous tracking skips repeated embedding extraction; changing unused samples preserves confirmation while changing supporting samples releases it.
- Verify unknown/ambiguous results never save candidate identity fields.

### Evaluation

- Capture independent known-person and unenrolled-participant trials with manual labels.
- Verify paired reports use identical probes and comparable person populations.
- Test all outcome categories, unstable observations, exact threshold boundaries, zero denominators, incomplete captures and duplicate participant grouping.
- Verify threshold exploration cannot alter Scan, enrollment or stored production-policy settings.
- Test outdated reports, explicit reruns, model incompatibility, person deletion and corrected ground truth.
- Ensure no evaluation capture becomes an enrollment or live identification event.
- Verify trial count/byte limits, report export, deletion and full database recovery/export.

### Delivery checks

Run relevant unit tests, desktop/mobile browser checks, formatting validation and a production build. Exercise navigation/deep-link refresh, responsive sample cards, crowded face overlays, keyboard operation and accessible labels/statuses.

Check matching workload at the maximum 50 people and 250 stored samples, including multiple tracked faces. Report observed latency rather than assuming that additional samples are free. Confirm that embedding extraction count does not scale with reference count.

Physical-camera acceptance must include separate enrollment and test sessions, makeup/no makeup, glasses, representative lighting, enrolled and unenrolled people, and multiple people in view. Report the number of people/trials and test conditions. Automated fixture success does not establish real-camera recognition improvement.

## 9. Other solutions and follow-up decisions

**Improve capture first.** Encourage soft, even frontal lighting, a clear sharp face and a suitable camera position. Multiple samples should represent useful appearance differences, not compensate for consistently poor capture conditions. [AWS capture guidance](https://docs.aws.amazon.com/rekognition/latest/dg/recommendations-facial-input-images.html)

**Evaluate thresholds before changing them.** OpenCV documents an SFace cosine threshold of 0.363 for its LFW benchmark, while this app currently requires 0.85. That demonstrates why genuine faces need not reach 95%; it does not establish the correct threshold for this gallery, camera or operating environment. Keep the requested 85% live boundary until reviewed local results justify a separate policy change. [OpenCV SFace documentation](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html)

**Consider a best-frame burst next.** A short capture burst could select a sharper reference within one enrollment visit. It cannot replace collecting appearances that occur on different days. Burst selection is deferred from this iteration.

**Evaluate preprocessing or model changes separately.** Contrast normalization may be worth testing if lighting remains problematic; it must be assessed consistently for references and probes and may require re-enrollment/version changes. A different recognition model should be benchmarked with the same held-out trials and its licensing checked. Neither change is included here.

**Keep sample additions explicit.** Automatic template updates from ordinary scans risk reinforcing an incorrect identity association. Multi-reference approaches are used by existing recognition systems, but their gains are model- and workflow-dependent and are not a promised improvement for this prototype. [AWS multiple-reference documentation](https://docs.aws.amazon.com/rekognition/latest/dg/collections.html)

## 10. Implementation boundary

The implementation described here is local to the standalone prototype. Schema migration runs when its new application build opens existing browser data. Scan remains at 85%. The UML and interface documentation have been updated; deployment and physical-camera acceptance remain separate work.

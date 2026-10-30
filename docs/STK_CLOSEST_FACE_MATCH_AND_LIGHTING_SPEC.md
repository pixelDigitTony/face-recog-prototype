# STK per-face closest records, thumbnails and lighting feedback

Status: **Implemented locally — see IMPLEMENTATION.md for validation and remaining physical-camera acceptance.**
Date: 2026-10-30 (Asia/Manila).  
Project: `C:\Users\USER\projects\Starwinner\face-recog-prototype`.  
Source review baseline: commit `cf8a053`; clean working tree before this document was added.

## 1. Purpose and authority

Every tracked face on **Scan face** must display its own closest eligible enrolled record, stored enrollment thumbnail and current similarity, including scores below 85%. A closest candidate is a suggestion; a recognized identity additionally satisfies the acceptance policy.

This specification implements the approved conversation plan. The user selected **Quality feedback** for lighting improvements and **Keep amber if ambiguous** for scores at or above 85% with competing records.

When implemented, this document supersedes the candidate-name suppression, strict scan cutoff, scan label and scan color requirements in [STK_AUTOMATIC_FACE_IDENTIFICATION_SPEC.md](STK_AUTOMATIC_FACE_IDENTIFICATION_SPEC.md). Other automatic-identification requirements continue to apply. In particular, enrollment retains its current guided liveness, retained challenge steps, capture validation and stable readiness behavior. Its existing strict comparison policy is not changed by the new scan policy.

The application remains React JavaScript with MUI and browser-local storage. Preserve dependency injection between UI, workflows, recognition engines and repository adapters for later STK integration. This change adds no backend, recognition service, attendance authorization or deployment.

## 2. Current behavior and intended change

Source inspection shows that the worker already ranks the eligible gallery, but `rankEmbedding` returns person/template identifiers only for an accepted per-probe classification. The live UI consequently hides the closest person's name for unknown and ambiguous results. The gallery currently contains one active compatible template per person.

Enrollment templates already support optional `thumbnailDataUrl`, with thumbnail saving enabled by default. Automatic scan events intentionally contain no stored probe image. Image quality currently checks face size, blur, landmarks and average brightness; it does not separately report clipped exposure or side-to-side lighting differences.

| Area             | Required change                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Closest record   | Return and display the best eligible candidate separately from an accepted identity.                                            |
| Face association | Maintain a separate candidate, thumbnail, similarity, status and stability window for every face track.                         |
| Scan cutoff      | New scan decisions use raw cosine **>= 0.85**. Exactly 85% qualifies for threshold evaluation.                                  |
| Recognition      | Keep stability, margin, uniqueness, tracking and freshness checks. Passing the numeric cutoff alone does not turn a face green. |
| Lighting         | Add advisory status labels on Scan and corrective guidance on Enroll.                                                           |
| History          | Preserve existing records and their policy meaning; candidate previews remain transient.                                        |

## 3. Camera labels and accessible list

Each tracked face's compact label appears attached to its own box inside the live camera feed. It contains:

- Temporary face/track number and separately labelled detection confidence.
- **Closest record — unconfirmed** and the candidate's name/employee code while acceptance is pending or unsuccessful.
- **Recognized: Name (Employee code)** after stable acceptance.
- Current **Similarity: NN.NN%**, distinct from detection confidence and any saved result's minimum score.
- The stored thumbnail belonging to that exact candidate template, normally rendered as a 40 × 40 px MUI Avatar.
- Relevant descriptive state and lighting indicators.

| State                                                      | Box and candidate accent | Text/behavior                                                                         |
| ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| No completed comparison                                    | Blue                     | Searching; no candidate or thumbnail; similarity is a dash.                           |
| Fresh candidate below 85%                                  | Amber                    | Closest record — unconfirmed; include “Below 85%.”                                    |
| Fresh candidate at/above 85%, stability incomplete         | Amber                    | Closest record — unconfirmed; Checking stability.                                     |
| Stable accepted identity                                   | Green                    | Recognized; current similarity and matching enrollment thumbnail.                     |
| Ambiguous ranking                                          | Amber                    | Closest record — unconfirmed; Ambiguous match.                                        |
| Multiple tracks competing for the same acceptable identity | Amber                    | Closest record — unconfirmed; Identity conflict; no accepted identity.                |
| Quality failure or uncertain tracking association          | Amber                    | Appropriate quality/tracking status; clear prior candidate, thumbnail and similarity. |
| Expired analysis                                           | Amber                    | Waiting for analysis; clear prior candidate, thumbnail and similarity.                |
| Empty eligible gallery                                     | Blue                     | No eligible enrollments; continue detection without candidate or scan events.         |

Show the best eligible candidate at any finite score, with no new candidate-display cutoff. An exact ranking tie may use the existing deterministic person-ID order to select the displayed closest record, but cannot produce an accepted identity. A low score does not assert the face belongs to the suggested person.

Use the existing direct percentage mapping `100 * clamp(cosine, 0, 1)` and unrounded values for decisions. If rounding displays 85.00% for a value just below 0.85, retain the explicit “Below 85%” state; never promote based on formatted text. Missing comparison results are not 0%.

The thumbnail must come from the candidate's active local template, never from the live camera, another person's record or a stale accepted result. Missing, invalid or unloadable thumbnails use a neutral placeholder labelled **No enrollment photo**. Do not enable saving automatically or require re-enrollment for missing photos.

Mirror all per-face details in the accessible **Detected faces** MUI list. Use text as well as color; image alternative text identifies the enrollment photo. Keep overlay text upright in the mirrored feed, clamp labels inside preview bounds and preserve visible track IDs in compact layouts. When labels crowd each other, compact their layout and retain complete details in the list; never merge candidates across faces. Announce candidate/recognition state transitions politely, rather than every score update.

Scan continues to have explicit Start/Stop and no person selector, movement challenge or hidden challenge instructions. Lighting labels on Scan are descriptive statuses. Enroll retains corrective instructions in the tracked-face label and accessible companion list.

## 4. Recognition contracts and state lifecycle

Extend the worker ranking result with a nullable presentation candidate:

```js
closestCandidate: {
  personId,
  templateId,
  templateVersion,
  similarity, // raw cosine for this candidate in this probe
}
```

Existing accepted `personId`, `templateId` and `templateVersion` remain null for `UNKNOWN` and `AMBIGUOUS`. Return no candidate when the gallery is empty, extraction failed or no valid embedding was produced. Invalid/nonfinite scores remain analysis errors.

The identification workflow exposes `identification.closestCandidate` per face, enriched on the main thread with `personSnapshot` and `thumbnailDataUrl`. Resolve these only when the person, active template ID/version, eligibility and current gallery match the ranking. Keep photo bytes outside the worker gallery and biometric gallery hash. A thumbnail-only change refreshes presentation without resetting comparison windows; history writes continue not to invalidate the gallery.

Show fresh candidate previews after a valid comparison; they do not wait for the three-sample acceptance window. A winner change immediately updates the preview and clears any incompatible accepted identity. Retain the existing same-person/template/session/track/gallery binding for accepted observations.

Clear candidate presentation alongside current identity on Stop, navigation, tab hiding, session changes, lost/ambiguous track association, quality failure, gallery replacement, obsolete worker replies or freshness expiry. A result older than 1.5 seconds must not remain displayed. Brief missed detections may retain encounter deduplication as before, but must not transfer a photo/name to a different face.

Keep current scheduling limits: one pipeline in flight, at most two embeddings per pipeline, six embeddings/second overall, three/second per track, fair scheduling and no queued camera frames. A low-quality face must not block another usable face. Preserve error cleanup, worker cancellation and storage retry/discard behavior.

## 5. Inclusive scan policy and historical compatibility

Use **`identify-85-inclusive-v2`** for newly committed scan decisions. Keep `identify-85-strict-v1` as an explicit historical policy and retain `cosine-positive-percent-v1` for score display.

For v2, let `s1` be the best raw cosine and `s2` the best score for another person:

1. `s1 >= 0.85`.
2. Exactly one distinct person scores `>= 0.85`.
3. When a runner-up exists, `s1 - s2 >= 0.05`.
4. Three consecutive eligible comparisons accept the same person/template over at least 600 ms, with no gap over 1.5 seconds and no cross-track identity conflict.

One eligible enrollment has no runner-up, so the margin test is inapplicable. Keep full-gallery ranking and use raw values for the margin. No tolerances may silently relax either boundary.

| Example                    | Result before temporal acceptance               |
| -------------------------- | ----------------------------------------------- |
| 84.99%, runner-up 40%      | UNKNOWN; closest record visible in amber.       |
| Exactly 85%, no runner-up  | Eligible; amber until stable, then green.       |
| 92%, runner-up 78%         | Eligible; amber until stable, then green.       |
| 92%, runner-up 87%         | AMBIGUOUS; two qualifying people; amber.        |
| 88%, runner-up 84%         | AMBIGUOUS; insufficient margin; amber.          |
| 90%, runner-up exactly 85% | AMBIGUOUS under v2; two qualifying people.      |
| 82%, runner-up 80%         | UNKNOWN; closest record still visible in amber. |

Continue scanning after each decision. Keep the existing minimum-score aggregation for identified history and last-probe aggregation for unknown/ambiguous history, encounter deduplication and person cooldown. Candidate changes below threshold are preview changes, not new recognized identities.

Persist new results with `thresholdSnapshot: 0.85`, `comparisonOperator: '>='` and the v2 policy. Retain the existing `aboveThresholdCount` field for schema compatibility; its meaning is the count satisfying the recorded policy operator (inclusive for v2, strict for v1).

Validators must dispatch by an explicit known policy version for threshold, qualifying counts, classification and operator validation. Existing v1 records continue to mean strictly greater than 85%; do not rewrite or reinterpret them. Reject unknown policies and mismatched operators. New saves require v2, while an idempotent retry of an identical already-persisted event remains supported.

Keep database schema 3 and its existing storage namespace; no enrollment conversion, record deletion or forced re-enrollment. Render history thresholds from recorded operator/value instead of a hardcoded `> 85%`. Update current scan/settings copy to distinguish the inclusive scan threshold from legacy/enrollment strict comparisons.

Strip `closestCandidate`, candidate names/photos and other transient presentation fields before constructing persisted decision samples/events. Rejected outcomes retain null identity fields. Automatic scan events retain `probeEmbedding: null`, `thumbnailDataUrl: null`, `livenessStatus: 'not_checked'`, `liveness: null` and `authoritative: false`. A suggested record must never appear as a saved identified person below the acceptance threshold.

## 6. Lighting feedback

Add a pure, testable lighting-statistics helper used by `assessQuality`. Compute grayscale statistics from the central 80% of the detected face box (inset 10% per side), clipped to source bounds. Retain current full-face brightness/blur measurements and all existing blocking quality gates. Use current grayscale conversion and source pixels without altering the SFace input.

Return optional `quality.lighting` containing `version: 'lighting-feedback-v1'`, mean brightness, near-black fraction, near-white fraction, absolute left/right mean difference and warning codes. Divide the advisory region into two equal-width halves; ignore an unmatched middle column when its width is odd. If the clipped region cannot supply at least one column per half or a valid pixel row, return null instead of fabricated statistics.

| Indicator       | Experimental trigger                                         | Enroll guidance                                                |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Low light       | Mean < 60, or more than 20% of pixels have luminance <= 5    | Face a soft light source; avoid a bright window behind you.    |
| Overexposed     | Mean > 200, or more than 20% of pixels have luminance >= 250 | Reduce direct light or glare so facial details remain visible. |
| Uneven lighting | Absolute left/right mean difference > 40                     | Use more even frontal light to reduce strong side shadows.     |

Values use the 0–255 grayscale range. Conditions may coexist and appear in the table's order. Exact 60, 200, 20% and 40 boundaries do not trigger their corresponding strict condition. No warnings means no advisory detected, not proof that the image is suitable or the identity is correct.

Warnings are advisory and do not reset enrollment progress, disable an otherwise ready enrollment or block a valid scan. Existing hard quality failures still take precedence. If an accepted scan has an advisory, retain its green recognition state and display the lighting warning separately. Missing lighting metadata on historical records is valid.

Preserve current model/preprocessing versions, stored embeddings and camera configuration. This iteration does not introduce image enhancement, automatic exposure controls, multiple-reference enrollment or a sensitivity slider. Include practical enrollment guidance about frontal soft lighting, avoiding backlighting, camera placement at eye level and checking the lens for dirt.

## 7. Similarity and lighting explanation

Lowering an acceptance threshold makes matching more permissive, with a possible increase in incorrect matches. Raising it makes acceptance harder. Raw SFace cosine similarity is not calibrated identity confidence; a new image of the same person is not guaranteed to score 95%, especially across lighting, pose or camera changes.

[OpenCV's SFace tutorial](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html) documents an LFW benchmark cosine threshold of 0.363. This illustrates why a raw 0.85 requirement is demanding; it is not a validated replacement threshold for this prototype's multi-person identification. Keep the requested 85% green boundary and do not inflate or remap measured scores to reach it.

[Microsoft's capture guidance](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/face/characteristics-and-limitations#control-image-capture-environment) identifies under/overexposure, backlighting and uneven illumination as capture concerns. Treat the above warning thresholds as prototype heuristics, not calibrated guarantees across cameras or skin tones.

Before recommending another recognition threshold, collect consented genuine-user and different-person comparisons across representative devices, distances, normal indoor light, dim light, backlight and side lighting. Report score distributions and false accepts/rejects. Multiple reference samples and contrast normalization are potential later experiments; both require separate evaluation and compatibility planning.

## 8. Implementation locations and documentation

Keep implementation in the existing architecture:

- Recognition: extend `identificationPolicy.js`; retain worker operation interfaces; add lighting statistics alongside `imageQuality.js`.
- Workflow: extend `liveIdentificationWorkflow.js` with transient candidate presentation, current-template resolution and consistent clearing.
- UI: share candidate/thumbnail presentation between `FaceOverlay`, `DetectedFacesList` and scan announcements; add enrollment lighting guidance without changing challenge state.
- Repository: version-aware identification validation, new-save policy enforcement and metadata-derived threshold display in Database/Settings.
- Contracts/docs: document candidate and lighting shapes in `src/features/face-recognition/contracts.js`; update the earlier automatic-identification spec and `docs/STK_FACE_RECOGNITION_PROTOTYPE_UML.puml` during implementation. UML must show the worker candidate response, main-thread photo resolution, advisory lighting branch and separate persisted decision.

Use MUI components and existing feature services; avoid app-shell dependencies in recognition helpers. Reuse stored thumbnails without duplicating them into scan history. Preserve the 50-person, 200-combined-history-record and estimated 3 MiB storage limits.

## 9. Acceptance and verification

| ID    | Required scenario                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF-01 | Two or three faces receive independent correct closest records, scores and thumbnails in their boxes and list rows. No shared/global candidate state.                                                                     |
| CF-02 | Below-threshold faces show amber unconfirmed candidates after a valid comparison; stable rejected history has null identity and contains no candidate preview/photo.                                                      |
| CF-03 | Raw scores below, exactly at and above 0.85 obey v2; rounding cannot promote a result. A valid exact-85% result becomes green only after stability.                                                                       |
| CF-04 | Near ties, exact ties, two qualifying records and duplicate accepted identities across tracks remain amber. Both tracks may preview the same closest record without being accepted.                                       |
| CF-05 | Alternating winners reset acceptance; quality failure, ambiguous crossing, missing detection, expired evidence, Stop and late replies clear stale names/photos.                                                           |
| CF-06 | Missing/unloadable thumbnail uses the neutral placeholder. Deleted/replaced/ineligible enrollment never supplies a stale photo; thumbnail-only updates refresh without resetting recognition.                             |
| CF-07 | Mixed v1/v2 history loads, exports and displays its recorded operators correctly. Unknown policies or mismatched threshold/count evidence fail validation. Existing enrollment and schema-3 records remain intact.        |
| CF-08 | Empty gallery draws detection boxes without a fabricated candidate or saved unknown events. Invalid embeddings/scores produce analysis errors.                                                                            |
| CF-09 | Synthetic dark, overexposed, uneven and normal images exercise each lighting condition and exact boundaries; changing pixels outside the central region does not alter advisory statistics. Test clipped/invalid regions. |
| CF-10 | Lighting warnings are independent for each face. Advisory-only changes do not block acceptance or disable/reset completed enrollment steps. Existing hard quality failures still behave correctly.                        |
| CF-11 | Desktop and mobile previews keep labels readable within camera bounds; list details and image alternatives remain accessible; Scan has no person selector or challenge instructions.                                      |
| CF-12 | Saved-result deduplication, quota retry/discard, repository locking, gallery replacement and camera cancellation regressions pass. Scan does not initialize liveness assets.                                              |

During implementation run the unit suite, relevant browser integration tests (including real recognition fixtures), desktop/mobile rendered checks, formatting, production build and production-preview checks. Record actual results in `IMPLEMENTATION.md` and syntax-check the updated UML. Deterministic/mocked tests should cover exact thresholds and exceptional states that real images cannot reliably produce.

Physical-camera acceptance remains separate: verify the enrolled person's closest record across lighting conditions and inspect wrong-person suggestions, camera behavior, label continuity and responsiveness. Synthetic image success does not establish population accuracy or guarantee 95% similarity. Deployment to Vercel and STK integration remain separate actions.

## 10. Deliverable status

This specification was created before implementation. Its application changes are now implemented locally and the UML/contracts have been updated. Existing local enrollment data is retained; no deployment was performed. Validation evidence and remaining device acceptance are recorded in [IMPLEMENTATION.md](IMPLEMENTATION.md).

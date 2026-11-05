/**
 * @typedef {{environment:string, companyId:string, storeId:string|null}} FeatureContext
 * @typedef {{attemptId:string, outcome:string, persisted:boolean, authoritative:false, error?:string}} WorkflowResult
 * @typedef {{initialize:Function, extract:Function, analyzeFrame:Function, setGallery:Function, detectFrame:Function, extractFaces:Function, releaseFrame:Function, dispose:Function}} FaceEngine
 * @typedef {{start:Function, process:Function, observePose:Function, stale:Function, fail:Function, stop:Function, retry:Function, discard:Function, subscribe:Function, getSnapshot:Function}} IdentificationWorkflow
 * @typedef {{personId:string, templateId:string, templateVersion:number, similarity:number}} ClosestCandidate
 * @typedef {ClosestCandidate & {personSnapshot:{displayName:string, employeeCode:string}, thumbnailDataUrl:string|null, sampleLabel:string}} CandidatePresentation
 * @typedef {{version:'lighting-feedback-v1', meanBrightness:number, nearBlackFraction:number, nearWhiteFraction:number, leftRightDifference:number, warnings:string[]}} LightingFeedback
 *
 * Worker rankings include closestCandidate independently of accepted identity.
 * Workflow faces expose identification.closestCandidate with current local photo
 * and name resolution. Candidate presentation is transient and stripped from
 * decision samples/events. quality.lighting is optional advisory metadata and
 * never changes enrollment readiness or recognition gates. New scan events use
 * identify-85-multisample-v3; historical v1/v2 retain their original rules.
 * All eligible samples are equal; Person.enrollmentRevision guards sample mutations.
 * A person owns up to five templates; enrollmentRevision guards mutations.
 * Gallery.eligibleCount counts people; eligibleSampleCount counts templates.
 * Stability follows personId while evidence retains each supporting template.
 * EvaluationWorkflow captures fresh labeled probes; evaluation replay is pure.
 * Stored reports contain only 85% summaries; experimental tables are derived
 * from compatible saved probes and cannot modify Scan settings.
 * Confirmed scan faces expose tracked:true and confirmedAt (monotonic ms).
 * Their similarity is the saved confirmation score, not a new comparison.
 * Detection continues, but SFace skips confirmed uninterrupted tracks. Loss,
 * uncertain association, session disposal or invalid active enrollment clears
 * confirmation. Unrelated edits preserve unchanged supporting template fingerprints.
 * @typedef {{initialize:Function, observe:Function, dispose:Function, generation:number, manifest:object|null}} LivenessEngine
 * @typedef {{start:Function, process:Function, observePose:Function, saveSet:Function, discardSet:Function, nameDetectedFace:Function, stop:Function, enroll:Function, retry:Function, discard:Function, subscribe:Function, getSnapshot:Function}} LiveFaceWorkflow
 * @typedef {{start:Function, process:Function, observePose:Function, nameDetectedFace:Function, saveSet:Function, discardSet:Function, cancelFace:Function, retry:Function, discard:Function, stale:Function, fail:Function, stop:Function, subscribe:Function, getSnapshot:Function}} MultiEnrollmentWorkflow
 * @typedef {{start:Function, begin:Function, process:Function, observePose:Function, tick:Function, stale:Function, interrupt:Function, save:Function, retry:Function, discard:Function, stop:Function, subscribe:Function, getSnapshot:Function}} PhysicalEvaluationWorkflow
 * @typedef {{load:Function, query:Function, commit:Function, exportJson:Function, reset:Function, subscribe:Function}} PrototypeRepository
 * @typedef {{enroll:Function, verify:Function, retrySave:Function, deletePersonData:Function}} FaceWorkflow
 *
 * @typedef {{version:1, turnLeft:boolean, turnRight:boolean, blink:boolean}} EnrollmentLivenessSettings
 * @typedef {{timestamp:number, yaw:number|null, pitch:number|null, box:number[]|null, eyeBlinkLeft:number|null, eyeBlinkRight:number|null, jawOpen:number|null, mouthSmileLeft:number|null, mouthSmileRight:number|null, jawMotion:number|null, smileMotion:number|null}} PoseObservation
 * LivenessEngine.initialize accepts independent blink and meter capability flags
 * and numFaces (1–10). Meter blendshapes remain enabled independently of the
 * prompted Blink challenge setting.
 * observe returns faces:PoseObservation[] plus legacy first-face aliases. Pose
 * array order is not identity; exclusive IoU association binds observations to
 * track IDs and rejects ambiguous claims before challenge/capture processing.
 * LiveFaceWorkflow.start supports compatibility selected-person verification only;
 * purpose=enroll is rejected. All live enrollment uses automaticEnrollmentWorkflow
 * (MultiEnrollmentWorkflow). MultiEnrollmentWorkflow.start opens preview;
 * nameDetectedFace binds a fresh track after name/Enter or explicit Add/Replace,
 * snapshots challenge configuration and starts fresh session-bound meter evidence.
 * Draft names stay in memory until saveEnrollment/addSampleSet atomically saves
 * newPerson and captures.
 * Existing matches require an explicit sample add/replace. Discovery is transient
 * and uses the same >=0.85 per-person ranking/stability/uniqueness rules as Scan.
 * Track loss/ambiguity invalidates unsealed bound drafts; failed writes retain retry data.
 * Discovery maintains separate windows, candidates, scores and confirmations for
 * every track. analyzeFrame({analyzeAllFaces:true}) returns faceEmbeddings keyed
 * by current-frame detectionId; the worker rotates through at most two valid
 * crops per comparison. A single embedding must never represent several faces.
 * Confirmed discovery evidence stays latched until disappearance or gallery changes.
 * Simultaneous identity conflicts stay unconfirmed; earlier confirmed owners persist.
 * automaticEnrollmentWorkflow owns up to ten independent sessions, keyed by track
 * ID. Each face.enrollment exposes its own name, settings, challenge, status,
 * review and result; sessions also retains sealed reviews after disappearance.
 * nameDetectedFace binds only the supplied fresh track. Other visible people do
 * not block naming, passed steps, capture or an independent atomic save.
 * saveSet(labels, trackId), discardSet(trackId), cancelFace(trackId), retry(trackId)
 * and discard(trackId) target that session. Omitting retry/discard's trackId
 * targets the displayed last result, never another person's pending failure.
 * Global status stays tracking during per-face guided review; camera continues.
 * Track loss/ambiguity cancels only its unsealed capture. Stop invalidates active
 * evidence but preserves sealed reviews and failed saves for explicit retry/discard.
 * Guided review is sealed; addSampleSet atomically commits three
 * templates and attempts with expectedEnrollmentRevision and captureSetId.
 * Meter observations are exclusively associated to the source track and carry
 * timestamp, monotonic sequence, workerGeneration, fresh and exclusive flags,
 * yaw/pitch, eyeBlinkLeft/Right, jawOpen, mouthSmileLeft/Right, jawMotion and
 * smileMotion. createLivenessMeter is injected via services.meterFactory; the
 * deeply frozen services.meterPolicy identifies motion-evidence-v1. Meter state
 * and explicit challenge remain separate; face.meter exposes status, score,
 * progress, accepted, lastValidatedAt, paused, reason and live acceptedAt.
 * Optional face.meter.activity is transient {policyVersion:'live-movement-v1',
 * score:number, faceScore:number, headScore:number, lastMovementAt:number|null,
 * idle:boolean}. Face/blink and head contribute 0-50 each; score is their sum.
 * lastMovementAt uses the camera monotonic clock. Activity resets after 15000 ms
 * of inactivity; it does not alter the completed enrollment check or saved proof.
 * Clients may fall back to meter.score when activity is absent in older ports.
 * Accepted proof binds cameraSessionId, enrollmentSessionId, trackId, worker
 * generation, assetIdentity, threshold, observation span/count, score, progress,
 * partial phases and event summaries. Each persisted sample/attempt has its own
 * matching capture timestamp, pose timestamp, decision timestamp and exclusive
 * association evidence. Times are monotonic within the bound camera session only.
 * Scan meter data is transient and advisory; it does not decide identity.
 * PhysicalEvaluationWorkflow.start initializes models and snapshots conditions;
 * begin(cameraMetadata) starts the trial clock only after camera readiness.
 * process/observePose consume camera frames, tick seals timed review and
 * interrupt seals an interrupted review. save takes segmentId-keyed labels,
 * truth and optional attackSubtype; retry preserves the sealed write. Physical
 * trial segments hold aggregate observation/pass metrics and compact evidence,
 * never frames or landmarks. Physical trials do not create recognition records.
 * Schema 5 removes primary pointers. New automatic captures use
 * enrollment-per-face-meter-v3, recording actual scene count separately from
 * one target plus track/detection IDs, fresh pose/capture times and exclusive
 * association evidence. Historical enrollment-configurable-liveness-v1 retains
 * strict single-face rules. Historical all-disabled evidence stays not_checked;
 * new enrollment requires a passed meter and at least one enabled challenge.
 * New evaluation reports use evaluation-all-samples-v2; legacy reports retain
 * their original modes until explicitly rerun against compatible current data.
 * Comparative trials use evaluation-curated-counts-v3 / protocolVersion 1.
 * referencePlan freezes scope/model identity, ordered person/template bindings,
 * SHA-256 content fingerprints and exact nested 1/3/5 modes. It has no effect on
 * live galleries. Condition tags and independentCaptureConfirmed are explicit
 * operator evidence; unknownParticipantConfirmed is required for negatives.
 * Three observations are stored once and replayed against every subset at 0.85.
 * Comparative reports preserve per-observation ranking evidence and the exact
 * stable summary; selected-reference mutation makes a report historical.
 * Existing rerunEvaluations skips comparative trials rather than substituting
 * references. Comparison exports omit probe vectors; full DB export retains them.
 * Optional additive fields remain within schema 5 and existing storage limits.
 *
 * Components receive services by dependency injection. An STK host can provide
 * API-backed workflows without importing this project's shell or storage adapter.
 */
export {};

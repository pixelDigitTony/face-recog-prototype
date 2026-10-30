/**
 * @typedef {{environment:string, companyId:string, storeId:string|null}} FeatureContext
 * @typedef {{attemptId:string, outcome:string, persisted:boolean, authoritative:false, error?:string}} WorkflowResult
 * @typedef {{initialize:Function, extract:Function, analyzeFrame:Function, setGallery:Function, detectFrame:Function, extractFaces:Function, releaseFrame:Function, dispose:Function}} FaceEngine
 * @typedef {{start:Function, process:Function, stale:Function, stop:Function, retry:Function, discard:Function, subscribe:Function, getSnapshot:Function}} IdentificationWorkflow
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
 * Person.primaryTemplateId selects a baseline, not a live-match filter.
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
 * @typedef {{initialize:Function, observe:Function, dispose:Function}} LivenessEngine
 * @typedef {{start:Function, process:Function, stop:Function, enroll:Function, retry:Function, discard:Function, subscribe:Function, getSnapshot:Function}} LiveFaceWorkflow
 * @typedef {{load:Function, query:Function, commit:Function, exportJson:Function, reset:Function, subscribe:Function}} PrototypeRepository
 * @typedef {{enroll:Function, verify:Function, retrySave:Function, deletePersonData:Function}} FaceWorkflow
 *
 * Components receive services by dependency injection. An STK host can provide
 * API-backed workflows without importing this project's shell or storage adapter.
 */
export {};

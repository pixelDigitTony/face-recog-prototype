/**
 * @typedef {{environment:string, companyId:string, storeId:string|null}} FeatureContext
 * @typedef {{attemptId:string, outcome:string, persisted:boolean, authoritative:false, error?:string}} WorkflowResult
 * @typedef {{initialize:Function, extract:Function, analyzeFrame:Function, setGallery:Function, detectFrame:Function, extractFaces:Function, releaseFrame:Function, dispose:Function}} FaceEngine
 * @typedef {{start:Function, process:Function, stale:Function, stop:Function, retry:Function, discard:Function, subscribe:Function, getSnapshot:Function}} IdentificationWorkflow
 * @typedef {{personId:string, templateId:string, templateVersion:number, similarity:number}} ClosestCandidate
 * @typedef {ClosestCandidate & {personSnapshot:{displayName:string, employeeCode:string}, thumbnailDataUrl:string|null}} CandidatePresentation
 * @typedef {{version:'lighting-feedback-v1', meanBrightness:number, nearBlackFraction:number, nearWhiteFraction:number, leftRightDifference:number, warnings:string[]}} LightingFeedback
 *
 * Worker rankings include closestCandidate independently of accepted identity.
 * Workflow faces expose identification.closestCandidate with current local photo
 * and name resolution. Candidate presentation is transient and stripped from
 * decision samples/events. quality.lighting is optional advisory metadata and
 * never changes enrollment readiness or recognition gates. New scan events use
 * identify-85-inclusive-v2; historical identify-85-strict-v1 retains its operator.
 * @typedef {{initialize:Function, observe:Function, dispose:Function}} LivenessEngine
 * @typedef {{start:Function, process:Function, stop:Function, enroll:Function, retry:Function, discard:Function, subscribe:Function, getSnapshot:Function}} LiveFaceWorkflow
 * @typedef {{load:Function, query:Function, commit:Function, exportJson:Function, reset:Function, subscribe:Function}} PrototypeRepository
 * @typedef {{enroll:Function, verify:Function, retrySave:Function, deletePersonData:Function}} FaceWorkflow
 *
 * Components receive services by dependency injection. An STK host can provide
 * API-backed workflows without importing this project's shell or storage adapter.
 */
export {};

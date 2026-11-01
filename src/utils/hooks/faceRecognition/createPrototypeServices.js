import { createEvaluationWorkflow } from './workflows/evaluationWorkflow';
import { createLocalStorageRepository } from './repositories/localStorageRepository';
import { createBrowserFaceEngine } from './recognition/browserFaceEngine';
import { createFaceWorkflow } from './workflows/faceWorkflow';
import { createFaceLandmarkerAdapter } from './liveness/faceLandmarkerAdapter';
import { createLiveFaceWorkflow } from './workflows/liveFaceWorkflow';
import { createLiveIdentificationWorkflow } from './workflows/liveIdentificationWorkflow';
import { createMultiEnrollmentWorkflow } from './workflows/multiEnrollmentWorkflow';

export function createPrototypeServices({ context, baseUrl, repository, engine }) {
  repository ||= createLocalStorageRepository({ context });
  engine ||= createBrowserFaceEngine(baseUrl);
  const workflow = createFaceWorkflow({ context, repository, engine });
  const liveness = createFaceLandmarkerAdapter(baseUrl);
  const liveWorkflow = createLiveFaceWorkflow({ context, repository, engine, liveness, workflow });
  const identificationWorkflow = createLiveIdentificationWorkflow({ context, repository, engine });
  const automaticEnrollmentWorkflow = createMultiEnrollmentWorkflow({
    context,
    repository,
    engine,
    liveness,
    workflow,
  });
  return {
    context,
    repository,
    engine,
    workflow,
    liveness,
    liveWorkflow,
    automaticEnrollmentWorkflow,
    identificationWorkflow,
    evaluationWorkflow: createEvaluationWorkflow({ context, repository, engine }),
    dispose() {
      engine.dispose();
      liveWorkflow.stop();
      automaticEnrollmentWorkflow.stop();
      identificationWorkflow.stop();
      liveness.dispose();
      repository.dispose();
    },
  };
}

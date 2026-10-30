import { createLocalStorageRepository } from './repositories/localStorageRepository';
import { createBrowserFaceEngine } from './recognition/browserFaceEngine';
import { createFaceWorkflow } from './workflows/faceWorkflow';
import { createFaceLandmarkerAdapter } from './liveness/faceLandmarkerAdapter';
import { createLiveFaceWorkflow } from './workflows/liveFaceWorkflow';
import { createLiveIdentificationWorkflow } from './workflows/liveIdentificationWorkflow';

export function createPrototypeServices({ context, baseUrl, repository, engine }) {
  repository ||= createLocalStorageRepository({ context });
  engine ||= createBrowserFaceEngine(baseUrl);
  const workflow = createFaceWorkflow({ context, repository, engine });
  const liveness = createFaceLandmarkerAdapter(baseUrl);
  const liveWorkflow = createLiveFaceWorkflow({ context, repository, engine, liveness, workflow });
  const identificationWorkflow = createLiveIdentificationWorkflow({ context, repository, engine });
  return {
    context,
    repository,
    engine,
    workflow,
    liveness,
    liveWorkflow,
    identificationWorkflow,
    dispose() {
      engine.dispose();
      liveWorkflow.stop();
      identificationWorkflow.stop();
      liveness.dispose();
      repository.dispose();
    },
  };
}

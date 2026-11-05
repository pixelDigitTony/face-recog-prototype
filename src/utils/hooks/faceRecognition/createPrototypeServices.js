import { createLivenessMeter } from './liveness/livenessMeter';
import { LIVENESS_METER_POLICY } from './liveness/livenessMeterPolicy';
import { createEvaluationWorkflow } from './workflows/evaluationWorkflow';
import { createPhysicalEvaluationWorkflow } from './workflows/physicalEvaluationWorkflow';
import { createLocalStorageRepository } from './repositories/localStorageRepository';
import { createBrowserFaceEngine } from './recognition/browserFaceEngine';
import { createFaceWorkflow } from './workflows/faceWorkflow';
import { createFaceLandmarkerAdapter } from './liveness/faceLandmarkerAdapter';
import { createLiveFaceWorkflow } from './workflows/liveFaceWorkflow';
import { createLiveIdentificationWorkflow } from './workflows/liveIdentificationWorkflow';
import { createMultiEnrollmentWorkflow } from './workflows/multiEnrollmentWorkflow';

export function createPrototypeServices({
  context,
  baseUrl,
  repository,
  engine,
  meterFactory = createLivenessMeter,
}) {
  repository ||= createLocalStorageRepository({ context });
  engine ||= createBrowserFaceEngine(baseUrl);
  const workflow = createFaceWorkflow({ context, repository, engine });
  const liveness = createFaceLandmarkerAdapter(baseUrl);
  const liveWorkflow = createLiveFaceWorkflow({ context, repository, engine, liveness, workflow });
  const identificationWorkflow = createLiveIdentificationWorkflow({
    context,
    repository,
    engine,
    liveness,
    meterFactory,
  });
  const automaticEnrollmentWorkflow = createMultiEnrollmentWorkflow({
    context,
    repository,
    engine,
    liveness,
    meterFactory,
    workflow,
  });
  const physicalEvaluationWorkflow = createPhysicalEvaluationWorkflow({
    context,
    repository,
    engine,
    liveness,
    meterFactory,
  });
  return {
    context,
    repository,
    engine,
    meterFactory,
    meterPolicy: LIVENESS_METER_POLICY,
    workflow,
    liveness,
    liveWorkflow,
    automaticEnrollmentWorkflow,
    identificationWorkflow,
    physicalEvaluationWorkflow,
    evaluationWorkflow: createEvaluationWorkflow({ context, repository, engine }),
    dispose() {
      engine.dispose();
      liveWorkflow.stop();
      automaticEnrollmentWorkflow.stop();
      identificationWorkflow.stop();
      physicalEvaluationWorkflow.stop();
      liveness.dispose();
      repository.dispose();
    },
  };
}

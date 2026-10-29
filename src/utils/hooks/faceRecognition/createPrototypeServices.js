import { createLocalStorageRepository } from './repositories/localStorageRepository';
import { createBrowserFaceEngine } from './recognition/browserFaceEngine';
import { createFaceWorkflow } from './workflows/faceWorkflow';

export function createPrototypeServices({ context, baseUrl, repository, engine }) {
  repository ||= createLocalStorageRepository({ context });
  engine ||= createBrowserFaceEngine(baseUrl);
  const workflow = createFaceWorkflow({ context, repository, engine });
  return {
    context,
    repository,
    engine,
    workflow,
    dispose() {
      engine.dispose();
      repository.dispose();
    },
  };
}

import { createDatabase } from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { createLocalStorageRepository } from '@/utils/hooks/faceRecognition/repositories/localStorageRepository';
import { createFaceWorkflow } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';
import { createMultiEnrollmentWorkflow } from '@/utils/hooks/faceRecognition/workflows/multiEnrollmentWorkflow';
export const context = { environment: 'test', companyId: 'company', storeId: null };
export const manifest = {
  detector: { sha256: 'd' },
  recognizer: { sha256: 'r' },
  preprocessingVersion: 'v1',
  embeddingDimension: 128,
};
export const vector = (n) => Array.from({ length: 128 }, (_, i) => (i === n ? 1 : 0));
export const fixtureFaces = [
  { box: [10, 10, 120, 140], confidence: 0.99, reasonCode: null },
  { box: [300, 10, 120, 140], confidence: 0.99, reasonCode: null },
];
export async function harness(
  configuration = { version: 1, turnLeft: false, turnRight: false, blink: true },
) {
  const db = createDatabase(context);
  db.settings.saveThumbnails = false;
  db.settings.enrollmentLiveness = configuration;
  let raw = JSON.stringify(db),
    clock = 0,
    faces = fixtureFaces,
    quota = false,
    embeddings = [vector(0), vector(1)];
  const yaw = [0, 0],
    eye = [0, 0];
  const repository = createLocalStorageRepository({
    context,
    storage: {
      getItem: () => raw,
      setItem: (_key, value) => {
        if (quota) throw new Error('quota');
        raw = value;
      },
    },
    locks: { request: (_n, _o, callback) => callback({}) },
    events: null,
  });
  await repository.load();
  const engine = {
    manifest,
    initialize: async () => manifest,
    analyzeFrame: async (_frame, { includeEmbedding }) => ({
      faces,
      faceEmbeddings: includeEmbedding
        ? faces.map((face, i) => ({
            detectionId: i,
            embedding: embeddings[face.box[0] < 200 ? 0 : 1],
          }))
        : [],
      quality: {},
      modelIdentity: manifest,
      preprocessingVersion: 'v1',
    }),
  };
  const liveness = {
    manifest: { sha256: 'pose-model' },
    initialize: async () => {},
    observe: async (_frame, timestamp) => ({
      faces: faces
        .map((face) => {
          const i = face.box[0] < 200 ? 0 : 1;
          return {
            box: face.box,
            yaw: yaw[i],
            pitch: 0,
            eyeBlinkLeft: eye[i],
            eyeBlinkRight: eye[i],
            jawOpen: 0.05,
            mouthSmileLeft: 0.05,
            mouthSmileRight: 0.05,
            jawMotion: 0.1,
            smileMotion: 0.8,
            timestamp,
          };
        })
        .reverse(),
    }),
  };
  const workflow = createFaceWorkflow({ repository, engine, context });
  const flow = createMultiEnrollmentWorkflow({
    repository,
    engine,
    liveness,
    workflow,
    context,
    now: () => clock,
  });
  async function step(dt = 50) {
    clock += dt;
    await flow.observePose({ width: 640, height: 480 }, clock);
    await flow.process({ width: 640, height: 480 }, clock);
  }
  async function wait(ms) {
    for (let t = 0; t < ms; t += 50) await step();
  }
  await flow.start();
  for (let i = 0; i < 20; i++) await step();
  return {
    repository,
    flow,
    liveness,
    step,
    wait,
    yaw,
    eye,
    faces: (v) => {
      faces = v;
    },
    quota: (v) => {
      quota = v;
    },
    raw: () => raw,
    setEmbedding: (index, value) => {
      embeddings[index] = value;
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}
export async function bind(h, trackId, name, guided = false) {
  await h.flow.nameDetectedFace({ trackId, name, acknowledged: true, guided });
}
export async function perform(h, ids) {
  await h.wait(1450);
  ids.forEach((i) => {
    h.yaw[i - 1] = 8;
  });
  await h.wait(500);
  ids.forEach((i) => {
    h.yaw[i - 1] = 0;
  });
  await h.wait(500);
  ids.forEach((i) => {
    h.eye[i - 1] = 1;
  });
  await h.wait(150);
  ids.forEach((i) => {
    h.eye[i - 1] = 0;
  });
  await h.wait(1000);
}

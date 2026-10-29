import { handleWorkerRequest } from '@/utils/hooks/faceRecognition/recognition/workerHandler';
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        self.postMessage({
          requestId: data.requestId,
          ok: true,
          result: await handleWorkerRequest(data),
        });
      } catch (error) {
        self.postMessage({
          requestId: data.requestId,
          ok: false,
          errorCode: data.type === 'initialize' ? 'MODEL_ERROR' : 'INFERENCE_ERROR',
          message: error.message || String(error),
        });
      }
    });
};

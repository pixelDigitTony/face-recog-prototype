export function createBrowserFaceEngine(baseUrl) {
  let worker, initializing, manifest;
  const pending = new Map();
  function call(type, payload, signal) {
    if (signal?.aborted)
      return Promise.reject(new DOMException('Capture cancelled.', 'AbortError'));
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const finish = (callback, value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        pending.delete(requestId);
        callback(value);
      };
      const abort = () => finish(reject, new DOMException('Capture cancelled.', 'AbortError'));
      const timer = setTimeout(
        () =>
          finish(
            reject,
            Object.assign(new Error('Model operation timed out. Reload models and try again.'), {
              code: type === 'initialize' ? 'MODEL_ERROR' : 'INFERENCE_ERROR',
            }),
          ),
        type === 'initialize' ? 120000 : 5000,
      );
      pending.set(requestId, {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      });
      signal?.addEventListener('abort', abort, { once: true });
      worker.postMessage({ requestId, type, payload });
    });
  }
  return {
    get manifest() {
      return manifest;
    },
    initialize() {
      return (initializing ||= (async () => {
        const instance = new Worker(
          new URL('../../../../workers/faceRecognition.worker.js', import.meta.url),
          { type: 'module' },
        );
        worker = instance;
        worker.onmessage = ({ data }) => {
          const task = pending.get(data.requestId);
          if (data.ok) task?.resolve(data.result);
          else task?.reject(Object.assign(new Error(data.message), { code: data.errorCode }));
        };
        worker.onerror = (event) => {
          for (const task of [...pending.values()])
            task.reject(
              Object.assign(new Error(event.message || 'Recognition worker failed.'), {
                code: 'MODEL_ERROR',
              }),
            );
        };
        try {
          const loaded = await call('initialize', { baseUrl });
          if (worker !== instance) throw new DOMException('Recognition cancelled.', 'AbortError');
          manifest = loaded;
          return manifest;
        } catch (error) {
          instance.terminate();
          if (worker === instance) {
            worker = null;
            initializing = null;
          }
          throw error;
        }
      })());
    },
    async extract(frame, options = {}) {
      await this.initialize();
      return call('extract', { frame, saveThumbnails: options.saveThumbnails }, options.signal);
    },
    async analyzeFrame(frame, options = {}) {
      await this.initialize();
      return call('analyzeFrame', {
        frame,
        includeEmbedding: options.includeEmbedding,
        saveThumbnails: false,
      });
    },
    async setGallery(gallery) {
      await this.initialize();
      return call('setGallery', gallery);
    },
    async detectFrame(frame, frameId) {
      await this.initialize();
      return call('detectFrame', { frame, frameId });
    },
    async extractFaces(frameId, detectionIds, galleryVersion) {
      return call('extractFaces', { frameId, detectionIds, galleryVersion });
    },
    async releaseFrame(frameId) {
      if (worker) return call('releaseFrame', { frameId });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      initializing = null;
      for (const task of [...pending.values()])
        task.reject(new DOMException('Recognition disposed.', 'AbortError'));
      manifest = null;
    },
  };
}

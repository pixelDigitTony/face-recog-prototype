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
        120000,
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
        worker = new Worker(
          new URL('../../../../workers/faceRecognition.worker.js', import.meta.url),
          { type: 'module' },
        );
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
          manifest = await call('initialize', { baseUrl });
          return manifest;
        } catch (error) {
          worker.terminate();
          worker = null;
          initializing = null;
          throw error;
        }
      })());
    },
    async extract(frame, options = {}) {
      await this.initialize();
      return call('extract', { frame, saveThumbnails: options.saveThumbnails }, options.signal);
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

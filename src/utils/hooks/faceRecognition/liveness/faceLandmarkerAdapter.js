export function createFaceLandmarkerAdapter(baseUrl) {
  let worker, initializing, manifest;
  const pending = new Map();
  function call(type, payload) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.get(id)?.reject(new Error('Liveness timed out. Start again.'));
        dispose();
      }, 60000);
      const finish = (fn, value) => {
        clearTimeout(timer);
        pending.delete(id);
        fn(value);
      };
      pending.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      });
      worker.postMessage({ id, type, payload });
    });
  }
  function dispose() {
    worker?.terminate();
    worker = null;
    initializing = null;
    manifest = null;
    for (const task of [...pending.values()])
      task.reject(new DOMException('Liveness stopped.', 'AbortError'));
  }
  return {
    get manifest() {
      return manifest;
    },
    initialize() {
      return (initializing ||= (async () => {
        worker = new Worker(new URL('../../../../workers/liveness.worker.js', import.meta.url));
        worker.onmessage = ({ data }) => {
          const task = pending.get(data.id);
          if (data.ok) task?.resolve(data.result);
          else task?.reject(new Error(data.error));
        };
        worker.onerror = (event) => {
          for (const task of [...pending.values()])
            task.reject(new Error(event.message || 'Liveness worker failed.'));
        };
        try {
          manifest = await call('initialize', { baseUrl });
          return manifest;
        } catch (error) {
          dispose();
          throw error;
        }
      })());
    },
    async observe(frame, timestamp) {
      await this.initialize();
      return call('observe', { frame, timestamp });
    },
    dispose,
  };
}

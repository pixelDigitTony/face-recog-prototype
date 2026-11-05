export function createFaceLandmarkerAdapter(baseUrl) {
  let worker,
    initializing,
    manifest,
    blink = false,
    meter = false,
    numFaces = 1,
    epoch = 0,
    lifetime = 0;
  let configurationQueue = Promise.resolve();
  const pending = new Map();
  function call(type, payload) {
    let finishDone;
    const done = new Promise((resolve) => {
      finishDone = resolve;
    });
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.get(id)?.reject(new Error('Liveness timed out. Start again.'));
        dispose();
      }, 60000);
      const finish = (fn, value) => {
        clearTimeout(timer);
        pending.delete(id);
        finishDone();
        fn(value);
      };
      pending.set(id, {
        done,
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      });
      worker.postMessage({ id, type, payload });
    });
  }
  function terminate() {
    worker?.terminate();
    worker = null;
    initializing = null;
    manifest = null;
    for (const task of [...pending.values()])
      task.reject(new DOMException('Liveness stopped.', 'AbortError'));
  }
  function dispose() {
    lifetime++;
    epoch++;
    terminate();
  }
  async function ensure() {
    if (!initializing) {
      const token = epoch;
      initializing = (async () => {
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
          const result = await call('initialize', { baseUrl, blink, meter, numFaces });
          if (token !== epoch) throw new DOMException('Liveness stopped.', 'AbortError');
          manifest = result;
          return manifest;
        } catch (error) {
          if (token === epoch) dispose();
          throw error;
        }
      })();
    }
    return initializing;
  }
  return {
    get manifest() {
      return manifest;
    },
    get generation() {
      return epoch;
    },
    initialize(options) {
      if (!options) {
        const token = lifetime;
        return configurationQueue.then(() => {
          if (token !== lifetime) throw new DOMException('Liveness stopped.', 'AbortError');
          return ensure();
        });
      }
      const requestedFaces = options.numFaces ?? numFaces;
      if (!Number.isInteger(requestedFaces) || requestedFaces < 1 || requestedFaces > 10)
        throw new Error('Liveness supports one to ten faces.');
      const token = lifetime;
      const operation = configurationQueue.then(async () => {
        if (token !== lifetime) throw new DOMException('Liveness stopped.', 'AbortError');
        if (
          Boolean(options.blink) !== blink ||
          Boolean(options.meter) !== meter ||
          requestedFaces !== numFaces
        ) {
          await Promise.all([...pending.values()].map((task) => task.done));
          if (token !== lifetime) throw new DOMException('Liveness stopped.', 'AbortError');
          terminate();
          epoch++;
          blink = Boolean(options.blink);
          meter = Boolean(options.meter);
          numFaces = requestedFaces;
        }
        return ensure();
      });
      configurationQueue = operation.catch(() => {});
      return operation;
    },
    observe(frame, timestamp) {
      const token = lifetime;
      const operation = configurationQueue.then(async () => {
        if (token !== lifetime) throw new DOMException('Liveness stopped.', 'AbortError');
        await ensure();
        if (token !== lifetime || !worker)
          throw new DOMException('Liveness stopped.', 'AbortError');
        return call('observe', { frame, timestamp });
      });
      configurationQueue = operation.catch(() => {});
      return operation;
    },
    dispose,
  };
}

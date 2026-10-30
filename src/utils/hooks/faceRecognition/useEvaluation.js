import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFaceServices } from './useLocalDatabase';
import { useCamera } from './useCamera';
import { createFrameScheduler } from './recognition/frameScheduler';

export function useEvaluation() {
  const { evaluationWorkflow: flow, engine } = useFaceServices(),
    camera = useCamera();
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const scheduler = useRef(),
    cameraRef = useRef(camera),
    generation = useRef(0);
  cameraRef.current = camera;
  const [error, setError] = useState(null);
  function closeCamera() {
    scheduler.current?.stop();
    scheduler.current = null;
    cameraRef.current.stop();
  }
  async function cancel(reason) {
    generation.current++;
    closeCamera();
    await flow.cancel(reason);
  }
  async function start(options) {
    const token = ++generation.current;
    setError(null);
    try {
      await flow.start(options);
      if (token !== generation.current) return;
      await cameraRef.current.start();
      if (token !== generation.current) {
        closeCamera();
        return;
      }
      if (!cameraRef.current.videoRef.current?.srcObject?.active)
        throw new Error('Camera is unavailable.');
      scheduler.current = createFrameScheduler(
        cameraRef.current.videoRef.current,
        async () => {
          const timestamp = performance.now();
          await flow.process(await cameraRef.current.capture(), timestamp);
        },
        (e) => {
          setError(e.message);
          cancel(e.message);
        },
      );
      scheduler.current.start();
    } catch (e) {
      if (token === generation.current) {
        setError(e.message);
        await cancel(e.message);
      }
    }
  }
  useEffect(() => {
    if (['completed', 'save_failed'].includes(state.status)) closeCamera();
  }, [state.status]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) cancel('Page hidden');
    };
    document.addEventListener('visibilitychange', hide);
    const timer = setInterval(() => {
      flow.stale()?.catch((e) => setError(e.message));
    }, 200);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
      generation.current++;
      closeCamera();
      flow.stop();
      engine.dispose();
    };
  }, [flow, engine]);
  useEffect(() => {
    if (camera.error && state.status === 'capturing') cancel(camera.error);
  }, [camera.error, state.status]);
  return {
    ...state,
    camera,
    error: error || state.error || camera.error,
    start,
    cancel,
    retry: flow.retry,
    discard: flow.discard,
  };
}

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFaceServices } from './useLocalDatabase';
import { useCamera } from './useCamera';
import { createFrameScheduler } from './recognition/frameScheduler';

export function useLiveFaceIdentification() {
  const { identificationWorkflow: workflow } = useFaceServices();
  const camera = useCamera(),
    cameraRef = useRef(camera),
    scheduler = useRef(),
    generation = useRef(0);
  cameraRef.current = camera;
  const state = useSyncExternalStore(
    workflow.subscribe,
    workflow.getSnapshot,
    workflow.getSnapshot,
  );
  const [starting, setStarting] = useState(false);
  function stop() {
    generation.current++;
    scheduler.current?.stop();
    scheduler.current = null;
    cameraRef.current.stop();
    workflow.stop();
    setStarting(false);
  }
  async function start() {
    if (starting) return;
    const token = ++generation.current;
    setStarting(true);
    try {
      await workflow.start();
      if (token !== generation.current) return;
      await cameraRef.current.start();
      if (token !== generation.current) {
        cameraRef.current.stop();
        return;
      }
      if (!cameraRef.current.videoRef.current?.srcObject?.active)
        throw new Error('Camera is unavailable. Allow access and start again.');
      scheduler.current = createFrameScheduler(
        cameraRef.current.videoRef.current,
        async () => {
          const timestamp = performance.now();
          await workflow.process(await cameraRef.current.capture(), timestamp);
        },
        (error) => {
          stop();
          workflow.fail(error);
        },
      );
      scheduler.current.start();
    } catch (error) {
      if (token === generation.current) {
        stop();
        workflow.fail(error);
      }
    } finally {
      if (token === generation.current) setStarting(false);
    }
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hide);
    const timer = setInterval(() => workflow.stale(), 200);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
      stop();
    };
    // Services are stable for this module's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow]);
  useEffect(() => {
    if (camera.error) {
      scheduler.current?.stop();
      scheduler.current = null;
      cameraRef.current.stop();
      workflow.fail(new Error(camera.error));
    }
  }, [camera.error, workflow]);
  useEffect(() => {
    if (state.status === 'error') {
      scheduler.current?.stop();
      scheduler.current = null;
      cameraRef.current.stop();
      setStarting(false);
    }
  }, [state.status]);
  return {
    ...state,
    camera,
    starting,
    start,
    stop,
    retry: () => workflow.retry(),
    discard: () => workflow.discard(),
  };
}

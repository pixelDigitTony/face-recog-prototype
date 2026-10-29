import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFaceServices } from './useLocalDatabase';
import { useCamera } from './useCamera';
import { createFrameScheduler } from './recognition/frameScheduler';
export function useLiveFaceTracking(personId, purpose) {
  const { liveWorkflow: live, engine, liveness } = useFaceServices(),
    camera = useCamera();
  const state = useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
  const [starting, setStarting] = useState(false);
  const scheduler = useRef(null),
    generation = useRef(0),
    cameraRef = useRef(camera);
  cameraRef.current = camera;
  function stop() {
    generation.current++;
    scheduler.current?.stop();
    scheduler.current = null;
    live.stop();
    cameraRef.current.stop();
    engine.dispose();
    liveness.dispose();
    setStarting(false);
  }
  async function start() {
    if (starting) return;
    const token = ++generation.current;
    setStarting(true);
    try {
      await scheduler.current?.stop();
      if (token !== generation.current) return;
      await live.start({ personId, purpose });
      if (token !== generation.current) return;
      if (!cameraRef.current.active) await cameraRef.current.start();
      if (token !== generation.current) {
        cameraRef.current.stop();
        return;
      }
      if (!cameraRef.current.videoRef.current?.srcObject?.active)
        throw new Error('Camera is not available. Allow camera access and try again.');
      scheduler.current?.stop();
      scheduler.current = createFrameScheduler(
        cameraRef.current.videoRef.current,
        async () => {
          // The video callback's timestamp can predate this capture under load.
          const timestamp = performance.now();
          const frame = await cameraRef.current.capture();
          await live.process(frame, timestamp);
        },
        (error) => {
          stop();
          live.fail(error);
        },
      );
      scheduler.current.start();
    } catch (error) {
      if (token === generation.current) {
        stop();
        live.fail(error);
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
    const timer = setInterval(() => live.stale(), 200);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
      stop();
    };
    // A new selected identity invalidates the camera session and all evidence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, purpose, live]);
  useEffect(() => {
    if (camera.error) {
      scheduler.current?.stop();
      live.fail(new Error(camera.error));
    }
  }, [camera.error, live]);
  return {
    ...state,
    camera,
    starting,
    start,
    stop,
    enroll: () => live.enroll(),
    retry: async () => {
      try {
        await live.retry();
      } catch (error) {
        live.fail(error);
      }
    },
    discard: () => live.discard(),
    busy: state.status === 'saving',
  };
}

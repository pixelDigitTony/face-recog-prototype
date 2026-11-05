import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFaceServices } from './useLocalDatabase';
import { useCamera } from './useCamera';
import { createFrameScheduler } from './recognition/frameScheduler';
export function useLiveFaceTracking(
  personId,
  purpose,
  replaceTemplateId = null,
  sampleLabel = '',
  guided = false,
  automaticEnrollment = false,
) {
  const services = useFaceServices(),
    { engine, liveness } = services,
    live = automaticEnrollment
      ? (services.automaticEnrollmentWorkflow ?? services.liveWorkflow)
      : services.liveWorkflow,
    camera = useCamera();
  const state = useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
  const [starting, setStarting] = useState(false);
  const poseScheduler = useRef(null);
  const scheduler = useRef(null),
    generation = useRef(0),
    cameraRef = useRef(camera);
  cameraRef.current = camera;
  function stop() {
    generation.current++;
    poseScheduler.current?.stop();
    poseScheduler.current = null;
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
      await poseScheduler.current?.stop();
      await scheduler.current?.stop();
      if (token !== generation.current) return;
      await live.start({
        personId,
        purpose,
        replaceTemplateId,
        sampleLabel,
        guided,
        independentPose: true,
        automaticEnrollment,
      });
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
      poseScheduler.current?.stop();
      poseScheduler.current = createFrameScheduler(
        cameraRef.current.videoRef.current,
        async () => {
          if (
            (automaticEnrollment
              ? !live.getSnapshot().needsIndependentPose
              : !live.getSnapshot().liveness.configuration?.blink) ||
            ['completed', 'review', 'save_failed'].includes(live.getSnapshot().status)
          )
            return;
          const timestamp = performance.now();
          const frame = await cameraRef.current.capture();
          await live.observePose(frame, timestamp);
        },
        (error) => {
          stop();
          live.fail(error);
        },
        50,
      );
      poseScheduler.current.start();
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
    if (state.status === 'review') {
      scheduler.current?.stop();
      poseScheduler.current?.stop();
      cameraRef.current.stop();
    }
  }, [state.status]);
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
  }, [personId, purpose, replaceTemplateId, guided, automaticEnrollment, live]);
  useEffect(() => {
    if (camera.error) {
      stop();
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
    nameDetectedFace: (options) => live.nameDetectedFace(options),
    cancelFace: (trackId) => live.cancelFace?.(trackId),
    saveSet: (labels, trackId) => live.saveSet(labels, trackId),
    discardSet: (trackId) => live.discardSet(trackId),
    retry: async (trackId) => {
      try {
        await live.retry(typeof trackId === 'number' ? trackId : undefined);
      } catch (error) {
        live.fail(error);
      }
    },
    discard: (trackId) => live.discard(typeof trackId === 'number' ? trackId : undefined),
    busy: state.status === 'saving',
  };
}

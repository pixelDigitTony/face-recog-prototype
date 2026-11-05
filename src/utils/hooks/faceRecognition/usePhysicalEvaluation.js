import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFaceServices } from './useLocalDatabase';
import { useCamera } from './useCamera';
import { createFrameScheduler } from './recognition/frameScheduler';

export function usePhysicalEvaluation() {
  const { physicalEvaluationWorkflow: flow } = useFaceServices();
  const camera = useCamera();
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const cameraRef = useRef(camera),
    generation = useRef(0),
    detection = useRef(),
    pose = useRef();
  const [error, setError] = useState(null);
  cameraRef.current = camera;
  function closeCamera() {
    detection.current?.stop();
    pose.current?.stop();
    detection.current = null;
    pose.current = null;
    cameraRef.current.stop();
  }
  function interrupt(reason) {
    generation.current++;
    closeCamera();
    flow.interrupt(reason);
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
      const video = cameraRef.current.videoRef.current;
      if (!video?.srcObject?.active || !video.videoWidth) throw new Error('Camera is unavailable.');
      const track = video.srcObject.getVideoTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      flow.begin({
        width: video.videoWidth,
        height: video.videoHeight,
        frameRate: settings.frameRate ?? null,
        facingMode: settings.facingMode ?? null,
        deviceLabel: (track?.label || '').slice(0, 300) || null,
        userAgent: navigator.userAgent.slice(0, 300),
      });
      const fail = (e) => {
        setError(e.message);
        interrupt(e.message);
      };
      detection.current = createFrameScheduler(
        video,
        async () => {
          const timestamp = performance.now();
          await flow.process(await cameraRef.current.capture(), timestamp);
        },
        fail,
      );
      pose.current = createFrameScheduler(
        video,
        async () => {
          const timestamp = performance.now();
          await flow.observePose(await cameraRef.current.capture(), timestamp);
        },
        fail,
        50,
      );
      detection.current.start();
      pose.current.start();
    } catch (e) {
      if (token === generation.current) {
        setError(e.message);
        interrupt(e.message);
      }
    }
  }
  useEffect(() => {
    if (['review', 'saving', 'save_failed', 'saved'].includes(state.status)) closeCamera();
  }, [state.status]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && ['loading', 'ready', 'running'].includes(flow.getSnapshot().status))
        interrupt('Page hidden');
    };
    document.addEventListener('visibilitychange', hide);
    const timer = setInterval(() => {
      if (flow.getSnapshot().status === 'running') flow.tick(performance.now());
    }, 200);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
      generation.current++;
      closeCamera();
      if (['loading', 'ready', 'running'].includes(flow.getSnapshot().status))
        flow.interrupt('Navigation');
      flow.stop();
    };
  }, [flow]);
  useEffect(() => {
    if (camera.error && ['ready', 'running'].includes(state.status)) {
      setError(camera.error);
      interrupt(camera.error);
    }
  }, [camera.error, state.status]);
  return {
    ...state,
    camera,
    error: error || state.error || camera.error,
    start,
    interrupt,
    save: flow.save,
    retry: flow.retry,
    discard: flow.discard,
  };
}

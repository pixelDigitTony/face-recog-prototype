import { useEffect, useRef, useState } from 'react';

const preferredVideo = {
  facingMode: { ideal: 'user' },
  width: { ideal: 640 },
  height: { ideal: 480 },
};

function deviceMissing(error) {
  return error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError';
}

function cameraMessage(error) {
  if (error?.name === 'NotAllowedError')
    return 'Camera permission was denied. Allow it in your browser and retry.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError')
    return 'Chrome can see the camera, but another app is using it. Close that app and retry.';
  if (deviceMissing(error))
    return 'Chrome lists a camera, but it could not be opened. Reconnect it and retry.';
  return error?.message || 'The camera could not be started.';
}

// A bare facingMode value is an exact constraint. Desktop webcams such as the
// Rapoo camera are listed in Chrome settings but do not advertise "user", so
// that request fails even after permission is granted.
export async function openCameraStream(mediaDevices) {
  if (!mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost.');
  try {
    return await mediaDevices.getUserMedia({ audio: false, video: preferredVideo });
  } catch (error) {
    if (!deviceMissing(error)) throw error;
    const devices = await mediaDevices.enumerateDevices().catch(() => []);
    const cameras = devices.filter((device) => device.kind === 'videoinput' && device.deviceId);
    let last = error;
    for (const camera of cameras) {
      for (const video of [
        { deviceId: { exact: camera.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
        { deviceId: { exact: camera.deviceId } },
      ]) {
        try {
          return await mediaDevices.getUserMedia({ audio: false, video });
        } catch (next) {
          last = next;
          if (next?.name === 'NotAllowedError' || next?.name === 'SecurityError') throw next;
        }
      }
    }
    try {
      return await mediaDevices.getUserMedia({ audio: false, video: true });
    } catch (next) {
      throw deviceMissing(next) ? last : next;
    }
  }
}

export function useCamera() {
  const videoRef = useRef(null),
    streamRef = useRef(null),
    mounted = useRef(true),
    generation = useRef(0);
  const [active, setActive] = useState(false),
    [error, setError] = useState(null),
    [starting, setStarting] = useState(false);
  const stop = () => {
    generation.current++;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setStarting(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  async function start() {
    const token = ++generation.current;
    setStarting(true);
    setError(null);
    try {
      const stream = await openCameraStream(navigator.mediaDevices);
      if (!mounted.current || token !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview is not on the page yet.');
      streamRef.current = stream;
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      if (token !== generation.current || !mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (mounted.current && token === generation.current) {
          setActive(false);
          setError('Camera disconnected. Start it again.');
        }
      });
      setActive(true);
    } catch (error) {
      if (token !== generation.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (mounted.current && token === generation.current) {
        setActive(false);
        setError(cameraMessage(error));
      }
    } finally {
      if (mounted.current && token === generation.current) setStarting(false);
    }
  }
  async function capture() {
    const video = videoRef.current;
    if (!streamRef.current?.active || !video?.videoWidth)
      throw new Error('Camera is not ready. Start it and retry.');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: frame.data, width: frame.width, height: frame.height };
  }
  return { videoRef, active, error, starting, start, stop, capture };
}

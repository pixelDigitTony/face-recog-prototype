import { useEffect, useRef, useState } from 'react';

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
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera access requires HTTPS or localhost.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (!mounted.current || token !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
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
        setError(
          `${error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser and retry.' : error.message}`,
        );
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

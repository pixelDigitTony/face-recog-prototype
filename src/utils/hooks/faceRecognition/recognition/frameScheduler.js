// Schedule only after the previous pipeline finishes: no queued video frames.
export function createFrameScheduler(video, analyze, onError) {
  let running = false,
    callbackId,
    timer,
    lastMedia = -1,
    lastStart = -Infinity,
    inFlight;
  const schedule = () => {
    if (!running) return;
    if (video.requestVideoFrameCallback) callbackId = video.requestVideoFrameCallback(tick);
    else callbackId = requestAnimationFrame(tick);
  };
  async function tick(now) {
    if (!running) return;
    if (now - lastStart < 125 || video.currentTime === lastMedia || video.readyState < 2) {
      schedule();
      return;
    }
    lastStart = now;
    lastMedia = video.currentTime;
    try {
      inFlight = Promise.resolve().then(() => analyze(now));
      await inFlight;
    } catch (error) {
      if (running) onError(error);
    }
    if (running) timer = setTimeout(schedule, Math.max(0, 125 - (performance.now() - now)));
  }
  return {
    start() {
      if (!running) {
        running = true;
        schedule();
      }
    },
    stop() {
      running = false;
      clearTimeout(timer);
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callbackId);
      else cancelAnimationFrame(callbackId);
      return inFlight;
    },
  };
}

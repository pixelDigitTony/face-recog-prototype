import { LIVE_TIMING } from '../recognition/liveTiming';

export function createActiveChallenge({
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2,
} = {}) {
  let state, lastTime, lastYaw, baselineStart, baselineYaw, holdStart, holds;
  function reset() {
    state = {
      status: 'not_checked',
      prompt: 'Look straight ahead',
      steps: [],
      step: 0,
      challengeId: null,
      validity: 'continuous_session',
      expiresAt: null,
      lastValidatedAt: null,
      paused: false,
    };
    lastTime = lastYaw = baselineStart = baselineYaw = holdStart = null;
    holds = 0;
  }
  function pause() {
    lastTime = lastYaw = holdStart = null;
    holds = 0;
    if (!state.challengeId) baselineStart = baselineYaw = null;
    state = { ...state, paused: true, lastValidatedAt: null };
  }
  reset();
  return {
    reset,
    pause,
    snapshot: () => structuredClone(state),
    update({ yaw, timestamp, fresh = true }) {
      if (state.status === 'failed' || state.status === 'expired') return state;
      if (!fresh || !Number.isFinite(yaw) || !Number.isFinite(timestamp)) {
        pause();
        return state;
      }
      if (lastTime !== null && timestamp <= lastTime) return state;
      if (lastTime !== null && timestamp - lastTime > LIVE_TIMING.maxObservationGapMs) {
        pause();
        return state;
      }
      if (lastYaw !== null && Math.abs(yaw - lastYaw) > 25) {
        holdStart = null;
        holds = 0;
      }
      lastTime = timestamp;
      lastYaw = yaw;
      state = { ...state, paused: false, lastValidatedAt: timestamp };
      if (state.status === 'passed_basic') return state;
      if (!state.challengeId) {
        if (Math.abs(yaw) > 10) {
          baselineStart = null;
          baselineYaw = null;
          return state;
        }
        baselineStart ??= timestamp;
        baselineYaw ??= yaw;
        if (timestamp - baselineStart < 1000) return state;
        const directions = random() ? ['left', 'right'] : ['right', 'left'];
        state = {
          ...state,
          status: 'checking',
          challengeId: crypto.randomUUID(),
          startedAt: timestamp,
          neutralYaw: baselineYaw,
          steps: directions.flatMap((direction) => [{ direction }, { direction: 'neutral' }]),
          prompt: `Turn your head ${directions[0]}`,
        };
      }
      const step = state.steps[state.step],
        relative = yaw - baselineYaw;
      // Positive camera-space yaw is the subject's left (unmirrored input).
      const inPose =
        step.direction === 'neutral'
          ? Math.abs(relative) <= 10
          : step.direction === 'left'
            ? relative >= 20 && relative <= 40
            : relative <= -20 && relative >= -40;
      if (!inPose) {
        holdStart = null;
        holds = 0;
        state = { ...state, paused: true };
        return state;
      }
      holdStart ??= timestamp;
      holds++;
      if (timestamp - holdStart >= 300 && holds >= 2) {
        step.completedAt = timestamp;
        state.step++;
        holdStart = null;
        holds = 0;
        if (state.step === state.steps.length)
          state = {
            ...state,
            status: 'passed_basic',
            passedAt: timestamp,
            expiresAt: null,
            prompt: 'Basic liveness passed — look straight ahead',
          };
        else {
          state = {
            ...state,
            prompt:
              state.steps[state.step].direction === 'neutral'
                ? 'Look straight ahead'
                : `Turn your head ${state.steps[state.step].direction}`,
          };
        }
      }
      return state;
    },
  };
}

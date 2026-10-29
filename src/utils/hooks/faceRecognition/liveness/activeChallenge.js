export function createActiveChallenge({
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2,
} = {}) {
  let state, lastTime, lastYaw, baselineStart, baselineYaw, holdStart, holds, phaseStart;
  function reset() {
    state = {
      status: 'not_checked',
      prompt: 'Look straight ahead',
      steps: [],
      step: 0,
      challengeId: null,
    };
    lastTime = lastYaw = baselineStart = baselineYaw = holdStart = phaseStart = null;
    holds = 0;
  }
  reset();
  return {
    reset,
    snapshot: () => structuredClone(state),
    update({ yaw, timestamp, fresh = true }) {
      if (state.status === 'failed' || state.status === 'expired') return state;
      if (state.status === 'passed_basic') {
        if (timestamp > state.expiresAt)
          state = { ...state, status: 'expired', prompt: 'Liveness expired. Start again.' };
        return state;
      }
      if (
        !fresh ||
        !Number.isFinite(yaw) ||
        (lastTime !== null &&
          (timestamp <= lastTime || timestamp - lastTime > 500 || Math.abs(yaw - lastYaw) > 25))
      ) {
        reset();
        return state;
      }
      lastTime = timestamp;
      lastYaw = yaw;
      if (!state.challengeId) {
        if (Math.abs(yaw) > 10) {
          baselineStart = null;
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
          steps: directions.flatMap((direction) => [{ direction }, { direction: 'neutral' }]),
          prompt: `Turn your head ${directions[0]}`,
        };
        phaseStart = timestamp;
      }
      if (timestamp - state.startedAt > 25000 || timestamp - phaseStart > 8000) {
        state = {
          ...state,
          status: 'failed',
          prompt: 'Motion challenge timed out. Try again.',
          reason: 'CHALLENGE_TIMEOUT',
        };
        return state;
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
            expiresAt: timestamp + 5000,
            prompt: 'Basic liveness passed — look straight ahead',
          };
        else {
          if (state.step % 2 === 0) phaseStart = timestamp;
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

import { DEFAULT_LIVENESS, validateLivenessSettings, livenessDisabled } from './livenessPolicy';
import { LIVE_TIMING } from '../recognition/liveTiming';

export function createActiveChallenge({
  configuration = DEFAULT_LIVENESS,
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2,
} = {}) {
  configuration = structuredClone(validateLivenessSettings(configuration));
  let blinkStage = 0,
    openCount = 0,
    openAt = null,
    recoveryAt = null;
  let state, lastTime, lastYaw, baselineStart, baselineYaw, holdStart, holds;
  function reset() {
    state = {
      status: 'not_checked',
      configuration,
      reason: livenessDisabled(configuration) ? 'disabled_in_settings' : null,
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
    blinkStage = openCount = 0;
    openAt = recoveryAt = null;
  }
  function pause() {
    lastTime = lastYaw = holdStart = null;
    holds = 0;
    blinkStage = openCount = 0;
    openAt = recoveryAt = null;
    if (!state.challengeId) baselineStart = baselineYaw = null;
    state = { ...state, paused: true, lastValidatedAt: null };
  }
  reset();
  return {
    reset,
    pause,
    snapshot: () => structuredClone(state),
    update({ yaw, eyeBlinkLeft, eyeBlinkRight, timestamp, fresh = true }) {
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
      const observationGap = lastTime === null ? 0 : timestamp - lastTime;
      lastTime = timestamp;
      lastYaw = yaw;
      state = { ...state, paused: false, lastValidatedAt: timestamp };
      if (state.status === 'passed_basic') return state;
      if (livenessDisabled(configuration)) {
        state = {
          ...state,
          neutralYaw: state.neutralYaw ?? (Math.abs(yaw) <= 10 ? yaw : null),
          prompt: 'Not checked — disabled in Settings',
        };
        return state;
      }
      if (!state.challengeId) {
        if (Math.abs(yaw) > 10) {
          baselineStart = null;
          baselineYaw = null;
          return state;
        }
        baselineStart ??= timestamp;
        baselineYaw ??= yaw;
        if (timestamp - baselineStart < 1000) return state;
        const directions = (random() ? ['left', 'right'] : ['right', 'left']).filter((d) =>
          d === 'left' ? configuration.turnLeft : configuration.turnRight,
        );
        if (configuration.blink) directions.splice(random() % (directions.length + 1), 0, 'blink');
        state = {
          ...state,
          status: 'checking',
          challengeId: crypto.randomUUID(),
          startedAt: timestamp,
          neutralYaw: baselineYaw,
          steps: directions.flatMap((direction) =>
            direction === 'blink' ? [{ direction }] : [{ direction }, { direction: 'neutral' }],
          ),
          prompt:
            directions[0] === 'blink'
              ? 'Look forward and blink both eyes'
              : `Turn your head ${directions[0]}`,
        };
      }
      const step = state.steps[state.step],
        relative = yaw - baselineYaw;
      // Positive camera-space yaw is the subject's left (unmirrored input).
      let blinkPassed = false;
      if (step.direction === 'blink') {
        const resetBlink = () => {
          blinkStage = openCount = 0;
          openAt = recoveryAt = null;
        };
        if (
          observationGap > 200 ||
          Math.abs(relative) > 10 ||
          !Number.isFinite(eyeBlinkLeft) ||
          !Number.isFinite(eyeBlinkRight)
        ) {
          resetBlink();
          state = {
            ...state,
            paused: true,
            prompt: 'Look forward and blink — a clear, faster feed may help',
          };
          return state;
        }
        const open = eyeBlinkLeft <= 0.3 && eyeBlinkRight <= 0.3;
        const closed = eyeBlinkLeft >= 0.6 && eyeBlinkRight >= 0.6;
        if (blinkStage === 0) {
          openCount = open ? openCount + 1 : 0;
          if (openCount >= 2) {
            blinkStage = 1;
            openAt = timestamp;
          }
        } else if (blinkStage === 1) {
          if (open) openAt = timestamp;
          if (closed) {
            blinkStage = 2;
            openCount = 0;
          }
        } else {
          if (open) {
            recoveryAt ??= timestamp;
            openCount++;
          } else {
            openCount = 0;
            recoveryAt = null;
          }
          blinkPassed = openCount >= 2 && recoveryAt - openAt >= 80 && recoveryAt - openAt <= 1500;
        }
        if (openAt !== null && timestamp - openAt > 1500) resetBlink();
        if (!blinkPassed) return state;
      }
      const inPose =
        step.direction === 'blink'
          ? blinkPassed
          : step.direction === 'neutral'
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
      if (blinkPassed || (timestamp - holdStart >= 300 && holds >= 2)) {
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
              state.steps[state.step].direction === 'blink'
                ? 'Look forward and blink both eyes'
                : state.steps[state.step].direction === 'neutral'
                  ? 'Look straight ahead'
                  : `Turn your head ${state.steps[state.step].direction}`,
          };
        }
      }
      return state;
    },
  };
}

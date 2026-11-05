import { LIVE_MOVEMENT_POLICY as P } from './liveMovementPolicy';

// Bounded per-track transient movement feedback. No observations are retained.
export function createLiveMovement({ trackId, workerGeneration }) {
  let faceScore = 0,
    headScore = 0,
    lastMovementAt = null,
    idle = false;
  let lastObservation = null,
    lastSequence = -1,
    eyes = null,
    head = null,
    expressions = {};
  const snapshot = () => ({
    policyVersion: P.version,
    score: faceScore + headScore,
    faceScore,
    headScore,
    lastMovementAt,
    idle,
  });
  function clearPhases() {
    eyes = null;
    head = null;
    expressions = {};
  }
  function reset() {
    faceScore = headScore = 0;
    lastMovementAt = null;
    idle = false;
    lastObservation = null;
    lastSequence = -1;
    clearPhases();
  }
  function pause() {
    clearPhases();
  }
  function tick(timestamp) {
    if (
      Number.isFinite(timestamp) &&
      lastMovementAt !== null &&
      timestamp >= lastMovementAt &&
      timestamp - lastMovementAt >= P.idleMs
    ) {
      faceScore = headScore = 0;
      lastMovementAt = null;
      idle = true;
      clearPhases();
    }
    return snapshot();
  }
  function credit(family, t) {
    if (family === 'head') headScore = P.bucketMaximum;
    else faceScore = P.bucketMaximum;
    lastMovementAt = t;
    idle = false;
  }
  function update(o) {
    const fields = [
      'timestamp',
      'sequence',
      'yaw',
      'pitch',
      'eyeBlinkLeft',
      'eyeBlinkRight',
      'jawOpen',
      'mouthSmileLeft',
      'mouthSmileRight',
      'jawMotion',
      'smileMotion',
    ];
    if (
      !o ||
      fields.some((key) => !Number.isFinite(o[key])) ||
      !Number.isInteger(o.sequence) ||
      o.sourceTrackId !== trackId ||
      o.workerGeneration !== workerGeneration ||
      o.fresh !== true ||
      o.exclusive !== true ||
      ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight'].some(
        (key) => o[key] < 0 || o[key] > 1,
      ) ||
      o.jawMotion < 0 ||
      o.smileMotion < 0 ||
      o.sequence <= lastSequence ||
      (lastObservation !== null && o.timestamp <= lastObservation)
    )
      return snapshot();
    tick(o.timestamp);
    if (lastObservation !== null && o.timestamp - lastObservation > P.maxGapMs) clearPhases();
    lastObservation = o.timestamp;
    lastSequence = o.sequence;
    const open = o.eyeBlinkLeft <= P.eyeOpen && o.eyeBlinkRight <= P.eyeOpen;
    const closed = o.eyeBlinkLeft >= P.eyeClosed && o.eyeBlinkRight >= P.eyeClosed;
    eyes ??= { phase: 'open', count: 0 };
    if (eyes.phase === 'open') {
      if (open) {
        eyes.count++;
        eyes.lastOpen = o.timestamp;
      } else if (closed && eyes.count >= 2) {
        eyes.phase = 'closed';
      } else if (!closed) eyes.count = 0;
    } else if (o.timestamp - eyes.lastOpen > P.blinkMaxMs) {
      eyes = { phase: 'open', count: open ? 1 : 0, lastOpen: o.timestamp };
    } else if (open) {
      if (o.timestamp - eyes.lastOpen >= P.blinkMinMs) credit('face', o.timestamp);
      eyes = { phase: 'open', count: 1, lastOpen: o.timestamp };
    }
    head ??= { yaw: o.yaw, pitch: o.pitch, since: null };
    const d = Math.max(Math.abs(o.yaw - head.yaw), Math.abs(o.pitch - head.pitch));
    if (d >= P.headThreshold) {
      if (head.since === null) {
        head.since = o.timestamp;
        head.count = 1;
      } else if (++head.count >= 2 && o.timestamp - head.since >= P.holdMs) {
        credit('head', o.timestamp);
        head = { yaw: o.yaw, pitch: o.pitch, since: null };
      }
    } else head.since = null;
    if (Math.abs(o.yaw) <= P.frontal && Math.abs(o.pitch) <= P.frontal) {
      for (const [name, coefficient, geometry] of [
        ['jaw', o.jawOpen, o.jawMotion],
        ['smile', Math.min(o.mouthSmileLeft, o.mouthSmileRight), o.smileMotion],
      ]) {
        const s = (expressions[name] ??= { coefficient, geometry, since: null });
        const dc = coefficient - s.coefficient,
          dg = geometry - s.geometry;
        const changed =
          Math.abs(dc) >= P.expressionDelta &&
          Math.abs(dg) >= P.expressionGeometry &&
          (dc < 0 ? s.coefficient >= P.expressionPeak : coefficient >= P.expressionPeak);
        if (changed) {
          if (s.since === null) {
            s.since = o.timestamp;
            s.count = 1;
          } else if (++s.count >= 2 && o.timestamp - s.since >= P.holdMs) {
            credit('face', o.timestamp);
            expressions[name] = { coefficient, geometry, since: null };
          }
        } else s.since = null;
      }
    } else expressions = {};
    return snapshot();
  }
  return { update, snapshot, tick, pause, reset };
}

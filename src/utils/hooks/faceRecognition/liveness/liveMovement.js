import { LIVE_MOVEMENT_POLICY as P, liveMovementScore } from './liveMovementPolicy';

// One score per continuous track. Each new qualified movement replaces that
// signal's stored magnitude, and the meter is recalculated from what is stored.
// Stillness does not clear it.
export function createLiveMovement({ trackId, workerGeneration }) {
  let score = 0,
    lastMovementAt = null,
    idle = false,
    lastObservation = null,
    lastSequence = -1,
    headAnchor = null,
    expressionBaseline = null,
    eyes = null;
  const channels = {
    head: { level: 0, peak: 0, active: false },
    expression: { level: 0, peak: 0, active: false },
    blink: { level: 0, peak: 0, active: false },
  };
  const snapshot = () => ({
    policyVersion: P.version,
    score,
    lastMovementAt,
    idle,
  });
  const shown = (name) => {
    const channel = channels[name];
    return channel.active ? Math.max(channel.level, channel.peak) : channel.level;
  };
  function publish(timestamp) {
    const next = liveMovementScore(shown('head'), shown('expression'), shown('blink'));
    if (next !== score) {
      score = next;
      lastMovementAt = timestamp;
    }
    idle = false;
  }
  function feed(name, magnitude, timestamp) {
    const channel = channels[name];
    if (magnitude > 0) {
      if (!channel.active) {
        channel.active = true;
        channel.peak = 0;
      }
      channel.peak = Math.max(channel.peak, magnitude);
      publish(timestamp);
      return;
    }
    if (!channel.active) return;
    channel.level = channel.peak;
    channel.peak = 0;
    channel.active = false;
    publish(timestamp);
  }
  function seal(timestamp) {
    for (const name of Object.keys(channels)) if (channels[name].active) feed(name, 0, timestamp);
  }
  function clearTracking() {
    headAnchor = null;
    expressionBaseline = null;
    eyes = null;
    for (const channel of Object.values(channels)) {
      channel.level = 0;
      channel.peak = 0;
      channel.active = false;
    }
  }
  function reset() {
    score = 0;
    lastMovementAt = null;
    idle = false;
    lastObservation = null;
    lastSequence = -1;
    clearTracking();
  }
  function pause() {
    seal(lastObservation);
    headAnchor = null;
    expressionBaseline = null;
    eyes = null;
    for (const channel of Object.values(channels)) {
      channel.peak = 0;
      channel.active = false;
    }
  }
  function expressionOf(o) {
    return {
      jaw: { coefficient: o.jawOpen, motion: o.jawMotion },
      smile: {
        coefficient: Math.min(o.mouthSmileLeft, o.mouthSmileRight),
        motion: o.smileMotion,
      },
    };
  }
  function expressionMagnitude(current, baseline) {
    const coefficientDelta = current.coefficient - baseline.coefficient;
    const motionDelta = current.motion - baseline.motion;
    const rising =
      coefficientDelta >= P.expressionDelta &&
      motionDelta >= P.expressionGeometry &&
      current.coefficient >= P.expressionPeak;
    const falling =
      coefficientDelta <= -P.expressionDelta &&
      motionDelta <= -P.expressionGeometry &&
      baseline.coefficient >= P.expressionPeak;
    if (!rising && !falling) return 0;
    return Math.min(
      1,
      Math.abs(coefficientDelta) / P.expressionFull,
      Math.abs(motionDelta) / P.expressionGeometryFull,
    );
  }
  function blinkMagnitude(o) {
    const open = o.eyeBlinkLeft <= P.eyeOpen && o.eyeBlinkRight <= P.eyeOpen;
    const closed = o.eyeBlinkLeft >= P.eyeClosed && o.eyeBlinkRight >= P.eyeClosed;
    const closure = Math.min(o.eyeBlinkLeft, o.eyeBlinkRight);
    eyes ??= { phase: 'open', count: 0 };
    if (eyes.phase === 'open') {
      if (open) {
        eyes.count += 1;
        eyes.lastOpen = o.timestamp;
      } else if (closed && eyes.count >= 2) {
        eyes = {
          phase: 'closed',
          lastOpen: eyes.lastOpen,
          closedAt: o.timestamp,
          peakClosure: closure,
        };
      } else if (!closed) eyes.count = 0;
      return 0;
    }
    if (o.timestamp - eyes.lastOpen > P.blinkMaxMs) {
      eyes = { phase: 'open', count: open ? 1 : 0, lastOpen: open ? o.timestamp : undefined };
      return 0;
    }
    if (closed) eyes.peakClosure = Math.max(eyes.peakClosure, closure);
    const qualified = o.timestamp - eyes.closedAt >= P.blinkMinMs;
    const depth = qualified ? (eyes.peakClosure - P.eyeClosed) / (1 - P.eyeClosed) : 0;
    if (open) eyes = { phase: 'open', count: 1, lastOpen: o.timestamp };
    return depth;
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
    if (lastObservation !== null && o.timestamp - lastObservation > P.maxGapMs) {
      seal(lastObservation);
      headAnchor = null;
      expressionBaseline = null;
      eyes = null;
    }
    lastObservation = o.timestamp;
    lastSequence = o.sequence;
    headAnchor ??= { yaw: o.yaw, pitch: o.pitch };
    const displacement = Math.max(
      Math.abs(o.yaw - headAnchor.yaw),
      Math.abs(o.pitch - headAnchor.pitch),
    );
    const headMagnitude =
      displacement >= P.headFloorDeg ? Math.min(1, displacement / P.headFullDeg) : 0;
    feed('head', headMagnitude, o.timestamp);
    if (headMagnitude === 0 && !channels.head.active) headAnchor = { yaw: o.yaw, pitch: o.pitch };

    const frontal = Math.abs(o.yaw) <= P.frontal && Math.abs(o.pitch) <= P.frontal;
    const currentExpression = expressionOf(o);
    let expressionMagnitudeValue = 0;
    if (frontal) {
      expressionBaseline ??= currentExpression;
      expressionMagnitudeValue = Math.max(
        expressionMagnitude(currentExpression.jaw, expressionBaseline.jaw),
        expressionMagnitude(currentExpression.smile, expressionBaseline.smile),
      );
    }
    feed('expression', expressionMagnitudeValue, o.timestamp);
    if (frontal && expressionMagnitudeValue === 0 && !channels.expression.active)
      expressionBaseline = currentExpression;

    feed('blink', blinkMagnitude(o), o.timestamp);
    return snapshot();
  }
  return { update, snapshot, tick: () => snapshot(), pause, reset };
}

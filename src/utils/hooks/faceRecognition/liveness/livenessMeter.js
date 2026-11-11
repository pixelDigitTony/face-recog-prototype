import { LIVENESS_METER_POLICY as P, meterScore, meterQualifies } from './livenessMeterPolicy';
import { createLiveMovement } from './liveMovement';

// One instance belongs to one continuous track and camera generation. The caller
// must invalidate it when association or camera continuity is lost.
export function createLivenessMeter({
  cameraSessionId,
  enrollmentSessionId = null,
  trackId,
  workerGeneration,
  assetIdentity,
}) {
  const binding = {
    cameraSessionId,
    enrollmentSessionId,
    trackId,
    workerGeneration,
    assetIdentity,
  };
  const activity = createLiveMovement({ trackId, workerGeneration });
  let observations = [],
    events = {},
    phases = {},
    lastTime = null,
    lastSequence = -1,
    filtered = null,
    accepted = null,
    paused = false,
    pauseReason = null,
    invalidated = false;
  const blank = () => ({ phase: 0 });
  const resetPhases = () => {
    phases = { blink: blank(), head: blank(), expression: blank(), jaw: blank(), smile: blank() };
  };
  resetPhases();
  function progress() {
    return Object.fromEntries(
      ['blink', 'head', 'expression'].map((family) => [
        family,
        events[family]
          ? 3
          : family === 'expression'
            ? Math.max(phases.jaw.phase, phases.smile.phase)
            : phases[family].phase,
      ]),
    );
  }
  function snapshot() {
    const p = progress();
    return {
      status: invalidated
        ? 'invalidated'
        : paused
          ? 'insufficient_quality'
          : accepted
            ? 'passed_basic'
            : observations.length
              ? 'collecting'
              : 'initializing',
      score: invalidated ? null : (accepted?.acceptedScore ?? meterScore(p)),
      progress: p,
      activity: activity.snapshot(),
      accepted: accepted ? structuredClone(accepted) : null,
      lastValidatedAt: lastTime,
      paused,
      reason: pauseReason,
    };
  }
  function pause() {
    activity.pause();
    paused = true;
    pauseReason = 'quality';
    resetPhases();
    filtered = null;
  }
  function reset() {
    // The live percentage belongs to this face number. Proof can be invalidated
    // without clearing the score the person already earned on this track.
    invalidated = true;
    observations = [];
    events = {};
    lastTime = null;
    lastSequence = -1;
    filtered = null;
    accepted = null;
    paused = false;
    pauseReason = null;
    resetPhases();
  }
  function blink(o) {
    const s = phases.blink,
      t = o.timestamp;
    s.maxGap = Math.max(s.maxGap ?? 0, s.lastAt == null ? 0 : t - s.lastAt);
    s.lastAt = t;
    const open = o.eyeBlinkLeft <= P.blink.open && o.eyeBlinkRight <= P.blink.open;
    const closed = o.eyeBlinkLeft >= P.blink.closed && o.eyeBlinkRight >= P.blink.closed;
    if (s.phase === 0) {
      s.openCount = open ? (s.openCount ?? 0) + 1 : 0;
      if (open && s.openCount === 1) s.openFirstAt = t;
      if (s.openCount >= 2) {
        s.phase = 1;
        s.baselineAt = t;
        s.lastOpen = t;
      }
    } else if (s.phase === 1) {
      if (open) {
        s.openFirstAt = s.baselineAt;
        s.baselineAt = t;
        s.lastOpen = t;
      }
      if (closed) {
        s.phase = 2;
        s.changedAt = t;
        s.openCount = 0;
      }
    } else {
      if (t - s.lastOpen > P.blink.maximumMs) {
        phases.blink = blank();
        return;
      }
      s.openCount = open ? (s.openCount ?? 0) + 1 : 0;
      if (open && s.openCount === 1) s.returnAt = t;
      if (s.openCount >= 2 && s.returnAt - s.lastOpen >= P.blink.minimumMs) {
        events.blink = {
          family: 'blink',
          openFirstAt: s.openFirstAt,
          baselineAt: s.baselineAt,
          startedAt: s.lastOpen,
          changedAt: s.changedAt,
          returnAt: s.returnAt,
          completedAt: t,
          openBefore: 2,
          closedCount: 1,
          openAfter: s.openCount,
          maxGapMs: s.maxGap,
        };
      }
    }
  }
  function movement(family, values, t) {
    let s = phases[family];
    const head = family === 'head';
    s.maxGap = Math.max(s.maxGap ?? 0, s.lastAt == null ? 0 : t - s.lastAt);
    s.lastAt = t;
    if (s.phase === 0) {
      if (s.baselineAt == null) {
        s.baselineAt = t;
        s.base = values;
        return;
      }
      const stable = head
        ? Math.max(Math.abs(values.yaw - s.base.yaw), Math.abs(values.pitch - s.base.pitch)) <= 3
        : Math.abs(values.coefficient - s.base.coefficient) <= 0.1 &&
          Math.abs(values.motion - s.base.motion) <= 0.025 &&
          values.channel === s.base.channel;
      if (!stable) {
        phases[family] = { phase: 0, baselineAt: t, base: values };
        return;
      }
      if (t - s.baselineAt >= P.movement.baselineMs) {
        s.phase = 1;
        s.baselineReadyAt = t;
        s.startedAt = null;
      }
      return;
    }
    if (s.startedAt != null && t - s.startedAt > P.movement.maximumMs) {
      phases[family] = blank();
      return;
    }
    const difference = head
      ? Math.max(Math.abs(values.yaw - s.base.yaw), Math.abs(values.pitch - s.base.pitch))
      : values.coefficient - s.base.coefficient;
    const change = head
      ? difference >= 4 && difference <= 15
      : values.channel === s.base.channel &&
        difference >= 0.2 &&
        values.coefficient >= 0.35 &&
        values.motion - s.base.motion >= P.expressionLandmarkDelta;
    if (head && difference > P.movement.headMax) {
      phases[family] = blank();
      return;
    }
    const returned = head
      ? difference <= 3
      : values.channel === s.base.channel &&
        Math.abs(difference) <= 0.1 &&
        Math.abs(values.motion - s.base.motion) <= P.expressionLandmarkDelta;
    if (s.phase === 1) {
      if (!change) {
        if (returned && (s.departed || s.startedAt != null)) {
          phases[family] = { phase: 0, baselineAt: t, base: values, lastAt: t, maxGap: 0 };
          return;
        }
        if (!returned) s.departed = true;
        s.holdAt = null;
        s.startedAt = null;
        s.count = 0;
        s.peak = null;
        s.peakCoefficient = null;
        s.peakMotionDelta = null;
        if (returned) {
          const recent = observations.filter((at) => at <= t - P.movement.baselineMs);
          if (recent.length) s.baselineAt = recent[recent.length - 1];
          s.baselineReadyAt = t;
        }
        return;
      }
      s.startedAt ??= t;
      s.holdAt ??= t;
      s.count = (s.count ?? 0) + 1;
      if (s.peak == null || difference > s.peak) {
        s.peak = difference;
        if (!head) {
          s.peakCoefficient = values.coefficient;
          s.peakMotionDelta = values.motion - s.base.motion;
        }
      }
      if (s.count >= 2 && t - s.holdAt >= P.movement.holdMs) {
        s.phase = 2;
        s.changedAt = s.holdAt;
        s.changedEndAt = t;
        s.returnAt = null;
        s.count = 0;
      }
    } else {
      if (!returned) {
        s.returnAt = null;
        s.count = 0;
        return;
      }
      s.returnAt ??= t;
      s.count++;
      s.returnDelta = Math.abs(difference);
      if (s.count >= 2 && t - s.returnAt >= P.movement.holdMs)
        events[head ? family : 'expression'] = {
          family: head ? family : 'expression',
          baselineAt: s.baselineAt,
          startedAt: s.startedAt,
          changedAt: s.changedAt,
          changedEndAt: s.changedEndAt,
          returnAt: s.returnAt,
          completedAt: t,
          peak: s.peak,
          holdCount: 2,
          returnCount: s.count,
          returnDelta: s.returnDelta,
          maxGapMs: s.maxGap,
          ...(head
            ? {}
            : {
                channel: s.base.channel,
                baseline: s.base.coefficient,
                peakCoefficient: s.peakCoefficient,
                peakMotionDelta: s.peakMotionDelta,
              }),
        };
    }
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
      fields.some((k) => !Number.isFinite(o[k])) ||
      !Number.isInteger(o.sequence) ||
      o.sourceTrackId !== trackId ||
      o.workerGeneration !== workerGeneration ||
      o.fresh !== true ||
      o.exclusive !== true ||
      ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight'].some(
        (k) => o[k] < 0 || o[k] > 1,
      ) ||
      o.jawMotion < 0 ||
      o.smileMotion < 0
    ) {
      pause();
      return snapshot();
    }
    if (o.sequence <= lastSequence || (lastTime !== null && o.timestamp <= lastTime))
      return snapshot();
    invalidated = false;
    activity.update(o);
    const samplingGap = lastTime !== null && o.timestamp - lastTime > P.maximumGapMs;
    if (samplingGap) {
      resetPhases();
      filtered = null;
    }
    const dt = lastTime === null ? 0 : o.timestamp - lastTime;
    lastSequence = o.sequence;
    lastTime = o.timestamp;
    paused = samplingGap && !accepted;
    pauseReason = paused ? 'insufficient_sampling' : null;
    observations.push(o.timestamp);
    observations = observations
      .filter((t) => o.timestamp - t <= P.collectionWindowMs)
      .slice(-P.maxObservations);
    if (accepted) return snapshot();
    for (const family of Object.keys(events))
      if (
        o.timestamp - events[family].completedAt > P.collectionWindowMs ||
        (events[family].openFirstAt ?? events[family].baselineAt) < observations[0]
      ) {
        delete events[family];
        phases[family] = blank();
        if (family === 'expression') {
          phases.jaw = blank();
          phases.smile = blank();
        }
      }
    const alpha = filtered ? 1 - Math.exp(-dt / P.filterTimeConstantMs) : 1;
    filtered = Object.fromEntries(
      [
        'yaw',
        'pitch',
        'jawOpen',
        'mouthSmileLeft',
        'mouthSmileRight',
        'jawMotion',
        'smileMotion',
      ].map((k) => [k, filtered ? filtered[k] + alpha * (o[k] - filtered[k]) : o[k]]),
    );
    if (!events.blink) blink(o);
    if (!events.head) movement('head', { yaw: filtered.yaw, pitch: filtered.pitch }, o.timestamp);
    if (!events.expression) {
      if (
        Math.abs(filtered.yaw) > P.movement.frontal ||
        Math.abs(filtered.pitch) > P.movement.frontal
      ) {
        phases.jaw = blank();
        phases.smile = blank();
      } else {
        movement(
          'jaw',
          { channel: 'jaw', coefficient: filtered.jawOpen, motion: filtered.jawMotion },
          o.timestamp,
        );
        if (!events.expression)
          movement(
            'smile',
            {
              channel: 'smile',
              coefficient: Math.min(filtered.mouthSmileLeft, filtered.mouthSmileRight),
              motion: filtered.smileMotion,
            },
            o.timestamp,
          );
      }
    }
    const p = progress();
    if (
      observations.length >= P.minimumObservations &&
      o.timestamp - observations[0] >= P.minimumSpanMs &&
      meterQualifies(p)
    )
      accepted = {
        policyVersion: P.version,
        ...binding,
        status: 'passed_basic',
        acceptedScore: meterScore(p),
        progress: structuredClone(p),
        partials: Object.fromEntries(
          Object.entries(p)
            .filter(([, value]) => value > 0 && value < 3)
            .map(([key]) => [
              key,
              structuredClone(
                key === 'expression'
                  ? phases.jaw.phase >= phases.smile.phase
                    ? phases.jaw
                    : phases.smile
                  : phases[key],
              ),
            ]),
        ),
        threshold: P.threshold,
        observationCount: observations.length,
        startedAt: observations[0],
        passedAt: o.timestamp,
        events: Object.values(events).map((e) => structuredClone(e)),
      };
    return snapshot();
  }
  function tick(timestamp) {
    activity.tick(timestamp);
    return snapshot();
  }
  return { update, snapshot, pause, reset, tick };
}

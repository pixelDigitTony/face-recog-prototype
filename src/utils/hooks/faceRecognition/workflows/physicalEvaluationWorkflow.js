import { createFaceTracker } from '../recognition/faceTracker';
import { associateFacePoses } from '../liveness/associateFacePoses';
import { createLivenessMeter } from '../liveness/livenessMeter';
import { createActiveChallenge } from '../liveness/activeChallenge';
import { livenessDisabled, validateLivenessSettings } from '../liveness/livenessPolicy';
import { PHYSICAL_POLICY, validatePhysicalTrial } from '../repositories/physicalTrial';

export function createPhysicalEvaluationWorkflow({
  context,
  repository,
  engine,
  liveness,
  meterFactory = createLivenessMeter,
  now = () => performance.now(),
}) {
  const tracker = createFaceTracker(),
    listeners = new Set(),
    active = new Map();
  let state = {
      status: 'idle',
      error: null,
      faces: [],
      segments: [],
      trial: null,
      pending: null,
      elapsedMs: 0,
      durationMs: 0,
    },
    generation = 0,
    data,
    segments,
    sequence = 0,
    processing = false,
    poseBusy = false,
    lastDetection,
    lastPose,
    cameraSessionId,
    workerGeneration;
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const close = (segment, reason) => {
    segment.endReason = reason;
    active.delete(segment.trackId);
  };
  const present = () =>
    state.faces.map((face) => {
      const s = active.get(face.trackId);
      return {
        ...face,
        segmentId: s?.segmentId,
        meter: s?.meter.snapshot(),
        liveness: s?.challenge.snapshot(),
      };
    });
  const compact = (s) => ({
    segmentId: s.segmentId,
    trackId: s.trackId,
    firstSeenAt: s.firstSeenAt,
    lastSeenAt: s.lastSeenAt,
    endReason: s.endReason,
    observationCount: s.observationCount,
    firstObservationAt: s.firstObservationAt,
    lastObservationAt: s.lastObservationAt,
    maxGapMs: s.maxGapMs,
    gapCount: s.gapCount,
    peakActivity: s.peakActivity,
    meterPassedAt: s.meterProof?.passedAt ?? null,
    challengePassedAt: s.challengeProof?.passedAt ?? null,
    combinedPassedAt:
      s.meterProof && s.challengeProof
        ? Math.max(s.meterProof.passedAt, s.challengeProof.passedAt)
        : null,
    meterProof: s.meterProof,
    challenge: s.challengeProof,
    label: '',
    truth: 'unscored',
    attackSubtype: null,
  });
  function seal(reason, timestamp) {
    if (state.status !== 'running') return;
    reason =
      typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 80) : 'interrupted';
    const timed = reason === 'duration',
      end = Math.max(
        data.startTimestamp,
        Math.min(timestamp, data.startTimestamp + data.durationSeconds * 1000 + 1500),
      );
    for (const s of [...active.values()]) close(s, timed ? 'timed' : 'interrupted');
    generation++;
    data = {
      ...data,
      completedAt: new Date().toISOString(),
      endTimestamp: end,
      completion: timed ? 'timed' : 'interrupted',
      reason,
      segments: segments.map(compact),
    };
    publish({
      status: 'review',
      faces: [],
      segments: structuredClone(data.segments),
      trial: structuredClone(data),
      elapsedMs: end - data.startTimestamp,
    });
  }
  const api = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    async start(options) {
      if (
        state.pending ||
        ['loading', 'ready', 'running', 'review', 'saving', 'save_failed'].includes(state.status)
      )
        throw new Error('Finish the current trial first.');
      const token = ++generation;
      if (
        !options?.authorized ||
        !options.label?.trim() ||
        !options.deviceLabel?.trim() ||
        !options.appearance?.trim() ||
        !['even', 'dim', 'backlit', 'uneven', 'other'].includes(options.lighting) ||
        ![15, 30, 60].includes(options.durationSeconds) ||
        !Number.isInteger(options.expectedGroupSize) ||
        options.expectedGroupSize < 1 ||
        options.expectedGroupSize > 10
      )
        throw new Error('Complete the physical trial setup.');
      publish({
        status: 'loading',
        error: null,
        faces: [],
        segments: [],
        trial: null,
        elapsedMs: 0,
        durationMs: options.durationSeconds * 1000,
      });
      try {
        await repository.load();
        if (token !== generation) return;
        const snapshot = repository.getSnapshot();
        if (snapshot.mode !== 'writable') throw new Error('Use the writable tab.');
        if ((snapshot.database?.physicalTrials?.length ?? 0) >= 100)
          throw new Error('Physical trial limit reached.');
        const savedConfiguration = validateLivenessSettings(
          repository.getSnapshot().database?.settings?.enrollmentLiveness,
        );
        const configuration = {
          version: savedConfiguration.version,
          turnLeft: savedConfiguration.turnLeft,
          turnRight: savedConfiguration.turnRight,
          blink: savedConfiguration.blink,
        };
        if (livenessDisabled(configuration))
          throw new Error('Enable at least one enrollment challenge in Settings');
        await engine.initialize();
        if (token !== generation) return;
        await liveness.initialize({ blink: true, meter: true, numFaces: 10 });
        if (token !== generation) return;
        workerGeneration = liveness.generation ?? 0;
        cameraSessionId = crypto.randomUUID();
        data = {
          id: crypto.randomUUID(),
          companyId: context.companyId,
          storeId: context.storeId ?? null,
          policy: PHYSICAL_POLICY,
          label: options.label.trim(),
          deviceLabel: options.deviceLabel.trim(),
          lighting: options.lighting,
          appearance: options.appearance.trim(),
          expectedGroupSize: options.expectedGroupSize,
          durationSeconds: options.durationSeconds,
          authorized: true,
          modelIdentity: {
            detector: { sha256: engine.manifest?.detector?.sha256 },
            recognizer: { sha256: engine.manifest?.recognizer?.sha256 },
            preprocessingVersion: engine.manifest?.preprocessingVersion,
            qualityPolicyVersion: engine.manifest?.qualityPolicyVersion ?? null,
            runtimeVersion: engine.manifest?.runtimeVersion ?? null,
            opencvVersion: engine.manifest?.opencvVersion ?? null,
          },
          assetIdentity: liveness.manifest?.sha256,
          livenessIdentity: {
            version: liveness.manifest?.version ?? null,
            method: liveness.manifest?.method ?? null,
            sha256: liveness.manifest?.sha256,
            assets: (liveness.manifest?.assets ?? []).map(({ name, sha256 }) => ({ name, sha256 })),
          },
          meterPolicyVersion: 'motion-evidence-v1',
          activityPolicyVersion: 'live-movement-v1',
          configuration,
          cameraSessionId,
          workerGeneration,
        };
        tracker.reset();
        active.clear();
        segments = [];
        sequence = 0;
        publish({ status: 'ready' });
      } catch (error) {
        if (token === generation) publish({ status: 'error', error: error.message });
        throw error;
      }
    },
    begin(camera = {}) {
      if (state.status !== 'ready') throw new Error('The trial is not ready.');
      const timestamp = now();
      data = {
        ...data,
        camera: {
          width: camera.width ?? null,
          height: camera.height ?? null,
          frameRate: camera.frameRate ?? null,
          facingMode: camera.facingMode ?? null,
          deviceLabel: camera.deviceLabel ?? null,
          userAgent: camera.userAgent ?? null,
        },
        startedAt: new Date().toISOString(),
        startTimestamp: timestamp,
      };
      lastDetection = lastPose = timestamp;
      publish({ status: 'running' });
    },
    async process(frame, timestamp) {
      if (state.status !== 'running' || processing) return;
      if (
        !Number.isFinite(timestamp) ||
        timestamp < data.startTimestamp ||
        timestamp < lastDetection
      )
        return;
      if (timestamp >= data.startTimestamp + data.durationSeconds * 1000) {
        api.tick(timestamp);
        return;
      }
      processing = true;
      const token = generation,
        frameId = crypto.randomUUID();
      try {
        const detected = await engine.detectFrame(frame, frameId);
        if (token !== generation) return;
        if (now() >= data.startTimestamp + data.durationSeconds * 1000) {
          api.tick(now());
          return;
        }
        if (!Number.isFinite(timestamp) || now() - timestamp > 1500) {
          seal('stale_detection', now());
          return;
        }
        lastDetection = now();
        const current = tracker.update(detected.faces, timestamp).faces;
        const visible = new Set(current.filter((f) => !f.ambiguous).map((f) => f.trackId));
        for (const s of [...active.values()])
          if (!visible.has(s.trackId))
            close(
              s,
              current.some((f) => f.trackId === s.trackId && f.ambiguous) ? 'ambiguous' : 'lost',
            );
        if (!state.faces.length && current.length) lastPose = now();
        for (const face of current.filter((f) => !f.ambiguous)) {
          let s = active.get(face.trackId);
          if (!s) {
            if (segments.length >= 100 || active.size >= 10) {
              seal('segment_limit', now());
              return;
            }
            const segmentId = crypto.randomUUID();
            s = {
              segmentId,
              trackId: face.trackId,
              firstSeenAt: timestamp,
              lastSeenAt: timestamp,
              endReason: null,
              observationCount: 0,
              firstObservationAt: null,
              lastObservationAt: null,
              maxGapMs: 0,
              gapCount: 0,
              peakActivity: 0,
              meterProof: null,
              challengeProof: null,
              meter: meterFactory({
                cameraSessionId,
                enrollmentSessionId: segmentId,
                trackId: face.trackId,
                workerGeneration,
                assetIdentity: data.assetIdentity,
              }),
              challenge: createActiveChallenge({ configuration: data.configuration }),
            };
            active.set(face.trackId, s);
            segments.push(s);
          }
          s.lastSeenAt = timestamp;
        }
        publish({ faces: current, frameSize: [frame.width, frame.height] });
        publish({ faces: present() });
      } catch (error) {
        if (token === generation) seal('detector_error', now());
      } finally {
        try {
          await engine.releaseFrame?.(frameId);
        } finally {
          processing = false;
        }
      }
    },
    async observePose(frame, timestamp) {
      if (state.status !== 'running' || poseBusy || !state.faces.length) return;
      if (!Number.isFinite(timestamp) || timestamp < data.startTimestamp) return;
      if (timestamp >= data.startTimestamp + data.durationSeconds * 1000) {
        api.tick(timestamp);
        return;
      }
      const token = generation;
      poseBusy = true;
      try {
        const result = await liveness.observe(frame, timestamp);
        if (token !== generation) return;
        if (now() >= data.startTimestamp + data.durationSeconds * 1000) {
          api.tick(now());
          return;
        }
        if ((liveness.generation ?? 0) !== workerGeneration || now() - timestamp > 1500) {
          seal('stale_pose', now());
          return;
        }
        lastPose = now();
        sequence++;
        const matches = associateFacePoses(
          state.faces,
          (result.faces ?? []).map((p) => ({ ...p, timestamp })),
        );
        for (const face of state.faces) {
          const s = active.get(face.trackId),
            match = matches.get(face.trackId);
          if (!s) continue;
          if (
            timestamp < s.firstSeenAt ||
            (s.lastObservationAt !== null && timestamp <= s.lastObservationAt)
          )
            continue;
          if (face.ambiguous || !match) {
            close(s, 'ambiguous');
            continue;
          }
          if (face.reasonCode) {
            s.meter.pause();
            s.challenge.pause();
            continue;
          }
          const before = s.meter.snapshot().lastValidatedAt;
          s.meter.update({
            ...match.pose,
            sequence,
            sourceTrackId: face.trackId,
            workerGeneration,
            fresh: true,
            exclusive: true,
          });
          const meter = s.meter.snapshot();
          if (meter.lastValidatedAt !== timestamp || meter.lastValidatedAt === before) continue;
          s.lastSeenAt = Math.max(s.lastSeenAt, timestamp);
          if (s.lastObservationAt !== null) {
            const gap = timestamp - s.lastObservationAt;
            s.maxGapMs = Math.max(s.maxGapMs, gap);
            if (gap > 200) s.gapCount++;
          }
          s.firstObservationAt ??= timestamp;
          s.lastObservationAt = timestamp;
          s.observationCount++;
          s.peakActivity = Math.max(s.peakActivity, meter.activity?.score ?? 0);
          s.meterProof ??= meter.accepted;
          s.challenge.update({ ...match.pose, fresh: true });
          const c = s.challenge.snapshot();
          if (!s.challengeProof && c.status === 'passed_basic')
            s.challengeProof = {
              challengeId: c.challengeId,
              configuration: c.configuration,
              startedAt: c.startedAt,
              passedAt: c.passedAt,
              neutralYaw: c.neutralYaw,
              steps: c.steps,
            };
        }
        publish({ faces: present() });
      } catch (error) {
        if (token === generation) seal('pose_error', now());
      } finally {
        poseBusy = false;
      }
    },
    tick(timestamp = now()) {
      if (state.status !== 'running') return;
      if (
        timestamp - lastDetection > 1500 ||
        (state.faces.length && timestamp - lastPose > 1500) ||
        (liveness.generation ?? 0) !== workerGeneration
      ) {
        seal('analysis_stale', timestamp);
        return;
      }
      if (timestamp - data.startTimestamp >= data.durationSeconds * 1000) {
        seal('duration', data.startTimestamp + data.durationSeconds * 1000);
        return;
      }
      for (const s of active.values()) s.meter.tick?.(timestamp);
      publish({ elapsedMs: timestamp - data.startTimestamp, faces: present() });
    },
    stale() {
      api.tick(now());
    },
    interrupt(reason = 'stopped') {
      if (state.status === 'running') seal(reason, now());
      else if (['loading', 'ready'].includes(state.status)) {
        generation++;
        publish({ status: 'idle', faces: [] });
      }
    },
    stop() {
      api.interrupt('stopped');
    },
    async save(rows) {
      if (state.status !== 'review' || state.pending) throw new Error('Review is not ready.');
      const trial = structuredClone({
        ...data,
        segments: data.segments.map((s) => {
          const row = rows[s.segmentId] ?? {};
          return {
            ...s,
            label: (row.label ?? '').trim(),
            truth: row.truth ?? 'unscored',
            attackSubtype: row.truth === 'attack' ? row.attackSubtype : null,
          };
        }),
      });
      validatePhysicalTrial(trial, context);
      const operation = { type: 'savePhysicalTrial', trial };
      publish({ status: 'saving', pending: operation, error: null });
      try {
        await repository.commit(operation);
        publish({ status: 'saved', pending: null, trial });
      } catch (error) {
        publish({ status: 'save_failed', error: error.message });
      }
    },
    async retry() {
      if (state.status !== 'save_failed' || !state.pending) return;
      const op = state.pending;
      publish({ status: 'saving', error: null });
      try {
        await repository.commit(op);
        publish({ status: 'saved', pending: null, trial: op.trial });
      } catch (error) {
        publish({ status: 'save_failed', error: error.message });
      }
    },
    discard() {
      if (state.status === 'saving') return;
      generation++;
      active.clear();
      tracker.reset();
      publish({ status: 'idle', pending: null, trial: null, segments: [], faces: [], error: null });
    },
  };
  return api;
}

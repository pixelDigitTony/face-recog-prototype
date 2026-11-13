import { createFaceTracker, boxIoU } from '../recognition/faceTracker';
import { createEnrollmentDiscovery } from '../recognition/enrollmentDiscovery';
import { createActiveChallenge } from '../liveness/activeChallenge';
import { createLivenessMeter } from '../liveness/livenessMeter';
import { LIVENESS_METER_POLICY } from '../liveness/livenessMeterPolicy';
import { associateFacePoses } from '../liveness/associateFacePoses';
import {
  DEFAULT_LIVENESS,
  CHALLENGE_POLICY,
  challengeReady,
  livenessDisabled,
} from '../liveness/livenessPolicy';
import { cosineSimilarity } from '../recognition/cosineSimilarity';
import { thumbnail } from '../recognition/imageQuality';
import { LIVE_TIMING } from '../recognition/liveTiming';
import { LIVE_MOVEMENT_POLICY, livenessMeterReady, livenessPassRate } from '../liveness/liveMovementPolicy';

const terminal = (status) =>
  [
    'review',
    'saving_set',
    'set_save_failed',
    'save_failed',
    'retrying',
    'saved',
    'completed',
    'cancelled',
  ].includes(status);
export function createMultiEnrollmentWorkflow({
  repository,
  engine,
  liveness,
  meterFactory = createLivenessMeter,
  workflow,
  context,
  now = () => performance.now(),
}) {
  const listeners = new Set(),
    tracker = createFaceTracker(),
    sessions = new Map(),
    previewMeters = new Map(),
    previewSeen = new Map(),
    invalidatedTracks = new Set();
  const discovery = createEnrollmentDiscovery({ repository, engine, context, now });
  let state = {
    status: 'idle',
    faces: [],
    result: null,
    review: null,
    error: null,
    liveness: { configuration: {} },
    enrollmentPerson: null,
    sessions: [],
  };
  let generation = 0,
    processing = false,
    poseBusy = false,
    configuringPose = false,
    poseTask = null,
    bindingQueue = Promise.resolve(),
    lastComparison = -Infinity,
    lastFrameAt = null,
    faces = [],
    poses = new Map(),
    poseSequence = 0,
    meterAvailable = false,
    meterGeneration = 0,
    clockOffset = 0,
    trackOffset = 0;
  function invalidateTrack(id) {
    invalidatedTracks.add(id);
    if (invalidatedTracks.size > 200)
      invalidatedTracks.delete(invalidatedTracks.values().next().value);
  }
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const meterView = (meter) => {
    const value = meter.snapshot();
    return {
      ...value,
      acceptedAt: value.accepted
        ? new Date(clockOffset + value.accepted.passedAt).toISOString()
        : null,
    };
  };
  const sessionMeterView = (session) => {
    const value = meterView(session.meter);
    if (!session.detached) {
      const live = previewMeters.get(session.trackId)?.snapshot();
      if (live?.activity) value.activity = live.activity;
    }
    if (terminal(session.status) && !session.detached && !meterAvailable)
      value.status = 'unavailable';
    return value;
  };
  const view = (session) => ({
    trackId: session.trackId,
    person: session.person,
    status: session.status,
    error: session.error ?? null,
    active: !terminal(session.status),
    liveness: {
      ...session.challenge.snapshot(),
      ...(challengeReady(session.challenge.snapshot())
        ? {
            prompt: meterReady(session) ? capturePrompt(session) : 'Enrollment challenge complete',
          }
        : {}),
    },
    meter: sessionMeterView(session),
    guided: session.guided,
    stage: session.captures.length,
    review: session.review ?? null,
    result: session.result ?? null,
    visible: !session.detached && faces.some((face) => face.trackId === session.trackId),
  });
  function display(patch = {}) {
    const analyses = new Map(discovery.all().map((item) => [item.trackId, item]));
    const visible = faces.map((face) => ({
      ...face,
      discovery: analyses.has(face.trackId)
        ? (({ embedding, presentation, ...rest }) => rest)(analyses.get(face.trackId))
        : null,
      identification: analyses.get(face.trackId)?.presentation ?? {
        status: 'waiting_for_analysis',
        similarity: null,
        closestCandidate: null,
      },
      meter:
        sessions.has(face.trackId) && !sessions.get(face.trackId).detached
          ? sessionMeterView(sessions.get(face.trackId))
          : previewMeters.has(face.trackId)
            ? meterView(previewMeters.get(face.trackId))
            : {
                status: !meterAvailable
                  ? 'unavailable'
                  : invalidatedTracks.has(face.trackId)
                    ? 'invalidated'
                    : 'initializing',
              },
      enrollment:
        sessions.has(face.trackId) && !sessions.get(face.trackId).detached
          ? view(sessions.get(face.trackId))
          : null,
    }));
    const active = [...sessions.values()].filter((s) => !terminal(s.status));
    publish({
      ...patch,
      faces: visible,
      sessions: [...sessions.values()].map(view),
      discovery: faces.length === 1 ? visible[0]?.discovery : null,
      similarity: faces.length === 1 ? visible[0]?.identification.similarity : null,
      needsIndependentPose: meterAvailable,
      enrollmentPerson:
        faces.length === 1 ? (sessions.get(faces[0].trackId)?.person ?? null) : null,
      liveness:
        faces.length === 1
          ? (sessions.get(faces[0].trackId)?.challenge.snapshot() ?? { configuration: {} })
          : { configuration: {} },
    });
  }
  function cancelSession(s, message) {
    s.controller.abort();
    s.status = 'cancelled';
    s.error = message;
    s.candidate = null;
    s.review = null;
    s.captures = [];
  }
  function valid(s) {
    const person = repository.getSnapshot().database?.people.find((p) => p.id === s.person.id);
    return (
      repository.getSnapshot().mode === 'writable' &&
      (s.newPerson
        ? !person
        : person?.enrollmentRevision === s.person.enrollmentRevision &&
          person.acknowledgedAt === s.person.acknowledgedAt)
    );
  }
  const meterReady = (session) =>
    livenessMeterReady(
      session.meter.snapshot().activity?.score,
      session.settings?.livenessPassRate,
    );
  function enrollmentMeterProof(session, timestamp) {
    const snapshot = session.meter.snapshot();
    if (snapshot.accepted) return structuredClone(snapshot.accepted);
    const rate = livenessPassRate(session.settings?.livenessPassRate);
    const score = snapshot.activity?.score;
    const assetIdentity = liveness.manifest?.sha256;
    if (
      !livenessMeterReady(score, rate) ||
      typeof assetIdentity !== 'string' ||
      !assetIdentity
    )
      return null;
    return {
      policyVersion: LIVE_MOVEMENT_POLICY.version,
      cameraSessionId: state.sessionId,
      enrollmentSessionId: session.id,
      trackId: session.trackId,
      workerGeneration: meterGeneration,
      assetIdentity,
      status: 'passed_basic',
      acceptedScore: score,
      threshold: rate,
      passedAt: Number.isFinite(snapshot.activity?.lastMovementAt)
        ? snapshot.activity.lastMovementAt
        : timestamp,
    };
  }
  const capturePrompt = (s) =>
    s.guided
      ? [
          'Face forward — capture Front',
          'Turn slightly left (10–20°) — capture Slight left',
          'Turn slightly right (10–20°) — capture Slight right',
        ][s.captures.length]
      : 'Face forward for capture';
  function inPose(s, yaw, live) {
    const relative = yaw - (live.neutralYaw ?? 0),
      stage = s.guided ? s.captures.length : 0;
    return stage === 0
      ? Math.abs(relative) <= 10
      : stage === 1
        ? relative >= 10 && relative <= 20
        : relative <= -10 && relative >= -20;
  }
  async function capture(s, face, embedding, frame, timestamp, association, token) {
    const live = s.challenge.snapshot();
    const shot = { ...frame };
    const thumb = s.settings.saveThumbnails ? await thumbnail(shot, face) : {};
    if (token !== generation || s.controller.signal.aborted) return;
    if (!valid(s)) {
      cancelSession(s, 'Enrollment changed. Confirm this face again.');
      return;
    }
    if (
      now() - timestamp > 1500 ||
      now() - association.pose.timestamp > 1500 ||
      !faces.some(
        (current) => current.trackId === s.trackId && !current.ambiguous && !current.reasonCode,
      ) ||
      !meterReady(s) ||
      (liveness.generation != null && liveness.generation !== meterGeneration)
    ) {
      s.candidate = null;
      s.status = 'preparing_enrollment';
      return;
    }
    const meterProof = enrollmentMeterProof(s, timestamp);
    if (!meterProof) {
      s.candidate = null;
      s.status = 'preparing_enrollment';
      return;
    }
    const consistency = cosineSimilarity(embedding, s.candidate.embedding);
    const prepared = {
      outcome: 'ENROLLED',
      newPerson: s.newPerson,
      expectedEnrollmentRevision: s.person.enrollmentRevision,
      replaceTemplateId: s.replaceTemplateId,
      sampleLabel: s.sampleLabel,
      sessionId: s.id,
      enrollmentPolicyVersion: LIVENESS_METER_POLICY.enrollmentPolicy,
      livenessMeter: {
        ...meterProof,
        capture: {
          captureTimestamp: timestamp,
          poseTimestamp: association.pose.timestamp,
          decisionTimestamp: now(),
          exclusive: true,
        },
      },
      similarity: null,
      extracted: {
        embedding: [...embedding],
        faces: [face],
        quality: face.quality ?? {},
        modelIdentity: engine.manifest,
        preprocessingVersion: engine.manifest.preprocessingVersion,
        qualityPolicyVersion: engine.manifest.qualityPolicyVersion,
        timingsMs: {},
        ...thumb,
      },
      liveness: {
        ...live,
        method: 'per_face_enrollment',
        policyVersion: CHALLENGE_POLICY,
        sessionId: s.id,
        trackId: s.trackId,
        assetIdentity: liveness.manifest?.sha256 ?? null,
      },
      metadata: {
        cameraSessionId: state.sessionId,
        workerGeneration: meterGeneration,
        captureConsistency: consistency,
        captureYaw: association.pose.yaw,
        neutralYaw: live.neutralYaw ?? 0,
        trackId: s.trackId,
        sourceTrackId: s.trackId,
        faceCountAtDecision: faces.length,
        targetFaceCountAtDecision: 1,
        maxFaceCountObserved: s.maxFaces,
        decisionTimestamp: null,
        captureFrameTimestamp: timestamp,
        poseTimestamp: association.pose.timestamp,
        associationPolicy: 'exclusive-iou-v1',
        associationAmbiguous: false,
        poseAssociationIoU: boxIoU(face.box, association.pose.box),
        detectionId: face.detectionId,
        targetBox: [...face.box],
        poseBox: [...association.pose.box],
        poseTrackId: s.trackId,
        capturePose: ['front', 'slight_left', 'slight_right'][s.guided ? s.captures.length : 0],
        stableSampleCount: 0,
        stableDurationMs: 0,
        scoreAggregation: 'last',
      },
    };
    prepared.metadata.decisionTimestamp = prepared.livenessMeter.capture.decisionTimestamp;
    s.status = 'saving';
    display();
    if (s.guided) {
      const operation = await workflow.prepareEnrollment({
        personId: s.person.id,
        signal: s.controller.signal,
        prepared,
      });
      if (token !== generation || s.controller.signal.aborted) return;
      const index = s.captures.length;
      operation.template.version += index;
      operation.attempt.templateVersion = operation.template.version;
      operation.template.label = ['Front', 'Slight left', 'Slight right'][index];
      operation.template.captureSetId = s.captureSetId;
      operation.attempt.captureSetId = s.captureSetId;
      s.captures.push(operation);
      s.candidate = null;
      s.hold = null;
      s.status = s.captures.length === 3 ? 'review' : 'preparing_enrollment';
      if (s.status === 'review')
        s.review = s.captures.map((c) => ({
          label: c.template.label,
          thumbnailDataUrl: c.template.thumbnailDataUrl,
        }));
    } else {
      const result = await workflow.savePrepared('enroll', {
        personId: s.person.id,
        signal: s.controller.signal,
        prepared,
      });
      if (token !== generation) {
        if (!result.persisted) workflow.discard(result.attemptId);
        return;
      }
      s.result = result;
      s.candidate = null;
      s.status = result.persisted ? 'saved' : 'save_failed';
      s.error = result.error ?? null;
      if (result.persisted) discovery.reset();
      display({ result });
    }
  }
  const api = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    async start() {
      if (processing) throw new Error('Previous frame is finishing. Try again.');
      api.stop();
      generation++;
      const token = generation;
      publish({
        status: 'loading',
        faces: [],
        sessions: [...sessions.values()].map(view),
        result: null,
        error: null,
        review: null,
        sessionId: crypto.randomUUID(),
      });
      await repository.load();
      if (repository.getSnapshot().mode !== 'writable') throw new Error('Use the writable tab.');
      await engine.initialize();
      if (token !== generation) return;
      tracker.reset();
      trackOffset = Math.max(0, ...sessions.keys());
      discovery.reset();
      previewMeters.clear();
      previewSeen.clear();
      invalidatedTracks.clear();
      poseSequence = 0;
      clockOffset = Date.now() - now();
      meterAvailable = false;
      try {
        await liveness.initialize({ blink: true, meter: true, numFaces: 10 });
        meterGeneration = liveness.generation ?? generation;
        meterAvailable = true;
      } catch {
        meterAvailable = false;
      }
      if (token !== generation) return;
      lastComparison = -Infinity;
      lastFrameAt = null;
      publish({ status: 'tracking' });
    },
    nameDetectedFace(options) {
      const token = generation;
      const bind = async () => {
        const {
          trackId,
          name,
          personId = null,
          acknowledged = false,
          guided = false,
          replaceTemplateId = null,
          sampleLabel = '',
        } = options;
        if (token !== generation || !['tracking', 'completed'].includes(state.status))
          throw new Error('Start live matching first.');
        const prior = sessions.get(trackId);
        if (prior && !['saved', 'completed', 'cancelled'].includes(prior.status))
          throw new Error('This face already has an enrollment in progress.');
        if (!acknowledged) throw new Error('Confirm browser-local storage.');
        if (
          [...sessions.values()].filter(
            (s) => !['saved', 'completed', 'cancelled'].includes(s.status),
          ).length >= 10
        )
          throw new Error(
            'Finish or discard one of the ten pending enrollments before starting another.',
          );
        const claimed = await discovery.claim({ trackId, personId, allowMultiple: true });
        const db = repository.getSnapshot().database,
          existing = personId && db.people.find((p) => p.id === personId && p.acknowledgedAt);
        const displayName = name?.trim();
        if (personId && !existing) throw new Error('Enrollment changed. Match again.');
        if (!existing && (!displayName || displayName.length > 120))
          throw new Error('Enter a name (1–120 characters).');
        if (
          !existing &&
          (db.people.some(
            (p) => p.displayName.trim().toLowerCase() === displayName.toLowerCase(),
          ) ||
            [...sessions.values()].some(
              (s) =>
                s.trackId !== trackId &&
                s.person.displayName.toLowerCase() === displayName.toLowerCase() &&
                !['cancelled'].includes(s.status),
            ))
        )
          throw new Error(
            'This name already exists or is being enrolled. Use a distinct name or match its record.',
          );
        if (
          existing &&
          [...sessions.values()].some(
            (s) => s.trackId !== trackId && s.person.id === existing.id && !terminal(s.status),
          )
        )
          throw new Error('This enrollee already has a capture in progress.');
        const samples = db.templates.filter((t) => t.personId === personId);
        if (
          (replaceTemplateId && !samples.some((s) => s.id === replaceTemplateId)) ||
          (!replaceTemplateId && samples.length + (guided ? 3 : 1) > 5)
        )
          throw new Error('Not enough sample slots.');
        const settings = structuredClone(db.settings);
        settings.enrollmentLiveness ??= structuredClone(DEFAULT_LIVENESS);
        if (livenessDisabled(settings.enrollmentLiveness))
          throw new Error('Enable at least one enrollment challenge in Settings');
        if (!meterAvailable) throw new Error('Liveness unavailable');
        await discovery.claim({ trackId, personId, allowMultiple: true });
        if (token !== generation) return;
        const id = crypto.randomUUID(),
          person = existing ?? {
            id,
            displayName,
            employeeCode: `FACE-${id}`,
            normalizedEmployeeCode: `face-${id}`,
            companyId: context.companyId,
            storeId: context.storeId ?? null,
            department: '',
            acknowledgedAt: new Date().toISOString(),
            enrollmentRevision: 0,
            createdAt: new Date().toISOString(),
          };
        const enrollmentSessionId = crypto.randomUUID();
        sessions.set(trackId, {
          trackId,
          id: enrollmentSessionId,
          meter: meterFactory({
            cameraSessionId: state.sessionId,
            enrollmentSessionId,
            trackId,
            workerGeneration: meterGeneration,
            assetIdentity: liveness.manifest?.sha256,
          }),
          person: structuredClone(person),
          newPerson: existing ? null : person,
          settings,
          manifest: structuredClone(engine.manifest),
          challenge: createActiveChallenge({ configuration: settings.enrollmentLiveness }),
          controller: new AbortController(),
          guided,
          replaceTemplateId,
          sampleLabel,
          captures: [],
          captureSetId: crypto.randomUUID(),
          candidate: null,
          hold: null,
          lastSeen: claimed.timestamp,
          maxFaces: faces.length,
          status: 'challenging',
        });
        display({ error: null });
      };
      const result = bindingQueue.then(bind);
      bindingQueue = result.catch(() => {});
      return result;
    },
    async observePose(frame, timestamp) {
      if (poseBusy || configuringPose || !meterAvailable || !faces.length) return;
      if (liveness.generation != null && liveness.generation !== meterGeneration) {
        meterAvailable = false;
        previewMeters.clear();
        previewSeen.clear();
        poses.clear();
        for (const s of sessions.values()) if (!terminal(s.status)) s.meter.reset();
        display();
        return;
      }
      poseBusy = true;
      const token = generation;
      try {
        const task = liveness.observe(frame, timestamp);
        poseTask = task;
        const result = await task;
        if (token !== generation) return;
        if (
          (liveness.generation != null && liveness.generation !== meterGeneration) ||
          lastFrameAt == null ||
          now() - lastFrameAt > 1500
        ) {
          meterAvailable = false;
          previewMeters.clear();
          previewSeen.clear();
          poses.clear();
          for (const s of sessions.values()) if (!terminal(s.status)) s.meter.reset();
          display();
          return;
        }
        const observations = result.faces ?? (result.box ? [result] : []);
        const associated = associateFacePoses(
          faces,
          observations.map((p) => ({ ...p, timestamp })),
        );
        for (const [id, match] of associated) match.pose = { ...match.pose, sourceTrackId: id };
        poses = associated;
        poseSequence++;
        for (const face of faces) {
          if (!previewMeters.has(face.trackId)) {
            previewMeters.set(
              face.trackId,
              meterFactory({
                cameraSessionId: state.sessionId,
                trackId: face.trackId,
                workerGeneration: meterGeneration,
                assetIdentity: liveness.manifest?.sha256,
              }),
            );
            previewSeen.set(face.trackId, timestamp);
          }
          if (invalidatedTracks.delete(face.trackId)) previewMeters.get(face.trackId).pause();
          const session = sessions.get(face.trackId);
          const meters = [previewMeters.get(face.trackId)];
          if (session && !terminal(session.status)) meters.push(session.meter);
          const match = associated.get(face.trackId);
          for (const meter of meters) {
            if (!match || face.ambiguous || face.reasonCode || now() - timestamp > 1500)
              meter.pause();
            else
              meter.update({
                ...match.pose,
                sequence: poseSequence,
                sourceTrackId: face.trackId,
                workerGeneration: meterGeneration,
                fresh: true,
                exclusive: true,
              });
          }
        }
        for (const s of sessions.values())
          if (!terminal(s.status)) {
            const match = associated.get(s.trackId);
            if (!match || now() - timestamp > 1500) {
              s.challenge.pause();
              continue;
            }
            s.challenge.update({ ...match.pose, fresh: true });
          }
        display();
      } catch (error) {
        if (token === generation) {
          meterAvailable = false;
          previewMeters.clear();
          previewSeen.clear();
          poses.clear();
          for (const s of sessions.values())
            if (!terminal(s.status)) {
              s.meter.reset();
              s.challenge.pause();
            }
          display({ error: `Liveness unavailable: ${error.message}` });
        }
      } finally {
        poseBusy = false;
        poseTask = null;
      }
    },
    async process(frame, timestamp) {
      if (processing || !['tracking', 'completed'].includes(state.status)) return;
      processing = true;
      const token = generation;
      try {
        if (repository.getSnapshot().mode !== 'writable')
          throw new Error('Browser storage is no longer writable.');
        const active = [...sessions.values()].some((s) => !terminal(s.status));
        const includeEmbedding =
          (discovery.needsEmbedding() || active) && timestamp - lastComparison >= 334;
        // Keep a private pixel copy. The recognition worker receives the camera
        // buffer, and the enrollment photo is encoded after that call returns.
        let photoFrame = frame;
        if (active && frame?.data?.length)
          try {
            photoFrame = {
              data: new Uint8ClampedArray(frame.data),
              width: frame.width,
              height: frame.height,
            };
          } catch {
            photoFrame = frame;
          }
        const extracted = await engine.analyzeFrame(frame, {
          includeEmbedding,
          analyzeAllFaces: true,
        });
        if (token !== generation) return;
        if (now() - timestamp > 1500) {
          for (const s of sessions.values())
            if (!terminal(s.status)) {
              s.challenge.pause();
              s.candidate = null;
              s.hold = null;
            }
          faces = [];
          discovery.reset();
          display({ error: 'Analysis delayed. Hold still.' });
          return;
        }
        faces = tracker
          .update(
            extracted.faces.map((f, i) => ({ ...f, detectionId: f.detectionId ?? i })),
            timestamp,
          )
          .faces.map((face) => ({ ...face, trackId: face.trackId + trackOffset }));
        lastFrameAt = timestamp;
        const vectors = includeEmbedding
          ? (extracted.faceEmbeddings ??
            (faces.length === 1 && extracted.embedding
              ? [{ detectionId: faces[0].detectionId, embedding: extracted.embedding }]
              : []))
          : [];
        if (vectors.length) lastComparison = timestamp;
        await discovery.observe(faces, null, timestamp, vectors);
        if (token !== generation) return;
        for (const s of sessions.values()) {
          if (terminal(s.status) && !faces.some((f) => f.trackId === s.trackId)) {
            s.detached = true;
            invalidateTrack(s.trackId);
          }
          if (!terminal(s.status)) {
            const face = faces.find((f) => f.trackId === s.trackId);
            if (!face) {
              s.meter.reset();
              s.candidate = null;
              s.hold = null;
              poses.delete(s.trackId);
            }
            if (face?.ambiguous || (!face && timestamp - s.lastSeen > 1500))
              cancelSession(s, 'Face association was lost. Confirm this person again.');
            if (face) {
              s.lastSeen = timestamp;
              s.maxFaces = Math.max(s.maxFaces, faces.length);
            }
          }
        }
        for (const id of previewMeters.keys())
          if (
            !faces.some((face) => face.trackId === id) &&
            timestamp - (previewSeen.get(id) ?? 0) > 1500
          ) {
            previewMeters.delete(id);
            previewSeen.delete(id);
            invalidateTrack(id);
          }
        for (const face of faces) previewSeen.set(face.trackId, timestamp);
        for (const [id, s] of sessions)
          if (
            !faces.some((face) => face.trackId === id) &&
            ['saved', 'completed', 'cancelled'].includes(s.status)
          )
            sessions.delete(id);
        display({ frameSize: [frame.width, frame.height], lastFrameAt: timestamp });
        if (
          [...sessions.values()].some((s) => !terminal(s.status)) &&
          !poseBusy &&
          !state.needsIndependentPose
        )
          await api.observePose(frame, timestamp);
        if (token !== generation) return;
        const freshAssociations = associateFacePoses(
          faces,
          [...poses.values()].map((match) => match.pose),
        );
        for (const s of sessions.values()) {
          if (terminal(s.status)) continue;
          const face = faces.find((f) => f.trackId === s.trackId),
            match = freshAssociations.get(s.trackId),
            live = s.challenge.snapshot();
          if (
            !face ||
            face.reasonCode ||
            face.ambiguous ||
            !match ||
            match.pose.sourceTrackId !== s.trackId ||
            now() - match.pose.timestamp > 1500 ||
            boxIoU(face.box, match.pose.box) < 0.35
          ) {
            s.hold = null;
            s.challenge.pause();
            s.status = 'quality_blocked';
            continue;
          }
          if (!valid(s)) {
            cancelSession(s, 'Enrollment changed. Confirm this person again.');
            continue;
          }
          if (!meterReady(s)) {
            s.status = 'challenging';
            continue;
          }
          if (
            !Number.isFinite(live.lastValidatedAt) ||
            now() - live.lastValidatedAt > 1500 ||
            timestamp < (live.passedAt ?? -Infinity) ||
            !inPose(s, match.pose.yaw, live)
          ) {
            s.hold = null;
            s.status = 'quality_blocked';
            continue;
          }
          const relative = match.pose.yaw - (live.neutralYaw ?? 0);
          if (!s.hold || Math.abs(s.hold.yaw - relative) > 5)
            s.hold = { yaw: relative, since: timestamp };
          s.status = 'preparing_enrollment';
          if (timestamp - s.hold.since < 300) continue;
          const vector = vectors.find((v) => v.detectionId === face.detectionId)?.embedding;
          if (!vector) continue;
          if (!s.candidate) {
            s.candidate = { embedding: [...vector], timestamp };
            continue;
          }
          if (cosineSimilarity(vector, s.candidate.embedding) <= 0.85) {
            s.error =
              'Hold the same face steady for a consistent capture. Previous passed checks are retained.';
            s.status = 'quality_blocked';
            continue;
          }
          s.error = null;
          try {
            await capture(s, face, vector, photoFrame, timestamp, match, token);
          } catch (error) {
            s.error = error.message;
            s.status = 'quality_blocked';
            s.candidate = null;
          }
          if (token !== generation) return;
        }
        display({ latencyMs: now() - timestamp });
      } finally {
        processing = false;
      }
    },
    async saveSet(labels, trackId) {
      const s = sessions.get(
        trackId ??
          [...sessions.values()].find((s) => ['review', 'set_save_failed'].includes(s.status))
            ?.trackId,
      );
      if (!s || !['review', 'set_save_failed'].includes(s.status)) return;
      if (!valid(s)) throw new Error('Enrollment changed. Discard and capture again.');
      if (labels.length !== 3 || labels.some((l) => !l.trim() || l.trim().length > 60))
        throw new Error('Each sample needs a label.');
      s.captures.forEach((c, i) => (c.template.label = labels[i].trim()));
      s.status = 'saving_set';
      display();
      try {
        await repository.commit({
          type: 'addSampleSet',
          personId: s.person.id,
          newPerson: s.newPerson,
          manifest: s.manifest,
          captures: s.captures.map((c) => ({ template: c.template, attempt: c.attempt })),
          captureSetId: s.captureSetId,
          expectedEnrollmentRevision: s.person.enrollmentRevision,
          signal: s.controller.signal,
        });
        s.status = 'completed';
        s.review = null;
        s.captures = [];
        discovery.reset();
      } catch (error) {
        s.status = 'set_save_failed';
        s.error = error.message;
      }
      display();
    },
    discardSet(trackId) {
      const s = sessions.get(trackId ?? [...sessions.values()].find((s) => s.review)?.trackId);
      if (s) {
        cancelSession(s, 'Sample set discarded.');
        s.status = 'completed';
        display();
      }
    },
    async retry(trackId) {
      const s = sessions.get(
        trackId ??
          [...sessions.values()].find((s) => s.result?.attemptId === state.result?.attemptId)
            ?.trackId,
      );
      if (!s || s.status !== 'save_failed') return;
      s.status = 'retrying';
      display();
      try {
        const result = await workflow.retrySave(s.result.attemptId);
        s.result = result;
        s.status = result.persisted ? 'saved' : 'save_failed';
        s.error = result.error ?? null;
        if (result.persisted) discovery.reset();
        display({ result });
      } catch (error) {
        s.status = 'save_failed';
        s.error = error.message;
        display();
      }
    },
    discard(trackId) {
      const s = sessions.get(
        trackId ??
          [...sessions.values()].find((s) => s.result?.attemptId === state.result?.attemptId)
            ?.trackId,
      );
      if (s && !s.result?.persisted) {
        workflow.discard(s.result?.attemptId);
        cancelSession(s, 'Unsaved capture discarded.');
      }
      display({
        result:
          trackId === undefined || s?.result?.attemptId === state.result?.attemptId
            ? null
            : state.result,
      });
    },
    cancelFace(trackId) {
      const s = sessions.get(trackId);
      if (s && !terminal(s.status)) {
        cancelSession(s, 'Enrollment cancelled for this face.');
        display();
      }
    },
    enroll() {
      return Promise.resolve();
    },
    stale() {
      const timestamp = now();
      let changed = false;
      for (const meter of previewMeters.values()) {
        const before = meter.snapshot().activity;
        meter.tick?.(timestamp);
        if (before && before.score !== meter.snapshot().activity?.score) changed = true;
      }
      for (const session of sessions.values())
        if (!terminal(session.status)) {
          const before = session.meter.snapshot().activity;
          session.meter.tick?.(timestamp);
          if (before && before.score !== session.meter.snapshot().activity?.score) changed = true;
        }
      if (lastFrameAt !== null && timestamp - lastFrameAt > 1500 && faces.length) {
        for (const face of faces) invalidateTrack(face.trackId);
        faces = [];
        previewMeters.clear();
        previewSeen.clear();
        poses.clear();
        discovery.reset();
        for (const s of sessions.values()) if (terminal(s.status)) s.detached = true;
        for (const s of sessions.values())
          if (!terminal(s.status))
            cancelSession(s, 'Camera analysis stopped. Confirm this face again.');
        display();
      } else if (changed) display();
    },
    fail(error) {
      api.stop();
      publish({ status: 'error', error: error.message });
    },
    stop() {
      generation++;
      for (const [id, s] of sessions) {
        if (
          ['review', 'saving_set', 'set_save_failed', 'save_failed', 'retrying'].includes(s.status)
        ) {
          s.detached = true;
          continue;
        }
        s.controller.abort();
        sessions.delete(id);
      }
      previewMeters.clear();
      previewSeen.clear();
      meterAvailable = false;
      faces = [];
      poses.clear();
      discovery.reset();
      tracker.reset();
      lastFrameAt = null;
      publish({
        status: 'stopped',
        faces: [],
        sessions: [...sessions.values()].map(view),
        needsIndependentPose: false,
        enrollmentPerson: null,
        discovery: null,
      });
    },
  };
  return api;
}

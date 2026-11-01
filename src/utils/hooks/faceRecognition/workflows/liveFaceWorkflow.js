import { DEFAULT_LIVENESS, CHALLENGE_POLICY, challengeReady } from '../liveness/livenessPolicy';
import { createFaceTracker, boxIoU } from '../recognition/faceTracker';
import { createActiveChallenge } from '../liveness/activeChallenge';
import { createStableWindow } from '../recognition/matchPolicy';
import { cosineSimilarity } from '../recognition/cosineSimilarity';
import { compatibleTemplate } from './faceWorkflow';
import { thumbnail } from '../recognition/imageQuality';
import { LIVE_TIMING } from '../recognition/liveTiming';
import { createEnrollmentDiscovery } from '../recognition/enrollmentDiscovery';

export function createLiveFaceWorkflow({
  repository,
  engine,
  liveness,
  workflow,
  context,
  now = () => performance.now(),
}) {
  const listeners = new Set(),
    tracker = createFaceTracker(),
    stable = createStableWindow();
  const discovery = createEnrollmentDiscovery({ repository, engine, context, now });
  let automaticEnrollment = false,
    binding = false;
  let challenge = createActiveChallenge(),
    poseTask = null,
    latestPose = null,
    poseEpoch = 0,
    poseHold = null;
  let state = {
    status: 'idle',
    faces: [],
    similarity: null,
    liveness: challenge.snapshot(),
    result: null,
    error: null,
  };
  let session,
    generation = 0,
    processing = false,
    lastComparison = -Infinity,
    trackId = null,
    lastFaceSeenAt = null,
    enrollmentCandidate = null,
    pipelineStartedAt = null,
    controller;
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  function clearEvidence() {
    if (session && challenge.snapshot().challengeId) session.acquiringSince = now();
    challenge.reset();
    latestPose = null;
    poseEpoch++;
    poseHold = null;
    if (session && !session.completed) session.captures = [];
    stable.reset();
    trackId = null;
    lastFaceSeenAt = null;
    enrollmentCandidate = null;
    if (session) {
      session.frame = null;
      session.enrollRequested = false;
    }
    publish({ similarity: null, review: null, liveness: challenge.snapshot() });
  }
  function pauseEvidence() {
    poseHold = null;
    challenge.pause();
    stable.reset();
    if (!hasEnrollmentCapture()) enrollmentCandidate = null;
    if (session) {
      session.frame = null;
      session.enrollRequested = false;
    }
    publish({ similarity: null, liveness: challenge.snapshot() });
  }
  function currentPass(live) {
    return (
      challengeReady(live) &&
      Number.isFinite(live.lastValidatedAt) &&
      live.lastValidatedAt <= now() &&
      now() - live.lastValidatedAt <= LIVE_TIMING.maxFrameAgeMs
    );
  }
  function valid() {
    const db = repository.getSnapshot().database;
    const person = db?.people.find((p) => p.id === session?.person.id);
    return (
      repository.getSnapshot().mode === 'writable' &&
      (session?.newPerson
        ? !person
        : person &&
          person.enrollmentRevision === session.person.enrollmentRevision &&
          person.acknowledgedAt === session.person.acknowledgedAt)
    );
  }
  function canEnroll() {
    return (
      hasEnrollmentCapture() &&
      lastFaceSeenAt !== null &&
      now() - lastFaceSeenAt <= LIVE_TIMING.maxFrameAgeMs &&
      state.faces.length === 1
    );
  }
  function hasEnrollmentCapture() {
    return (
      session?.purpose === 'enroll' &&
      !session.completed &&
      challengeReady(challenge.snapshot()) &&
      enrollmentCandidate?.trackId === trackId
    );
  }
  function rejectEnrollment(message) {
    session.enrollRequested = false;
    session.frame = null;
    publish({ status: 'ready_to_enroll', error: message, liveness: challenge.snapshot() });
  }
  function resumeDiscoveryAfterSave() {
    if (automaticEnrollment && !session?.guided) {
      session = null;
      discovery.reset();
      clearEvidence();
      publish({ enrollmentPerson: null, discovery: null });
    }
  }
  async function finish(outcome, extracted = {}, score = null, window = {}) {
    if (!session || session.completed) return;
    if (session.newPerson && outcome !== 'ENROLLED') {
      session.completed = true;
      publish({
        status: 'error',
        error: `Enrollment did not complete (${outcome.replaceAll('_', ' ')}). No person or sample was saved.`,
      });
      return;
    }
    if (!session.guided || outcome !== 'ENROLLED') session.completed = true;
    const token = generation,
      live = challenge.snapshot();
    publish({ status: 'saving' });
    let thumb = {};
    if (extracted.embedding && session.settings.saveThumbnails && session.frame)
      thumb = await thumbnail(session.frame, extracted.faces?.[0]);
    if (token !== generation) return;
    if (!valid()) throw new Error('Enrollment changed before saving. Start again.');
    const saveRequest = {
      personId: session.person.id,
      signal: controller.signal,
      prepared: {
        ...(session.newPerson ? { newPerson: session.newPerson } : {}),
        outcome,
        extracted: {
          ...extracted,
          ...thumb,
          reasonCode: outcome === 'NO_MATCH' ? 'BELOW_MATCH_THRESHOLD' : extracted.reasonCode,
        },
        similarity: score,
        sessionId: session.id,
        expectedEnrollmentRevision: session.person.enrollmentRevision,
        replaceTemplateId: session.replaceTemplateId,
        sampleLabel: session.sampleLabel,
        liveness: {
          ...live,
          method: 'configurable_enrollment',
          policyVersion: session.purpose === 'enroll' ? CHALLENGE_POLICY : 'head-turn-v2',
          sessionId: session.id,
          trackId,
          timingPolicyVersion: LIVE_TIMING.version,
          timingPolicy: LIVE_TIMING,
          assetIdentity: liveness.manifest?.sha256 ?? null,
        },
        metadata: {
          captureConsistency: extracted.captureConsistency ?? null,
          captureYaw: state.yaw ?? null,
          neutralYaw: live.neutralYaw ?? 0,
          startedAt: session.startedAt,
          decisionTimestamp: now(),
          trackId,
          faceCountAtDecision: state.faces.length,
          maxFaceCountObserved: session.maxFaces,
          stableSampleCount: window.count ?? 0,
          stableDurationMs: window.duration ?? 0,
          scoreAggregation: outcome === 'MATCH' ? 'minimum' : 'last',
        },
      },
    };
    if (session.guided && outcome === 'ENROLLED') {
      const operation = await workflow.prepareEnrollment(saveRequest);
      if (token !== generation) return;
      const index = session.captures.length;
      operation.template.version += index;
      operation.attempt.templateVersion = operation.template.version;
      operation.template.label = ['Front', 'Slight left', 'Slight right'][index];
      operation.template.captureSetId = session.captureSetId;
      operation.attempt.captureSetId = session.captureSetId;
      operation.attempt.capturePose = ['front', 'slight_left', 'slight_right'][index];
      session.captures.push(operation);
      session.enrollRequested = false;
      session.frame = null;
      enrollmentCandidate = null;
      poseHold = null;
      const sealed = session.captures.length === 3;
      session.completed = sealed;
      publish({
        status: sealed ? 'review' : 'preparing_enrollment',
        faces: sealed ? [] : state.faces,
        review: sealed
          ? session.captures.map((c) => ({
              label: c.template.label,
              thumbnailDataUrl: c.template.thumbnailDataUrl,
            }))
          : null,
        error: null,
        liveness: { ...challenge.snapshot(), prompt: capturePrompt() },
      });
      return;
    }
    const result = await workflow.savePrepared(session.purpose, saveRequest);
    if (token !== generation) return;
    session.frame = null;
    enrollmentCandidate = null;
    publish({ status: result.persisted ? 'completed' : 'save_failed', result, similarity: null });
    if (result.persisted) resumeDiscoveryAfterSave();
  }
  function capturePrompt() {
    return session?.guided
      ? [
          'Face forward — capture Front',
          'Turn slightly left (10–20°) — capture Slight left',
          'Turn slightly right (10–20°) — capture Slight right',
        ][session.captures.length]
      : 'Face forward for capture';
  }
  function capturePose(yaw, live) {
    const relative = yaw - (live.neutralYaw ?? 0);
    const stage = session?.guided ? session.captures.length : 0;
    return stage === 0
      ? Math.abs(relative) <= 10
      : stage === 1
        ? relative >= 10 && relative <= 20
        : relative <= -10 && relative >= -20;
  }
  async function readPose(frame, timestamp) {
    if (poseTask) return null;
    const epoch = poseEpoch;
    const task = liveness.observe(frame, timestamp);
    poseTask = task;
    try {
      const pose = await task;
      if (epoch !== poseEpoch) return null;
      return { ...pose, timestamp };
    } finally {
      if (poseTask === task) poseTask = null;
    }
  }
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    async start({
      personId,
      purpose = 'verify',
      replaceTemplateId = null,
      sampleLabel = '',
      guided = false,
      independentPose = false,
      automaticEnrollment: automatic = false,
    }) {
      if (processing) throw new Error('Previous analysis is finishing. Try again.');
      generation++;
      session = null;
      automaticEnrollment = automatic && purpose === 'enroll';
      discovery.reset();
      binding = false;
      tracker.reset();
      clearEvidence();
      lastComparison = -Infinity;
      controller = new AbortController();
      publish({
        status: 'loading',
        faces: [],
        result: null,
        error: null,
        review: null,
        analysisCompletedAt: null,
        lastFrameAt: null,
        latencyMs: null,
        discovery: null,
        enrollmentPerson: null,
      });
      const token = generation;
      await repository.load();
      if (repository.getSnapshot().mode !== 'writable')
        throw new Error('This tab cannot save. Use the writer tab.');
      const db = repository.getSnapshot().database,
        person = db.people.find((p) => p.id === personId);
      if (personId && !person?.acknowledgedAt)
        throw new Error('Select a person with browser storage acknowledged.');
      if (
        purpose === 'enroll' &&
        person &&
        !replaceTemplateId &&
        db.templates.filter((t) => t.personId === person.id).length >= 5
      )
        throw new Error('Five sample limit reached. Replace or delete a sample.');
      const configuration = structuredClone(db.settings.enrollmentLiveness ?? DEFAULT_LIVENESS);
      challenge = createActiveChallenge({ configuration });
      if (
        guided &&
        (replaceTemplateId ||
          !person ||
          db.templates.filter((t) => t.personId === person.id).length > 2)
      )
        throw new Error('Guided capture requires three free sample slots.');
      await engine.initialize();
      if (person) {
        try {
          await liveness.initialize({ blink: configuration.blink });
        } catch (error) {
          throw new Error(`Liveness unavailable: ${error.message}`);
        }
        const templates = db.templates.filter(
          (t) =>
            t.personId === person.id &&
            compatibleTemplate(t, engine.manifest) &&
            t.enrollmentSource !== 'test_image',
        );
        if (purpose === 'verify' && !templates.length)
          throw new Error(
            'Choose a compatible camera enrollment. Diagnostic templates cannot verify live faces.',
          );
        if (token !== generation) return;
        session = {
          id: crypto.randomUUID(),
          purpose,
          replaceTemplateId,
          sampleLabel,
          person: structuredClone(person),
          templates: structuredClone(templates),
          guided,
          independentPose: independentPose && configuration.blink,
          captures: [],
          captureSetId: crypto.randomUUID(),
          settings: structuredClone(db.settings),
          startedAt: new Date().toISOString(),
          acquiringSince: now(),
          maxFaces: 0,
          completed: false,
        };
      }
      if (token === generation) publish({ status: 'tracking', liveness: challenge.snapshot() });
    },
    async nameDetectedFace({
      name,
      trackId: requestedTrack,
      acknowledged = false,
      personId = null,
      replaceTemplateId = null,
      guided = false,
      sampleLabel = '',
    }) {
      if (!automaticEnrollment || session || binding || (state.result && !state.result.persisted))
        throw new Error('Start face matching before entering a name.');
      if (!acknowledged) throw new Error('Confirm browser-local storage before enrollment.');
      const displayName = name?.trim();
      if (!personId && (!displayName || displayName.length > 120))
        throw new Error('Enter a name (1–120 characters).');
      const token = generation;
      binding = true;
      try {
        const claimed = await discovery.claim({ trackId: requestedTrack, personId });
        const db = repository.getSnapshot().database;
        const existing = personId && db.people.find((p) => p.id === personId && p.acknowledgedAt);
        if (personId && !existing) throw new Error('Matched enrollment changed. Scan again.');
        if (
          !existing &&
          db.people.some((p) => p.displayName.trim().toLowerCase() === displayName.toLowerCase())
        )
          throw new Error(
            'This name already exists. Let that face match before adding another sample.',
          );
        const samples = db.templates.filter((t) => t.personId === personId);
        if (
          (replaceTemplateId && !samples.some((t) => t.id === replaceTemplateId)) ||
          (!replaceTemplateId && samples.length + (guided ? 3 : 1) > 5)
        )
          throw new Error('Not enough sample slots. Replace or delete a saved sample.');
        const configuration = structuredClone(db.settings.enrollmentLiveness ?? DEFAULT_LIVENESS);
        await liveness.initialize({ blink: configuration.blink });
        if (token !== generation) return;
        await discovery.claim({ trackId: requestedTrack, personId });
        if (token !== generation) return;
        const id = crypto.randomUUID();
        const person = existing ?? {
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
          updatedAt: new Date().toISOString(),
        };
        challenge = createActiveChallenge({ configuration });
        poseEpoch++;
        latestPose = null;
        poseHold = null;
        enrollmentCandidate = null;
        stable.reset();
        trackId = requestedTrack;
        lastFaceSeenAt = now();
        session = {
          id: crypto.randomUUID(),
          purpose: 'enroll',
          person: structuredClone(person),
          newPerson: existing ? null : person,
          templates: [],
          replaceTemplateId,
          sampleLabel,
          guided,
          independentPose: configuration.blink,
          captures: [],
          captureSetId: crypto.randomUUID(),
          settings: structuredClone(db.settings),
          startedAt: new Date().toISOString(),
          acquiringSince: now(),
          maxFaces: 1,
          completed: false,
          automatic: true,
        };
        publish({
          status: 'challenging',
          enrollmentPerson: person,
          error: null,
          liveness: challenge.snapshot(),
          discovery: { ...state.discovery, bound: true },
        });
      } finally {
        binding = false;
      }
    },
    async process(frame, timestamp) {
      if (
        processing ||
        ['idle', 'stopped', 'loading', 'error', 'review', 'saving_set', 'set_save_failed'].includes(
          state.status,
        )
      )
        return;
      processing = true;
      pipelineStartedAt = now();
      const token = generation;
      try {
        if (session && !session.completed && !valid())
          throw new Error('Person, enrollment or storage access changed. Start again.');
        const passed = challengeReady(challenge.snapshot());
        const enrollmentCaptureRequested = Boolean(
          session?.purpose === 'enroll' &&
            session.enrollRequested &&
            timestamp >= session.enrollRequestedAt,
        );
        const includeEmbedding = Boolean(
          automaticEnrollment && !session
            ? discovery.needsEmbedding() && timestamp - lastComparison >= 334
            : session &&
                !session.completed &&
                (session.purpose === 'enroll'
                  ? passed && (!enrollmentCandidate || enrollmentCaptureRequested)
                  : timestamp - lastComparison >= 334 &&
                    (!challenge.snapshot().challengeId || passed)),
        );
        const extracted = await engine.analyzeFrame(frame, {
          includeEmbedding,
          analyzeAllFaces: automaticEnrollment && !session,
        });
        if (token !== generation) return;
        if (now() - timestamp > LIVE_TIMING.maxFrameAgeMs) {
          clearEvidence();
          publish({ faces: [], status: session?.completed ? state.status : 'analysis_delayed' });
          return;
        }
        const tracked = tracker.update(
          extracted.faces.map((face, index) => ({
            ...face,
            detectionId: face.detectionId ?? index,
          })),
          timestamp,
        );
        publish({
          faces: tracked.faces,
          frameSize: [frame.width, frame.height],
          lastFrameAt: timestamp,
        });
        if (automaticEnrollment && !session) {
          if (includeEmbedding && (extracted.embedding || extracted.faceEmbeddings?.length))
            lastComparison = timestamp;
          const found = await discovery.observe(
            tracked.faces,
            includeEmbedding ? extracted.embedding : null,
            timestamp,
            includeEmbedding ? (extracted.faceEmbeddings ?? []) : [],
          );
          if (token !== generation) return;
          const { embedding: _probe, presentation, ...details } = found ?? {};
          const analyses = new Map(discovery.all().map((analysis) => [analysis.trackId, analysis]));
          publish({
            discovery: found ? details : null,
            similarity: found?.similarity ?? null,
            faces: tracked.faces.map((f) => ({
              ...f,
              identification: analyses.get(f.trackId)?.presentation ?? {
                status: 'waiting_for_analysis',
                similarity: null,
                closestCandidate: null,
              },
            })),
            status:
              tracked.faces.length > 1
                ? 'multiple_faces'
                : !tracked.faces.length
                  ? 'no_face'
                  : (found?.status ?? 'tracking'),
          });
          return;
        }
        if (
          automaticEnrollment &&
          session &&
          !session.completed &&
          (tracked.faces.length > 1 ||
            tracked.ambiguous ||
            (tracked.faces.length === 1 && tracked.faces[0].trackId !== trackId) ||
            (!tracked.faces.length &&
              lastFaceSeenAt !== null &&
              timestamp - lastFaceSeenAt > LIVE_TIMING.maxObservationGapMs))
        ) {
          session = null;
          clearEvidence();
          discovery.reset();
          publish({
            enrollmentPerson: null,
            discovery: null,
            status: 'tracking',
            error:
              'The tracked person left or became uncertain. Match the current face and confirm its name again.',
          });
          return;
        }
        if (!session || session.completed) return;
        session.maxFaces = Math.max(session.maxFaces, tracked.faces.length);
        if (
          !challenge.snapshot().challengeId &&
          (tracked.faces.length !== 1 || tracked.ambiguous) &&
          timestamp - session.acquiringSince >= 45000
        ) {
          await finish(
            tracked.faces.length > 1
              ? 'MULTIPLE_FACES'
              : !tracked.faces.length
                ? 'NO_FACE'
                : extracted.faces[0]?.reasonCode
                  ? 'LOW_QUALITY'
                  : 'INCONCLUSIVE',
          );
          return;
        }
        if (tracked.faces.length > 1 || tracked.ambiguous) {
          clearEvidence();
          publish({ status: tracked.faces.length > 1 ? 'multiple_faces' : 'quality_blocked' });
          return;
        }
        if (!tracked.faces.length) {
          if (
            lastFaceSeenAt !== null &&
            timestamp - lastFaceSeenAt > LIVE_TIMING.maxObservationGapMs
          )
            clearEvidence();
          else pauseEvidence();
          publish({ status: 'no_face' });
          return;
        }
        const face = tracked.faces[0];
        if (trackId !== null && trackId !== face.trackId) clearEvidence();
        trackId = face.trackId;
        lastFaceSeenAt = timestamp;
        session.acquiringSince = timestamp;
        if (hasEnrollmentCapture() && !enrollmentCaptureRequested) {
          publish({
            status: session.enrollRequested ? 'capturing_enrollment' : 'ready_to_enroll',
            liveness: challenge.snapshot(),
          });
          return;
        }
        if (extracted.faces[0]?.reasonCode) {
          if (enrollmentCaptureRequested && hasEnrollmentCapture()) {
            rejectEnrollment(
              'Capture quality is not ready. Face the camera in even lighting, then try enrollment again.',
            );
            return;
          }
          pauseEvidence();
          publish({ status: 'quality_blocked' });
          return;
        }
        // Detection keeps the same track while waiting. A click requests one new
        // pose observation; it must not restart the already completed challenge.
        if (enrollmentCaptureRequested && hasEnrollmentCapture() && !session.independentPose)
          challenge.pause();
        const pose =
          session.independentPose && latestPose && now() - latestPose.timestamp <= 200
            ? latestPose
            : await readPose(frame, timestamp);
        if (!pose) return;
        if (token !== generation) return;
        const fresh = now() - timestamp <= LIVE_TIMING.maxFrameAgeMs;
        if (!fresh) {
          clearEvidence();
          publish({ faces: [], status: 'analysis_delayed' });
          return;
        }
        if (!pose.box || boxIoU(pose.box, face.box) < 0.35 || !Number.isFinite(pose.yaw)) {
          if (enrollmentCaptureRequested && hasEnrollmentCapture()) {
            rejectEnrollment(
              'Keep your face in view and try enrollment again. Your completed steps are retained.',
            );
            return;
          }
          pauseEvidence();
          publish({ status: 'quality_blocked' });
          return;
        }
        const live = session.independentPose
          ? challenge.snapshot()
          : challenge.update({ ...pose, timestamp, fresh });
        const observation = {
          liveness: structuredClone(live),
          yaw: pose.yaw,
        };
        if (live.status === 'failed') {
          publish(observation);
          await finish('LIVENESS_FAILED');
          return;
        }
        if (live.status === 'expired') {
          publish(observation);
          await finish('LIVENESS_EXPIRED');
          return;
        }
        if (challengeReady(live) && !currentPass(live)) {
          stable.reset();
          enrollmentCandidate = null;
          publish({ ...observation, status: 'quality_blocked', similarity: null });
          return;
        }
        if (!fresh || !capturePose(pose.yaw, live)) {
          if (enrollmentCaptureRequested && hasEnrollmentCapture()) {
            rejectEnrollment(
              `${capturePrompt()}, then try enrollment again. Your completed steps are retained.`,
            );
            return;
          }
          stable.reset();
          poseHold = null;
          if (session.purpose === 'enroll') {
            session.frame = null;
            session.enrollRequested = false;
          }
          publish({
            ...observation,
            liveness: challengeReady(live) ? { ...live, prompt: capturePrompt() } : live,
            similarity: null,
            status: challengeReady(live) ? 'quality_blocked' : 'challenging',
          });
          return;
        }
        let matchWindow = null;
        let similarity = state.similarity;
        if (extracted.embedding) {
          lastComparison = timestamp;
          if (session.purpose === 'verify') {
            const score = Math.max(
              ...session.templates.map((t) => cosineSimilarity(extracted.embedding, t.embedding)),
            );
            similarity = score;
            if (challengeReady(live)) {
              matchWindow = stable.observe(score, timestamp);
            }
          } else if (challengeReady(live)) {
            if (
              enrollmentCaptureRequested &&
              enrollmentCandidate &&
              cosineSimilarity(extracted.embedding, enrollmentCandidate.embedding) <= 0.85
            ) {
              rejectEnrollment(
                'This capture differs from the completed challenge. Face the camera and try again, or restart for a different person.',
              );
              return;
            }
            const holdYaw = pose.yaw - (live.neutralYaw ?? 0);
            if (!poseHold || Math.abs(holdYaw - poseHold.yaw) > 5)
              poseHold = { startedAt: timestamp, yaw: holdYaw };
            if (timestamp - poseHold.startedAt < 300) {
              publish({
                status: 'preparing_enrollment',
                liveness: { ...live, prompt: capturePrompt() },
              });
              return;
            }
            if (!enrollmentCandidate)
              enrollmentCandidate = {
                trackId,
                capturedAt: timestamp,
                embedding: [...extracted.embedding],
              };
            if (enrollmentCaptureRequested) session.frame = frame;
          }
        }
        const status = !challengeReady(live)
          ? 'challenging'
          : session.purpose === 'verify'
            ? 'comparing'
            : session.enrollRequested
              ? 'capturing_enrollment'
              : canEnroll()
                ? 'ready_to_enroll'
                : 'preparing_enrollment';
        publish({
          ...observation,
          liveness: challengeReady(live) ? { ...live, prompt: capturePrompt() } : live,
          similarity,
          status,
        });
        if (session.automatic && status === 'ready_to_enroll' && !state.error) {
          session.enrollRequested = true;
          session.enrollRequestedAt = now();
          publish({ status: 'capturing_enrollment' });
        }
        if (matchWindow?.outcome) {
          session.frame = frame;
          await finish(matchWindow.outcome, extracted, matchWindow.score, matchWindow);
        } else if (
          session.purpose === 'enroll' &&
          enrollmentCaptureRequested &&
          extracted.embedding &&
          canEnroll()
        ) {
          extracted.captureConsistency = cosineSimilarity(
            extracted.embedding,
            enrollmentCandidate.embedding,
          );
          await finish('ENROLLED', extracted);
        }
      } finally {
        processing = false;
        pipelineStartedAt = null;
        if (token === generation)
          publish({ latencyMs: now() - timestamp, analysisCompletedAt: now() });
      }
    },
    async observePose(frame, timestamp) {
      if (
        !session?.independentPose ||
        session.completed ||
        poseTask ||
        state.faces.length !== 1 ||
        now() - state.lastFrameAt > LIVE_TIMING.maxFrameAgeMs ||
        state.faces[0].reasonCode
      )
        return;
      const token = generation,
        epoch = poseEpoch,
        boundTrack = trackId;
      const pose = await readPose(frame, timestamp);
      if (
        !pose ||
        token !== generation ||
        epoch !== poseEpoch ||
        boundTrack !== trackId ||
        !pose.box ||
        boxIoU(pose.box, state.faces[0]?.box ?? [0, 0, 0, 0]) < 0.35
      )
        return;
      latestPose = pose;
      const live = challenge.update({ ...pose, fresh: now() - timestamp <= 200 });
      publish({ liveness: challengeReady(live) ? { ...live, prompt: capturePrompt() } : live });
    },
    async saveSet(labels) {
      if (
        !session?.guided ||
        !session.completed ||
        session.captures.length !== 3 ||
        !['review', 'set_save_failed'].includes(state.status)
      )
        return;
      if (!valid()) throw new Error('Enrollment changed. Discard this set and capture again.');
      if (labels.length !== 3 || labels.some((l) => !l.trim() || l.trim().length > 60))
        throw new Error('Each sample needs a label (1–60 characters).');
      session.captures.forEach((c, i) => {
        c.template.label = labels[i].trim();
      });
      publish({ status: 'saving_set', error: null });
      try {
        await repository.commit({
          type: 'addSampleSet',
          personId: session.person.id,
          captureSetId: session.captureSetId,
          expectedEnrollmentRevision: session.person.enrollmentRevision,
          captures: session.captures.map((c) => ({ template: c.template, attempt: c.attempt })),
          ...(session.newPerson ? { newPerson: session.newPerson, manifest: engine.manifest } : {}),
          signal: controller.signal,
        });
        session.captures = [];
        publish({ status: 'completed', review: null, result: null });
      } catch (error) {
        publish({ status: 'set_save_failed', error: error.message });
      }
    },
    discardSet() {
      if (session) {
        session.captures = [];
        session.completed = true;
      }
      publish({ review: null, status: 'completed', error: null });
    },
    async enroll() {
      if (
        state.status !== 'ready_to_enroll' ||
        !canEnroll() ||
        now() - state.lastFrameAt > LIVE_TIMING.maxFrameAgeMs ||
        state.faces.length !== 1
      )
        throw new Error('Hold still and complete a fresh liveness check first.');
      session.enrollRequested = true;
      session.enrollRequestedAt = now();
      publish({ status: 'capturing_enrollment', error: null });
    },
    async retry() {
      if (!state.result || state.result.persisted) return;
      const result = await workflow.retrySave(state.result.attemptId);
      publish({ result, status: result.persisted ? 'completed' : 'save_failed' });
      if (result.persisted) resumeDiscoveryAfterSave();
    },
    discard() {
      if (state.result) workflow.discard(state.result.attemptId);
      publish({ result: null, status: 'completed' });
    },
    stale() {
      if (session?.completed) return;
      const stalled = processing
        ? now() - pipelineStartedAt > LIVE_TIMING.stalledAfterMs
        : state.analysisCompletedAt !== null &&
          now() - state.analysisCompletedAt > LIVE_TIMING.stalledAfterMs;
      if (state.faces.length && stalled) {
        if (automaticEnrollment) {
          session = null;
          discovery.reset();
          publish({ enrollmentPerson: null, discovery: null });
        }
        clearEvidence();
        publish({ faces: [], status: session?.completed ? state.status : 'analysis_delayed' });
      }
    },
    fail(error) {
      generation++;
      controller?.abort();
      session = null;
      discovery.reset();
      clearEvidence();
      publish({
        status: 'error',
        error: error.message,
        faces: [],
        discovery: null,
        enrollmentPerson: null,
      });
    },
    stop() {
      generation++;
      controller?.abort();
      session = null;
      discovery.reset();
      clearEvidence();
      publish({ status: 'stopped', faces: [], discovery: null, enrollmentPerson: null });
    },
  };
}

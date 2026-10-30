import { createFaceTracker, boxIoU } from '../recognition/faceTracker';
import { createActiveChallenge } from '../liveness/activeChallenge';
import { createStableWindow } from '../recognition/matchPolicy';
import { cosineSimilarity } from '../recognition/cosineSimilarity';
import { compatibleTemplate } from './faceWorkflow';
import { thumbnail } from '../recognition/imageQuality';
import { LIVE_TIMING } from '../recognition/liveTiming';

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
    challenge = createActiveChallenge(),
    stable = createStableWindow();
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
    stable.reset();
    trackId = null;
    lastFaceSeenAt = null;
    enrollmentCandidate = null;
    if (session) {
      session.frame = null;
      session.enrollRequested = false;
    }
    publish({ similarity: null, liveness: challenge.snapshot() });
  }
  function pauseEvidence() {
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
      live.status === 'passed_basic' &&
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
      person &&
      person.activeTemplateId === session.person.activeTemplateId &&
      JSON.stringify(person) === JSON.stringify(session.person)
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
      challenge.snapshot().status === 'passed_basic' &&
      enrollmentCandidate?.trackId === trackId
    );
  }
  function rejectEnrollment(message) {
    session.enrollRequested = false;
    session.frame = null;
    publish({ status: 'ready_to_enroll', error: message, liveness: challenge.snapshot() });
  }
  async function finish(outcome, extracted = {}, score = null, window = {}) {
    if (!session || session.completed) return;
    session.completed = true;
    const token = generation,
      live = challenge.snapshot();
    publish({ status: 'saving' });
    let thumb = {};
    if (extracted.embedding && session.settings.saveThumbnails && session.frame)
      thumb = await thumbnail(session.frame, extracted.faces?.[0]);
    if (token !== generation) return;
    if (!valid()) throw new Error('Enrollment changed before saving. Start again.');
    const result = await workflow.savePrepared(session.purpose, {
      personId: session.person.id,
      signal: controller.signal,
      prepared: {
        outcome,
        extracted: {
          ...extracted,
          ...thumb,
          reasonCode: outcome === 'NO_MATCH' ? 'BELOW_MATCH_THRESHOLD' : extracted.reasonCode,
        },
        similarity: score,
        sessionId: session.id,
        expectedTemplateId: session.person.activeTemplateId,
        liveness: {
          ...live,
          method: 'active_head_turn_v1',
          policyVersion: 'head-turn-v2',
          sessionId: session.id,
          trackId,
          timingPolicyVersion: LIVE_TIMING.version,
          timingPolicy: LIVE_TIMING,
          assetIdentity: liveness.manifest?.sha256 ?? null,
        },
        metadata: {
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
    });
    if (token !== generation) return;
    session.frame = null;
    enrollmentCandidate = null;
    publish({ status: result.persisted ? 'completed' : 'save_failed', result, similarity: null });
  }
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    async start({ personId, purpose = 'verify' }) {
      if (processing) throw new Error('Previous analysis is finishing. Try again.');
      generation++;
      session = null;
      tracker.reset();
      clearEvidence();
      lastComparison = -Infinity;
      controller = new AbortController();
      publish({
        status: 'loading',
        faces: [],
        result: null,
        error: null,
        analysisCompletedAt: null,
        lastFrameAt: null,
        latencyMs: null,
      });
      const token = generation;
      await repository.load();
      if (repository.getSnapshot().mode !== 'writable')
        throw new Error('This tab cannot save. Use the writer tab.');
      const db = repository.getSnapshot().database,
        person = db.people.find((p) => p.id === personId);
      if (personId && !person?.acknowledgedAt)
        throw new Error('Select a person with browser storage acknowledged.');
      await engine.initialize();
      if (person) {
        try {
          await liveness.initialize();
        } catch (error) {
          throw new Error(`Liveness unavailable: ${error.message}`);
        }
        const template = db.templates.find((t) => t.id === person.activeTemplateId);
        if (
          purpose === 'verify' &&
          (!compatibleTemplate(template, engine.manifest) ||
            template.enrollmentSource === 'test_image')
        )
          throw new Error(
            'Choose a compatible camera enrollment. Diagnostic templates cannot verify live faces.',
          );
        if (token !== generation) return;
        session = {
          id: crypto.randomUUID(),
          purpose,
          person: structuredClone(person),
          template: structuredClone(template),
          settings: { ...db.settings },
          startedAt: new Date().toISOString(),
          acquiringSince: now(),
          maxFaces: 0,
          completed: false,
        };
      }
      if (token === generation) publish({ status: 'tracking' });
    },
    async process(frame, timestamp) {
      if (processing || ['idle', 'stopped', 'loading', 'error'].includes(state.status)) return;
      processing = true;
      pipelineStartedAt = now();
      const token = generation;
      try {
        if (session && !session.completed && !valid())
          throw new Error('Person, enrollment or storage access changed. Start again.');
        const passed = challenge.snapshot().status === 'passed_basic';
        const enrollmentCaptureRequested = Boolean(
          session?.purpose === 'enroll' &&
            session.enrollRequested &&
            timestamp >= session.enrollRequestedAt,
        );
        const includeEmbedding = Boolean(
          session &&
            !session.completed &&
            (session.purpose === 'enroll'
              ? passed && (!enrollmentCandidate || enrollmentCaptureRequested)
              : timestamp - lastComparison >= 334 && (!challenge.snapshot().challengeId || passed)),
        );
        const extracted = await engine.analyzeFrame(frame, { includeEmbedding });
        if (token !== generation) return;
        if (now() - timestamp > LIVE_TIMING.maxFrameAgeMs) {
          clearEvidence();
          publish({ faces: [], status: session?.completed ? state.status : 'analysis_delayed' });
          return;
        }
        const tracked = tracker.update(extracted.faces, timestamp);
        publish({
          faces: tracked.faces,
          frameSize: [frame.width, frame.height],
          lastFrameAt: timestamp,
        });
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
        if (enrollmentCaptureRequested && hasEnrollmentCapture()) challenge.pause();
        const pose = await liveness.observe(frame, timestamp);
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
        const live = challenge.update({ yaw: pose.yaw, timestamp, fresh });
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
        if (live.status === 'passed_basic' && !currentPass(live)) {
          stable.reset();
          enrollmentCandidate = null;
          publish({ ...observation, status: 'quality_blocked', similarity: null });
          return;
        }
        if (!fresh || Math.abs(pose.yaw - (live.neutralYaw ?? 0)) > 10) {
          if (enrollmentCaptureRequested && hasEnrollmentCapture()) {
            rejectEnrollment(
              'Look straight ahead, then try enrollment again. Your completed steps are retained.',
            );
            return;
          }
          stable.reset();
          if (session.purpose === 'enroll') {
            session.frame = null;
            session.enrollRequested = false;
          }
          publish({
            ...observation,
            similarity: null,
            status: live.status === 'passed_basic' ? 'quality_blocked' : 'challenging',
          });
          return;
        }
        let matchWindow = null;
        let similarity = state.similarity;
        if (extracted.embedding) {
          lastComparison = timestamp;
          if (session.purpose === 'verify') {
            const score = cosineSimilarity(extracted.embedding, session.template.embedding);
            similarity = score;
            if (live.status === 'passed_basic') {
              matchWindow = stable.observe(score, timestamp);
            }
          } else if (live.status === 'passed_basic') {
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
            if (!enrollmentCandidate)
              enrollmentCandidate = {
                trackId,
                capturedAt: timestamp,
                embedding: [...extracted.embedding],
              };
            if (enrollmentCaptureRequested) session.frame = frame;
          }
        }
        const status =
          live.status !== 'passed_basic'
            ? 'challenging'
            : session.purpose === 'verify'
              ? 'comparing'
              : session.enrollRequested
                ? 'capturing_enrollment'
                : canEnroll()
                  ? 'ready_to_enroll'
                  : 'preparing_enrollment';
        publish({ ...observation, similarity, status });
        if (matchWindow?.outcome) {
          session.frame = frame;
          await finish(matchWindow.outcome, extracted, matchWindow.score, matchWindow);
        } else if (
          session.purpose === 'enroll' &&
          enrollmentCaptureRequested &&
          extracted.embedding &&
          canEnroll()
        ) {
          await finish('ENROLLED', extracted);
        }
      } finally {
        processing = false;
        pipelineStartedAt = null;
        if (token === generation)
          publish({ latencyMs: now() - timestamp, analysisCompletedAt: now() });
      }
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
      const result = await workflow.retrySave(state.result.attemptId);
      publish({ result, status: result.persisted ? 'completed' : 'save_failed' });
    },
    discard() {
      if (state.result) workflow.discard(state.result.attemptId);
      publish({ result: null, status: 'completed' });
    },
    stale() {
      const stalled = processing
        ? now() - pipelineStartedAt > LIVE_TIMING.stalledAfterMs
        : state.analysisCompletedAt !== null &&
          now() - state.analysisCompletedAt > LIVE_TIMING.stalledAfterMs;
      if (state.faces.length && stalled) {
        clearEvidence();
        publish({ faces: [], status: session?.completed ? state.status : 'analysis_delayed' });
      }
    },
    fail(error) {
      generation++;
      controller?.abort();
      session = null;
      clearEvidence();
      publish({ status: 'error', error: error.message, faces: [] });
    },
    stop() {
      generation++;
      controller?.abort();
      session = null;
      clearEvidence();
      publish({ status: 'stopped', faces: [] });
    },
  };
}

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
    lastExtracted = null,
    pipelineStartedAt = null,
    controller;
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  function clearEvidence() {
    challenge.reset();
    stable.reset();
    trackId = null;
    lastExtracted = null;
    if (session) {
      session.frame = null;
      session.enrollRequested = false;
      session.baselineEmbedding = null;
    }
    publish({ similarity: null, liveness: challenge.snapshot() });
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
        extracted: { ...extracted, ...thumb },
        similarity: score,
        sessionId: session.id,
        expectedTemplateId: session.person.activeTemplateId,
        liveness: {
          ...live,
          method: 'active_head_turn_v1',
          policyVersion: 'head-turn-v1',
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
    lastExtracted = null;
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
          start: now(),
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
        const comparing =
          session && !session.completed && challenge.snapshot().status === 'passed_basic';
        const includeEmbedding = Boolean(
          session &&
            !session.completed &&
            timestamp - lastComparison >= 334 &&
            (!challenge.snapshot().challengeId || comparing),
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
        if (timestamp - session.start >= 45000) {
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
        if (tracked.faces.length !== 1 || tracked.ambiguous || extracted.faces[0]?.reasonCode) {
          clearEvidence();
          publish({
            status:
              tracked.faces.length > 1
                ? 'multiple_faces'
                : !tracked.faces.length
                  ? 'no_face'
                  : 'quality_blocked',
          });
          return;
        }
        const face = tracked.faces[0];
        if (trackId !== null && trackId !== face.trackId) clearEvidence();
        trackId = face.trackId;
        const pose = await liveness.observe(frame, timestamp);
        if (token !== generation) return;
        const fresh = now() - timestamp <= LIVE_TIMING.maxFrameAgeMs;
        if (!fresh) {
          clearEvidence();
          publish({ faces: [], status: 'analysis_delayed' });
          return;
        }
        if (!pose.box || boxIoU(pose.box, face.box) < 0.35 || !Number.isFinite(pose.yaw)) {
          clearEvidence();
          publish({ status: 'quality_blocked' });
          return;
        }
        const live = challenge.update({ yaw: pose.yaw, timestamp, fresh });
        publish({
          liveness: structuredClone(live),
          status: live.status === 'passed_basic' ? 'comparing' : 'challenging',
          yaw: pose.yaw,
        });
        if (live.status === 'failed') {
          await finish('LIVENESS_FAILED');
          return;
        }
        if (live.status === 'expired') {
          await finish('LIVENESS_EXPIRED');
          return;
        }
        if (!fresh || Math.abs(pose.yaw) > 10) {
          stable.reset();
          publish({ similarity: null });
          return;
        }
        if (extracted.embedding) {
          lastComparison = timestamp;
          lastExtracted = extracted;
          if (live.status !== 'passed_basic') session.baselineEmbedding ??= extracted.embedding;
          if (
            live.status === 'passed_basic' &&
            (!session.baselineEmbedding ||
              cosineSimilarity(extracted.embedding, session.baselineEmbedding) <= 0.85)
          ) {
            clearEvidence();
            publish({ status: 'quality_blocked' });
            return;
          }
          if (session.purpose === 'verify') {
            const score = cosineSimilarity(extracted.embedding, session.template.embedding);
            publish({ similarity: score });
            if (live.status === 'passed_basic') {
              const window = stable.observe(score, timestamp);
              if (window.outcome) {
                session.frame = frame;
                await finish(window.outcome, extracted, window.score, window);
              }
            }
          } else if (live.status === 'passed_basic') {
            session.frame = frame;
            publish({ status: 'ready_to_enroll' });
            if (session.enrollRequested) await finish('ENROLLED', extracted);
          }
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
        !lastExtracted ||
        now() - state.lastFrameAt > LIVE_TIMING.maxFrameAgeMs ||
        now() > challenge.snapshot().expiresAt ||
        state.faces.length !== 1
      )
        throw new Error('Hold still and complete a fresh liveness check first.');
      session.enrollRequested = true;
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

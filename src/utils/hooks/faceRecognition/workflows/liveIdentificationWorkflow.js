import { buildEnrollmentGallery } from '../recognition/enrollmentGallery';
import {
  createIdentificationWindow,
  IDENTIFICATION_POLICY,
  MIN_MARGIN,
} from '../recognition/identificationPolicy';
import { createFaceTracker } from '../recognition/faceTracker';
import { percentage, SCORE_MAPPING } from '../recognition/matchPolicy';

export function createLiveIdentificationWorkflow({
  repository,
  engine,
  context,
  now = () => performance.now(),
}) {
  const listeners = new Set(),
    tracker = createFaceTracker(),
    tracks = new Map(),
    cooldown = new Map();
  let state = { status: 'idle', faces: [], gallery: null, recent: [], error: null, pending: null };
  let generation = 0,
    sessionId,
    controller,
    gallery,
    database,
    processing = false,
    pipelineAt,
    completedAt,
    embeddingTimes = [];
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  function clearTrack(t, status = 'searching') {
    t.window.reset();
    t.person = null;
    t.ranking = null;
    t.status = status;
    t.similarity = null;
    t.confirmedAt = null;
  }
  function resolveCandidate(candidate) {
    if (!candidate) return null;
    const entry = gallery?.entries.find(
      (e) =>
        e.personId === candidate.personId &&
        e.templateId === candidate.templateId &&
        e.templateVersion === candidate.templateVersion,
    );
    const person = database?.people.find((p) => p.id === candidate.personId);
    const template = database?.templates.find(
      (t) =>
        t.id === candidate.templateId &&
        t.personId === candidate.personId &&
        t.version === candidate.templateVersion,
    );
    if (!entry || !template || person?.activeTemplateId !== template.id) return null;
    return {
      ...candidate,
      personSnapshot: entry.personSnapshot,
      thumbnailDataUrl: template.thumbnailDataUrl ?? null,
    };
  }
  function display(faces = state.faces) {
    return faces.map((face) => {
      const t = tracks.get(face.trackId);
      return {
        ...face,
        identification: {
          status: t?.status ?? 'searching',
          person: t?.person ?? null,
          tracked: t?.confirmedAt != null,
          confirmedAt: t?.confirmedAt ?? null,
          closestCandidate: resolveCandidate(t?.ranking?.closestCandidate),
          similarity: t?.similarity ?? null,
          analyzedAt: t?.analyzedAt ?? null,
          ageMs: t?.analyzedAt == null ? null : Math.max(0, now() - t.analyzedAt),
        },
      };
    });
  }
  async function refreshGallery(token) {
    const snapshot = repository.getSnapshot();
    if (snapshot.mode !== 'writable')
      throw new Error('Storage is no longer writable. Use the writer tab.');
    if (snapshot.database === database) return false;
    const next = await buildEnrollmentGallery(snapshot.database, engine.manifest, context);
    if (token !== generation) return true;
    database = snapshot.database;
    if (gallery?.version === next.version) {
      if (gallery.excludedCount !== next.excludedCount)
        publish({
          gallery: { eligibleCount: next.entries.length, excludedCount: next.excludedCount },
        });
      gallery = next;
      return false;
    }
    const previousGallery = gallery;
    gallery = next;
    for (const t of tracks.values()) {
      const prior = previousGallery?.entries.find((e) => e.personId === t.person?.personId);
      const entry = next.entries.find((e) => e.personId === t.person?.personId);
      // Unrelated enrollments and display-only edits do not invalidate a
      // confirmed face. Its actual active biometric template must still match.
      const fingerprint = (e) =>
        JSON.stringify([
          e.templateId,
          e.templateVersion,
          e.embedding,
          e.modelIdentity,
          e.preprocessingVersion,
          e.enrollmentSource,
          e.enrollmentLiveness,
        ]);
      if (t.confirmedAt != null && prior && entry && fingerprint(prior) === fingerprint(entry))
        t.person = entry;
      else clearTrack(t);
    }
    cooldown.clear();
    await engine.setGallery(next);
    if (token === generation)
      publish({
        gallery: { eligibleCount: next.entries.length, excludedCount: next.excludedCount },
        faces: display(),
      });
    return true;
  }
  function eventFor(track, face, decision, count) {
    const person = gallery.entries.find((e) => e.personId === decision.personId);
    const { timestamp, classification, ...evidence } = decision;
    return {
      ...evidence,
      id: crypto.randomUUID(),
      sessionId,
      encounterId: track.encounterId,
      trackId: face.trackId,
      purpose: 'identify',
      source: 'live_camera',
      environment: context.environment,
      companyId: context.companyId,
      storeId: context.storeId ?? null,
      personId: person?.personId ?? null,
      personSnapshot: person?.personSnapshot ?? null,
      templateId: person?.templateId ?? null,
      templateVersion: person?.templateVersion ?? null,
      galleryVersion: gallery.version,
      eligibleCount: gallery.entries.length,
      matchPercentage: percentage(decision.similarity),
      thresholdSnapshot: 0.85,
      comparisonOperator: '>=',
      minMargin: MIN_MARGIN,
      decisionPolicyVersion: IDENTIFICATION_POLICY,
      scoreMappingVersion: SCORE_MAPPING,
      livenessStatus: 'not_checked',
      liveness: null,
      authoritative: false,
      probeEmbedding: null,
      thumbnailDataUrl: null,
      startedAt: track.startedAt,
      completedAt: new Date().toISOString(),
      decisionTimestamp: now(),
      recognitionAgeMs: now() - decision.samples[2].timestamp,
      modelIdentity: engine.manifest,
      preprocessingVersion: engine.manifest.preprocessingVersion,
      qualityPolicyVersion: engine.manifest.qualityPolicyVersion,
      quality: face.quality,
      timingsMs: { total: now() - pipelineAt },
      faceCountAtDecision: count,
    };
  }
  async function save(operation, token) {
    try {
      await repository.commit(operation);
      if (token === generation)
        publish({
          pending: null,
          error: null,
          recent: [
            { ...operation.event, persisted: true },
            ...state.recent.filter((r) => r.id !== operation.event.id),
          ].slice(0, 10),
        });
      return true;
    } catch (error) {
      if (token === generation)
        publish({
          status: 'save_failed',
          error: error.message,
          pending: operation,
          recent: [
            { ...operation.event, persisted: false },
            ...state.recent.filter((r) => r.id !== operation.event.id),
          ].slice(0, 10),
          faces: display(),
        });
      return false;
    }
  }
  const api = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    async start() {
      if (processing) throw new Error('Previous analysis is finishing. Try again.');
      if (state.pending) throw new Error('Retry or discard the unsaved scan first.');
      const token = ++generation;
      controller = new AbortController();
      sessionId = crypto.randomUUID();
      tracker.reset();
      tracks.clear();
      cooldown.clear();
      database = gallery = null;
      embeddingTimes = [];
      completedAt = null;
      publish({ status: 'loading', faces: [], error: null, recent: [], gallery: null });
      await repository.load();
      await engine.initialize();
      if (token !== generation) return;
      await refreshGallery(token);
      if (token === generation)
        publish({ status: gallery.entries.length ? 'scanning' : 'gallery_empty' });
    },
    async process(frame, timestamp) {
      if (processing || !['scanning', 'gallery_empty', 'save_failed'].includes(state.status))
        return;
      processing = true;
      pipelineAt = now();
      const token = generation,
        frameId = crypto.randomUUID();
      try {
        if (!state.pending) await refreshGallery(token);
        if (token !== generation) return;
        const detected = await engine.detectFrame(frame, frameId);
        if (token !== generation) return;
        if (now() - timestamp > 1500) {
          tracks.clear();
          publish({ faces: [], latencyMs: now() - timestamp });
          return;
        }
        const current = tracker.update(detected.faces, timestamp).faces;
        const visibleIds = new Set(current.map((f) => f.trackId));
        for (const [id, t] of tracks) if (!visibleIds.has(id)) clearTrack(t);
        for (const [id, t] of tracks) if (timestamp - t.seenAt > 1500) tracks.delete(id);
        for (const face of current) {
          let t = tracks.get(face.trackId);
          if (!t) {
            t = {
              window: createIdentificationWindow(),
              encounterId: crypto.randomUUID(),
              startedAt: new Date().toISOString(),
              logged: new Set(),
              lastCompared: -Infinity,
              status: 'searching',
              seenAt: timestamp,
            };
            tracks.set(face.trackId, t);
          }
          t.seenAt = timestamp;
          if (face.ambiguous) {
            clearTrack(t);
          } else if (t.confirmedAt != null) {
            // Continue detection/geometry tracking, but never rerun SFace for
            // this uninterrupted confirmed track, even if quality changes.
            continue;
          } else if (face.reasonCode || state.pending || !gallery.entries.length)
            clearTrack(
              t,
              face.reasonCode
                ? 'quality_blocked'
                : face.ambiguous
                  ? 'searching'
                  : !gallery.entries.length
                    ? 'gallery_empty'
                    : 'waiting_for_analysis',
            );
          else if (t.analyzedAt != null && timestamp - t.analyzedAt > 1500)
            clearTrack(t, 'waiting_for_analysis');
        }
        publish({ faces: display(current), frameSize: [frame.width, frame.height] });
        if (state.pending || !gallery.entries.length) return;
        embeddingTimes = embeddingTimes.filter((time) => timestamp - time < 1000);
        const selected = current
          .filter(
            (f) =>
              !f.reasonCode &&
              !f.ambiguous &&
              tracks.get(f.trackId).confirmedAt == null &&
              timestamp - tracks.get(f.trackId).lastCompared >= 334,
          )
          .sort(
            (a, b) =>
              tracks.get(a.trackId).lastCompared - tracks.get(b.trackId).lastCompared ||
              a.trackId - b.trackId,
          )
          .slice(0, Math.max(0, Math.min(2, 6 - embeddingTimes.length)));
        if (!selected.length) return;
        const version = gallery.version;
        const extracted = await engine.extractFaces(
          frameId,
          selected.map((f) => f.detectionId),
          version,
        );
        if (token !== generation) return;
        if (
          (await refreshGallery(token)) ||
          token !== generation ||
          extracted.galleryVersion !== version ||
          extracted.frameId !== frameId ||
          now() - timestamp > 1500
        ) {
          for (const t of tracks.values())
            if (now() - timestamp > 1500 || t.confirmedAt == null)
              clearTrack(t, 'waiting_for_analysis');
          publish({ faces: display(current) });
          return;
        }
        const decisions = [];
        for (const face of selected) {
          const t = tracks.get(face.trackId),
            result = extracted.results.find((r) => r.detectionId === face.detectionId);
          t.lastCompared = timestamp;
          embeddingTimes.push(timestamp);
          if (!result?.ranking) {
            clearTrack(t, 'waiting_for_analysis');
            continue;
          }
          const ranking = result.ranking;
          t.ranking = ranking;
          t.analyzedAt = timestamp;
          t.similarity = ranking.similarity;
          if (ranking.personId !== t.person?.personId) t.person = null;
          const decision = t.window.observe(
            ranking,
            timestamp,
            `${sessionId}:${face.trackId}:${version}`,
          );
          t.status = t.person ? 'identified' : 'searching';
          if (decision) {
            t.status = decision.outcome.toLowerCase();
            t.person = decision.personId
              ? gallery.entries.find((e) => e.personId === decision.personId)
              : null;
            decisions.push({ t, face, decision });
          }
        }
        const owners = new Map();
        for (const face of current) {
          const t = tracks.get(face.trackId),
            id = t?.person?.personId ?? t?.ranking?.personId;
          if (id && (t.confirmedAt != null || timestamp - t.analyzedAt <= 1500))
            owners.set(id, [...(owners.get(id) ?? []), t]);
        }
        for (const group of owners.values())
          if (group.length > 1) {
            const confirmed = group.filter((t) => t.confirmedAt != null);
            for (const t of group) {
              // A newly seen lookalike cannot revoke the original face's
              // confirmation. Conflicting unconfirmed tracks keep searching.
              if (confirmed.length === 1 && t === confirmed[0]) continue;
              t.person = null;
              t.confirmedAt = null;
              t.window.reset();
              t.status = 'identity_conflict';
            }
          }
        for (const { t, decision } of decisions) {
          if (decision.outcome === 'IDENTIFIED' && t.status !== 'identity_conflict') {
            t.confirmedAt = timestamp;
            t.similarity = decision.similarity;
            t.ranking.closestCandidate = {
              ...t.ranking.closestCandidate,
              similarity: decision.similarity,
            };
          }
        }
        publish({ status: 'scanning', faces: display(current) });
        for (const { t, face, decision } of decisions) {
          if (token !== generation) return;
          if (t.status === 'identity_conflict') continue;
          const key = `${version}:${decision.outcome}:${decision.personId ?? ''}`;
          if (t.logged.has(key)) continue;
          t.logged.add(key);
          if (t.logged.size > 200) t.logged.delete(t.logged.values().next().value);
          if (
            decision.personId &&
            timestamp - (cooldown.get(decision.personId) ?? -Infinity) < 10000
          )
            continue;
          const event = eventFor(t, face, decision, current.length);
          // Bind both calculations to the same decision instant.
          event.recognitionAgeMs = event.decisionTimestamp - decision.samples[2].timestamp;
          if (decision.personId) cooldown.set(decision.personId, timestamp);
          if (
            !(await save(
              {
                type: 'saveIdentification',
                event,
                manifest: engine.manifest,
                signal: controller.signal,
              },
              token,
            ))
          )
            break;
        }
      } finally {
        try {
          if (token === generation) {
            await engine.releaseFrame(frameId);
            completedAt = now();
            publish({ latencyMs: now() - timestamp });
          }
        } finally {
          processing = false;
          pipelineAt = null;
        }
      }
    },
    stale() {
      if (!['scanning', 'gallery_empty', 'save_failed'].includes(state.status)) return;
      const age = now() - (pipelineAt ?? completedAt ?? now());
      if (age > 5000) {
        api.fail(new Error('Recognition stopped responding. Start scanning again.'));
        return;
      }
      if (age > 1500) {
        for (const t of tracks.values()) clearTrack(t, 'waiting_for_analysis');
        publish({ faces: [] });
      } else {
        let changed = false;
        for (const t of tracks.values())
          if (
            (t.confirmedAt != null
              ? now() - t.seenAt > 1500
              : t.analyzedAt != null && now() - t.analyzedAt > 1500) &&
            t.status !== 'waiting_for_analysis'
          ) {
            clearTrack(t, 'waiting_for_analysis');
            changed = true;
          }
        if (changed) publish({ faces: display() });
      }
    },
    async retry() {
      if (!state.pending) return;
      const token = generation;
      if (await save({ ...state.pending, signal: undefined }, token)) {
        for (const t of tracks.values()) if (t.confirmedAt == null) clearTrack(t);
        if (token === generation) publish({ status: 'scanning' });
      }
    },
    discard() {
      const id = state.pending?.event.id;
      publish({
        pending: null,
        error: null,
        status: sessionId ? 'scanning' : 'stopped',
        recent: state.recent.filter((r) => r.id !== id),
      });
    },
    fail(error) {
      api.stop();
      publish({ status: 'error', error: error.message });
    },
    stop() {
      generation++;
      controller?.abort();
      sessionId = null;
      tracks.clear();
      tracker.reset();
      cooldown.clear();
      engine.dispose();
      publish({ status: 'stopped', faces: [] });
    },
  };
  return api;
}

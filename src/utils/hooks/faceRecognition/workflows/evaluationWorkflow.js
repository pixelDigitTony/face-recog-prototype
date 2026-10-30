import { buildEnrollmentGallery } from '../recognition/enrollmentGallery';
import { createFaceTracker } from '../recognition/faceTracker';
import { EVALUATION_POLICY } from '../recognition/evaluation';

export function createEvaluationWorkflow({
  repository,
  engine,
  context,
  now = () => performance.now(),
}) {
  const listeners = new Set(),
    tracker = createFaceTracker();
  let state = { status: 'idle', faces: [], count: 0, error: null, pending: null };
  let generation = 0,
    busy = false,
    trial,
    observations = [],
    last = -Infinity,
    trackId,
    lastDelivery = 0;
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  async function save(record, token) {
    const operation = { type: 'saveEvaluation', trial: record, manifest: engine.manifest };
    try {
      await repository.commit(operation);
      if (token === generation) publish({ status: 'completed', pending: null, error: null });
    } catch (error) {
      if (token === generation)
        publish({ status: 'save_failed', pending: operation, error: error.message });
    }
  }
  async function finish(status, reason, token = generation) {
    if (!trial) return;
    const record = {
      ...trial,
      status,
      reason,
      observations: status === 'completed' ? observations : [],
    };
    trial = null;
    publish({ status: 'saving' });
    await save(record, token);
  }
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    async start({ personId, participantLabel, notes = '' }) {
      if (busy || state.pending) throw new Error('Finish or discard the pending trial first.');
      const token = ++generation;
      await repository.load();
      if (repository.getSnapshot().mode !== 'writable') throw new Error('Use the writable tab.');
      if (repository.getSnapshot().database.evaluationTrials.length >= 100)
        throw new Error('100 trial limit reached. Delete or export trials first.');
      publish({ status: 'loading', faces: [], count: 0, error: null });
      await engine.initialize();
      const db = repository.getSnapshot().database;
      const person = personId ? db.people.find((p) => p.id === personId && p.acknowledgedAt) : null;
      if (personId && !person) throw new Error('Choose a consented enrollee.');
      const label = person ? person.displayName : participantLabel.trim();
      if (!label) throw new Error('Enter a participant label.');
      const gallery = await buildEnrollmentGallery(db, engine.manifest, context);
      if (token !== generation) return;
      trial = {
        id: crypto.randomUUID(),
        companyId: context.companyId,
        storeId: context.storeId ?? null,
        personId: personId || null,
        participantLabel: label,
        notes: notes.trim(),
        createdAt: new Date().toISOString(),
        policy: EVALUATION_POLICY,
        galleryVersion: gallery.version,
        modelIdentity: engine.manifest,
        preprocessingVersion: engine.manifest.preprocessingVersion,
        source: 'live_camera',
        livenessStatus: 'not_checked',
      };
      observations = [];
      last = -Infinity;
      trackId = null;
      tracker.reset();
      lastDelivery = now();
      publish({ status: 'capturing' });
    },
    async process(frame, timestamp) {
      if (busy || state.status !== 'capturing' || timestamp - last < 334) return;
      busy = true;
      last = timestamp;
      const token = generation;
      try {
        const result = await engine.analyzeFrame(frame, { includeEmbedding: true });
        if (token !== generation) return;
        lastDelivery = now();
        const faces = tracker.update(result.faces || [], timestamp).faces;
        publish({ faces, frameSize: [frame.width, frame.height] });
        const face = faces[0];
        if (
          now() - timestamp > 1500 ||
          faces.length !== 1 ||
          face.ambiguous ||
          face.reasonCode ||
          !result.embedding ||
          (trackId !== null && trackId !== face.trackId) ||
          (observations.length && timestamp - observations.at(-1).timestamp > 1500)
        ) {
          await finish(
            'capture_failed',
            face?.reasonCode ||
              (faces.length !== 1
                ? 'Exactly one face is required'
                : 'Face continuity or analysis was lost'),
            token,
          );
          return;
        }
        trackId = face.trackId;
        observations.push({
          embedding: [...result.embedding],
          timestamp,
          quality: face.quality || result.quality || {},
        });
        publish({ count: observations.length });
        if (observations.length === 3) await finish('completed', null, token);
      } catch (error) {
        if (token === generation) await finish('capture_failed', error.message, token);
      } finally {
        busy = false;
      }
    },
    stale() {
      if (state.status === 'capturing' && now() - lastDelivery > 5000)
        return finish('capture_failed', 'Camera analysis stopped delivering frames', ++generation);
    },
    async cancel(reason = 'Cancelled by operator') {
      if (state.status === 'saving' || state.pending) return;
      generation++;
      if (trial) await finish('cancelled', reason);
      else publish({ status: 'stopped', faces: [] });
    },
    async retry() {
      if (!state.pending) return;
      try {
        await repository.commit(state.pending);
        publish({ status: 'completed', pending: null, error: null });
      } catch (error) {
        publish({ error: error.message });
      }
    },
    discard() {
      trial = null;
      publish({ status: 'idle', pending: null, error: null });
    },
    stop() {
      generation++;
      trial = null;
      tracker.reset();
      lastDelivery = now();
      publish({ status: 'stopped', faces: [] });
    },
  };
}

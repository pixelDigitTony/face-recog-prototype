import { buildEnrollmentGallery } from './enrollmentGallery';
import { createIdentificationWindow, rankEmbedding } from './identificationPolicy';
import { LIVE_TIMING } from './liveTiming';

// Each visible track owns its analysis and stability evidence. Discovery never
// writes identification history; only a fresh single face can claim enrollment.
export function createEnrollmentDiscovery({ repository, engine, context, now }) {
  const tracks = new Map();
  let visible = [],
    database = null,
    gallery = null;
  const reset = () => {
    tracks.clear();
    visible = [];
    database = null;
    gallery = null;
  };
  const current = () =>
    visible.length === 1 ? (tracks.get(visible[0].trackId)?.current ?? null) : null;
  const clear = (track, face, timestamp, status = 'waiting_for_analysis') => {
    track.window.reset();
    track.current = {
      trackId: face.trackId,
      timestamp,
      analyzedAt: null,
      status,
      similarity: null,
      personId: null,
      rankingPersonId: null,
      confirmedAt: null,
      galleryVersion: gallery?.version,
      presentation: {
        status,
        similarity: null,
        person: null,
        closestCandidate: null,
        tracked: false,
      },
    };
  };
  function candidatePresentation(candidate) {
    if (!candidate) return null;
    const sample = database.templates.find(
      (t) => t.id === candidate.templateId && t.version === candidate.templateVersion,
    );
    const person = database.people.find((p) => p.id === candidate.personId);
    if (!sample || !person) return null;
    return {
      ...candidate,
      personSnapshot: { displayName: person.displayName, employeeCode: person.employeeCode },
      sampleLabel: sample.label,
      thumbnailDataUrl: sample.thumbnailDataUrl ?? null,
    };
  }
  return {
    reset,
    current,
    all: () => visible.map((face) => tracks.get(face.trackId)?.current).filter(Boolean),
    needsEmbedding: () =>
      !visible.length ||
      database !== repository.getSnapshot().database ||
      visible.some((face) => {
        const state = tracks.get(face.trackId)?.current;
        return !face.ambiguous && !face.reasonCode && state?.status !== 'identified';
      }),
    async observe(faces, embedding, timestamp, faceEmbeddings = []) {
      const db = repository.getSnapshot().database;
      if (database !== db || !gallery) {
        const next = await buildEnrollmentGallery(db, engine.manifest, context);
        if (gallery && next.version !== gallery.version) tracks.clear();
        database = db;
        gallery = next;
      }
      visible = faces;
      const ids = new Set(faces.map((face) => face.trackId));
      for (const id of tracks.keys()) if (!ids.has(id)) tracks.delete(id);
      for (const face of faces) {
        let track = tracks.get(face.trackId);
        if (!track) {
          track = { window: createIdentificationWindow(), current: null };
          tracks.set(face.trackId, track);
        }
        if (face.ambiguous) {
          clear(track, face, timestamp, 'waiting_for_analysis');
          continue;
        }
        const previous = track.current;
        if (previous?.status === 'identified') {
          track.current = {
            ...previous,
            timestamp,
            presentation: {
              ...previous.presentation,
              closestCandidate: candidatePresentation(previous.presentation.closestCandidate),
            },
          };
          continue;
        }
        if (face.reasonCode) {
          clear(track, face, timestamp, 'quality_blocked');
          continue;
        }
        const vector =
          faceEmbeddings.find((item) => item.detectionId === face.detectionId)?.embedding ??
          (faces.length === 1 ? embedding : null);
        if (!vector) {
          if (
            !previous ||
            timestamp - (previous.analyzedAt ?? -Infinity) > LIVE_TIMING.maxFrameAgeMs
          )
            clear(track, face, timestamp);
          continue;
        }
        const ranking = rankEmbedding(vector, gallery.entries) ?? {
          classification: 'UNKNOWN',
          similarity: null,
          personId: null,
          templateId: null,
          templateVersion: null,
        };
        const decision = track.window.observe(
          ranking,
          timestamp,
          `${face.trackId}:${gallery.version}`,
        );
        const status =
          decision?.outcome === 'IDENTIFIED'
            ? 'identified'
            : decision?.outcome === 'UNKNOWN'
              ? 'unknown'
              : ranking.classification === 'AMBIGUOUS'
                ? 'ambiguous'
                : 'checking';
        const personId = decision?.outcome === 'IDENTIFIED' ? decision.personId : null;
        track.current = {
          trackId: face.trackId,
          timestamp,
          analyzedAt: timestamp,
          galleryVersion: gallery.version,
          status,
          similarity: ranking.similarity,
          personId,
          rankingPersonId: ranking.personId,
          embedding: [...vector],
          confirmedAt: personId ? timestamp : null,
          presentation: {
            status: !gallery.entries.length ? 'gallery_empty' : status,
            similarity: ranking.similarity,
            tracked: !!personId,
            person: personId ? { personId } : null,
            closestCandidate: candidatePresentation(ranking.closestCandidate),
          },
        };
      }
      const owners = new Map();
      for (const track of tracks.values()) {
        const id = track.current?.personId ?? track.current?.rankingPersonId;
        if (id) owners.set(id, [...(owners.get(id) ?? []), track]);
      }
      for (const group of owners.values())
        if (group.length > 1) {
          const confirmed = group.filter(
            (t) => t.current.confirmedAt !== null && t.current.confirmedAt < timestamp,
          );
          const owner = confirmed.length === 1 ? confirmed[0] : null;
          for (const track of group)
            if (track !== owner) {
              track.window.reset();
              track.current = {
                ...track.current,
                status: 'identity_conflict',
                personId: null,
                confirmedAt: null,
                presentation: {
                  ...track.current.presentation,
                  status: 'identity_conflict',
                  person: null,
                  tracked: false,
                },
              };
            }
        }
      return current();
    },
    async claim({ trackId, personId = null, allowMultiple = false }) {
      const face = allowMultiple ? tracks.get(trackId)?.current : current();
      if (
        !face ||
        (!allowMultiple && visible.length !== 1) ||
        face.trackId !== trackId ||
        now() - face.timestamp > LIVE_TIMING.maxFrameAgeMs ||
        (personId
          ? face.status !== 'identified' || face.personId !== personId
          : face.status !== 'unknown')
      )
        throw new Error('Keep the same single face in view until matching finishes.');
      const next = await buildEnrollmentGallery(
        repository.getSnapshot().database,
        engine.manifest,
        context,
      );
      if (next.version !== face.galleryVersion) {
        reset();
        throw new Error('Enrollments changed. Let the face match again.');
      }
      return structuredClone(face);
    },
  };
}

import { LIVE_TIMING } from './liveTiming';

export function boxIoU(a, b) {
  const intersection =
    Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return intersection / Math.max(1, a[2] * a[3] + b[2] * b[3] - intersection);
}
export function createFaceTracker() {
  let tracks = [],
    nextId = 1;
  return {
    reset() {
      tracks = [];
      nextId = 1;
    },
    update(faces, now) {
      const previous = tracks.filter((t) => now - t.seenAt <= LIVE_TIMING.maxObservationGapMs);
      const candidatesByFace = faces.map((face) =>
        previous
          .map((t) => {
            const distance =
              Math.hypot(
                face.box[0] + face.box[2] / 2 - (t.box[0] + t.box[2] / 2),
                face.box[1] + face.box[3] / 2 - (t.box[1] + t.box[3] / 2),
              ) / Math.max(face.box[2], t.box[2], 1);
            return { t, overlap: boxIoU(face.box, t.box), distance };
          })
          .filter((c) => c.overlap > 0.2 && c.distance < 0.6)
          .sort(
            (a, b) => b.overlap - a.overlap || a.distance - b.distance || a.t.trackId - b.t.trackId,
          ),
      );
      const claims = new Map();
      const retired = new Set();
      for (const candidates of candidatesByFace) {
        for (const { t } of candidates) {
          claims.set(t.trackId, (claims.get(t.trackId) ?? 0) + 1);
          // An old box associated with a current detection must not survive as
          // a second ghost beside its replacement. Otherwise ambiguity feeds
          // itself and creates a new face ID on every subsequent frame.
          retired.add(t.trackId);
        }
      }
      const assignments = new Map(),
        used = new Set();
      const edges = candidatesByFace.flatMap((candidates, index) =>
        candidates.map((c) => ({ ...c, index })),
      );
      edges.sort(
        (a, b) =>
          b.overlap - a.overlap ||
          a.distance - b.distance ||
          a.t.trackId - b.t.trackId ||
          a.index - b.index,
      );
      for (const edge of edges) {
        if (!assignments.has(edge.index) && !used.has(edge.t.trackId)) {
          assignments.set(edge.index, edge.t.trackId);
          used.add(edge.t.trackId);
        }
      }
      const current = faces.map((face, index) => {
        const candidates = candidatesByFace[index];
        const uncertain =
          candidates.length > 1 || candidates.some((c) => claims.get(c.t.trackId) > 1);
        return {
          ...face,
          trackId: assignments.get(index) ?? nextId++,
          seenAt: now,
          ambiguous: uncertain,
        };
      });
      // An uncertain region also invalidates any overlapping current face.
      for (const face of current) {
        if (face.ambiguous) {
          for (const other of current) {
            if (other !== face && boxIoU(face.box, other.box) > 0.2) other.ambiguous = true;
          }
        }
      }
      tracks = [...current, ...previous.filter((t) => !retired.has(t.trackId))];
      return { faces: current, ambiguous: current.some((face) => face.ambiguous) };
    },
  };
}

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
      const previous = tracks.filter((t) => now - t.seenAt <= 1000);
      const used = new Set();
      let ambiguous = false;
      const current = faces.map((face) => {
        const candidates = previous
          .map((t) => {
            const distance =
              Math.hypot(
                face.box[0] + face.box[2] / 2 - (t.box[0] + t.box[2] / 2),
                face.box[1] + face.box[3] / 2 - (t.box[1] + t.box[3] / 2),
              ) / Math.max(face.box[2], t.box[2], 1);
            return { t, overlap: boxIoU(face.box, t.box), distance };
          })
          .filter((c) => c.overlap > 0.2 && c.distance < 0.6)
          .sort((a, b) => b.overlap - a.overlap);
        const candidate = candidates[0];
        const uncertain = candidates.length > 1 || (candidate && used.has(candidate.t.trackId));
        ambiguous ||= Boolean(uncertain);
        const trackId = candidate && !uncertain ? candidate.t.trackId : nextId++;
        used.add(trackId);
        return { ...face, trackId, seenAt: now };
      });
      tracks = [...current, ...previous.filter((t) => !used.has(t.trackId))];
      return { faces: current, ambiguous };
    },
  };
}

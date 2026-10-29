export function normalizeEmbedding(values) {
  const vector = Array.from(values);
  const norm = Math.hypot(...vector);
  if (vector.length !== 128 || !vector.every(Number.isFinite) || norm < 1e-10)
    throw new Error('Invalid SFace output.');
  return vector.map((n) => n / norm);
}
export function cosineSimilarity(a, b) {
  if (a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite))
    throw new Error('Incompatible embeddings.');
  const denominator = Math.hypot(...a) * Math.hypot(...b);
  if (!denominator) throw new Error('Zero-norm embedding.');
  return Math.max(-1, Math.min(1, a.reduce((sum, n, i) => sum + n * b[i], 0) / denominator));
}

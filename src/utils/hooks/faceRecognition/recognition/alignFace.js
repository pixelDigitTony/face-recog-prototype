// Least-squares similarity transform, equivalent to OpenCV's five-point Umeyama fit.
export const canonicalLandmarks = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];
export function similarityTransform(points, target = canonicalLandmarks) {
  if (points.length !== 5 || points.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
    throw new Error('Invalid landmarks.');
  const mean = (pts) => [0, 1].map((j) => pts.reduce((sum, p) => sum + p[j], 0) / pts.length);
  const [sx, sy] = mean(points),
    [tx, ty] = mean(target);
  let dot = 0,
    cross = 0,
    norm = 0;
  points.forEach(([x, y], i) => {
    const px = x - sx,
      py = y - sy,
      qx = target[i][0] - tx,
      qy = target[i][1] - ty;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    norm += px * px + py * py;
  });
  if (norm < 1e-8) throw new Error('Degenerate face landmarks.');
  const a = dot / norm,
    b = cross / norm;
  return [a, -b, tx - a * sx + b * sy, b, a, ty - b * sx - a * sy];
}
export function alignFace(cv, rgba, landmarks) {
  const transform = cv.matFromArray(2, 3, cv.CV_64F, similarityTransform(landmarks));
  const crop = new cv.Mat();
  try {
    cv.warpAffine(
      rgba,
      crop,
      transform,
      new cv.Size(112, 112),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );
    return crop;
  } catch (error) {
    crop.delete();
    throw error;
  } finally {
    transform.delete();
  }
}

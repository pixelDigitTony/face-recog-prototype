export function imageTensor(cv, ort, source, width, height, rgb = false) {
  const resized = new cv.Mat(),
    colors = new cv.Mat();
  try {
    cv.resize(source, resized, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
    cv.cvtColor(resized, colors, rgb ? cv.COLOR_RGBA2RGB : cv.COLOR_RGBA2BGR);
    const plane = width * height,
      data = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++)
      for (let c = 0; c < 3; c++) data[c * plane + i] = colors.data[i * 3 + c];
    return new ort.Tensor('float32', data, [1, 3, height, width]);
  } finally {
    resized.delete();
    colors.delete();
  }
}
function intersectionOverUnion(a, b) {
  // OpenCV converts boxes to Rect2i before NMS.
  const [ax, ay, aw, ah] = a.box.map(Math.trunc),
    [bx, by, bw, bh] = b.box.map(Math.trunc);
  const area =
    Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) *
    Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return area / Math.max(1, aw * ah + bw * bh - area);
}
export function decodeYuNet(outputs, width, height, policy, inputSize = 640) {
  const candidates = [];
  for (const stride of [8, 16, 32]) {
    const cls = outputs[`cls_${stride}`].data,
      obj = outputs[`obj_${stride}`].data;
    const bbox = outputs[`bbox_${stride}`].data,
      kps = outputs[`kps_${stride}`].data;
    const cols = inputSize / stride;
    for (let i = 0; i < cls.length; i++) {
      const confidence = Math.sqrt(
        Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i])),
      );
      if (confidence < policy.detectorThreshold) continue;
      const c = i % cols,
        r = Math.floor(i / cols);
      const w = Math.exp(bbox[i * 4 + 2]) * stride,
        h = Math.exp(bbox[i * 4 + 3]) * stride;
      candidates.push({
        confidence,
        box: [(c + bbox[i * 4]) * stride - w / 2, (r + bbox[i * 4 + 1]) * stride - h / 2, w, h],
        landmarks: Array.from({ length: 5 }, (_, n) => [
          (kps[i * 10 + n * 2] + c) * stride,
          (kps[i * 10 + n * 2 + 1] + r) * stride,
        ]),
      });
    }
  }
  const kept = [];
  for (const candidate of candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5000))
    if (kept.every((other) => intersectionOverUnion(candidate, other) <= policy.nmsThreshold))
      kept.push(candidate);
  return kept.map((face) => ({
    ...face,
    box: face.box.map((v, i) => (v * (i % 2 === 0 ? width : height)) / inputSize),
    landmarks: face.landmarks.map(([x, y]) => [(x * width) / inputSize, (y * height) / inputSize]),
  }));
}

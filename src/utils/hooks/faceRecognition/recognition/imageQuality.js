export function assessQuality(cv, source, face, policy) {
  const [x, y, w, h] = face.box;
  const left = Math.max(0, Math.floor(x)),
    top = Math.max(0, Math.floor(y));
  const width = Math.max(1, Math.min(source.cols - left, Math.floor(w))),
    height = Math.max(1, Math.min(source.rows - top, Math.floor(h)));
  const roi = source.roi(new cv.Rect(left, top, width, height)),
    gray = new cv.Mat(),
    lap = new cv.Mat();
  try {
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, lap, cv.CV_32F);
    let sum = 0,
      squares = 0,
      brightness = 0;
    for (const value of lap.data32F) {
      sum += value;
      squares += value * value;
    }
    for (const value of gray.data) brightness += value;
    const blurVariance = squares / lap.data32F.length - (sum / lap.data32F.length) ** 2;
    brightness /= gray.data.length;
    const metrics = {
      faceCount: 1,
      detectionConfidence: face.confidence,
      faceWidth: w,
      faceHeight: h,
      blurVariance,
      brightness,
      landmarks: face.landmarks,
      box: face.box,
    };
    const validLandmarks = face.landmarks.every(
      ([px, py]) => px >= 0 && px < source.cols && py >= 0 && py < source.rows,
    );
    const reasonCode = !validLandmarks
      ? 'LANDMARKS_OUT_OF_FRAME'
      : Math.min(w, h) < policy.minFacePixels
        ? 'FACE_TOO_SMALL'
        : blurVariance < policy.minBlurVariance
          ? 'BLURRED_FACE'
          : brightness < policy.minBrightness || brightness > policy.maxBrightness
            ? 'POOR_EXPOSURE'
            : null;
    return { metrics, reasonCode };
  } finally {
    roi.delete();
    gray.delete();
    lap.delete();
  }
}
export async function thumbnail(source, face) {
  try {
    const canvas = new OffscreenCanvas(96, 96),
      ctx = canvas.getContext('2d');
    const image = new OffscreenCanvas(source.width, source.height);
    image
      .getContext('2d')
      .putImageData(new ImageData(source.data, source.width, source.height), 0, 0);
    const box = face?.box || [0, 0, source.width, source.height];
    ctx.drawImage(image, ...box, 0, 0, 96, 96);
    for (const quality of [0.65, 0.4, 0.2]) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const dataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
      if (dataUrl.length <= 4096) return { thumbnailDataUrl: dataUrl };
    }
    return { thumbnailDataUrl: null, thumbnailOmissionReason: 'SIZE_LIMIT' };
  } catch {
    return { thumbnailDataUrl: null, thumbnailOmissionReason: 'ENCODING_UNAVAILABLE' };
  }
}

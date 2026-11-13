import { assessLighting } from './lightingQuality';

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
      lighting: assessLighting(gray.data, width, height, [x - left, y - top, w, h]),
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
function jpegDataUrl(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
function faceCrop(source, box) {
  const [x, y, w, h] = box;
  const left = Math.max(0, Math.min(source.width - 1, Math.floor(x)));
  const top = Math.max(0, Math.min(source.height - 1, Math.floor(y)));
  const width = Math.max(1, Math.min(source.width - left, Math.round(w)));
  const height = Math.max(1, Math.min(source.height - top, Math.round(h)));
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((top + row) * source.width + left) * 4;
    pixels.set(source.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { data: pixels, width, height };
}
export async function thumbnail(source, face) {
  try {
    if (!source?.width || !source?.height || source.data?.length < source.width * source.height * 4)
      return { thumbnailDataUrl: null, thumbnailOmissionReason: 'ENCODING_UNAVAILABLE' };
    const box =
      Array.isArray(face?.box) && face.box[2] > 1 && face.box[3] > 1
        ? face.box
        : [0, 0, source.width, source.height];
    const crop = faceCrop(source, box);
    const image = new OffscreenCanvas(crop.width, crop.height);
    image.getContext('2d').putImageData(new ImageData(crop.data, crop.width, crop.height), 0, 0);
    // Stored records reject thumbnails over 4096 characters, so keep shrinking
    // a real camera crop until one fits instead of saving the enrollment without a photo.
    for (const size of [96, 72, 48, 32]) {
      const canvas = new OffscreenCanvas(size, size);
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      for (const quality of [0.62, 0.4, 0.22, 0.12]) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        const dataUrl = jpegDataUrl(new Uint8Array(await blob.arrayBuffer()));
        if (dataUrl.length <= 4096) return { thumbnailDataUrl: dataUrl };
      }
    }
    return { thumbnailDataUrl: null, thumbnailOmissionReason: 'SIZE_LIMIT' };
  } catch {
    return { thumbnailDataUrl: null, thumbnailOmissionReason: 'ENCODING_UNAVAILABLE' };
  }
}

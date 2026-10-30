import { loadModels } from './modelLoader';
import { imageTensor, decodeYuNet } from './yunetAdapter';
import { alignFace } from './alignFace';
import { normalizeEmbedding } from './cosineSimilarity';
import { assessQuality, thumbnail } from './imageQuality';
import { rankEmbedding } from './identificationPolicy';

let models, retained;
let gallery = { version: null, entries: [] };
function releaseFrame() {
  retained?.source.delete();
  retained = null;
}
export async function handleWorkerRequest({ type, payload }) {
  if (type === 'initialize') {
    models ||= await loadModels(payload.baseUrl);
    return { ...models.manifest, recognizerOutputs: models.recognizerOutputs };
  }
  if (!models) throw new Error('Models are not initialized.');
  if (type === 'setGallery') {
    gallery = payload;
    return true;
  }
  if (type === 'releaseFrame') {
    if (retained?.id === payload.frameId) releaseFrame();
    return true;
  }
  if (type === 'extractFaces') {
    if (!retained || retained.id !== payload.frameId || gallery.version !== payload.galleryVersion)
      throw new Error('Obsolete recognition frame or gallery.');
    const { cv, ort, manifest, recognizer } = models;
    const results = [];
    for (const detectionId of [...new Set(payload.detectionIds)].slice(0, 2)) {
      const face = retained.faces.find((f) => f.detectionId === detectionId);
      if (!face || face.reasonCode) continue;
      let crop, input, output;
      try {
        const start = performance.now();
        crop = alignFace(cv, retained.source, face.landmarks);
        input = imageTensor(cv, ort, crop, 112, 112, true);
        output = await recognizer.run({ [manifest.recognizer.input]: input });
        const embedding = normalizeEmbedding(output[recognizer.outputNames[0]].data);
        results.push({
          detectionId,
          ranking: rankEmbedding(embedding, gallery.entries),
          embeddingMs: performance.now() - start,
        });
      } finally {
        crop?.delete();
        input?.dispose();
        Object.values(output || {}).forEach((t) => t.dispose());
      }
    }
    return { frameId: retained.id, galleryVersion: gallery.version, results };
  }
  if (!['extract', 'analyzeFrame', 'detectFrame'].includes(type))
    throw new Error('Unknown worker operation.');
  releaseFrame();
  const { cv, ort, manifest, detector, recognizer } = models;
  const frame = payload.frame,
    start = performance.now(),
    timingsMs = {};
  const source = cv.matFromImageData(new ImageData(frame.data, frame.width, frame.height));
  let crop,
    input,
    output,
    featureInput,
    featureOutput,
    keepSource = false;
  try {
    input = imageTensor(
      cv,
      ort,
      source,
      manifest.detector.dimensions[3],
      manifest.detector.dimensions[2],
    );
    const detectionStart = performance.now();
    output = await detector.run({ [manifest.detector.input]: input });
    const faces = decodeYuNet(output, frame.width, frame.height, manifest.qualityPolicy);
    timingsMs.detection = performance.now() - detectionStart;
    let result = {
      modelIdentity: manifest,
      preprocessingVersion: manifest.preprocessingVersion,
      qualityPolicyVersion: manifest.qualityPolicyVersion,
      quality: { faceCount: faces.length },
      faces: faces.map((face) => {
        const quality = assessQuality(cv, source, face, manifest.qualityPolicy);
        return { ...face, quality: quality.metrics, reasonCode: quality.reasonCode };
      }),
      timingsMs,
      embedding: null,
      outcome: faces.length === 0 ? 'NO_FACE' : faces.length > 1 ? 'MULTIPLE_FACES' : null,
    };
    if (type === 'detectFrame') {
      result.faces = result.faces.map((face, detectionId) => ({ ...face, detectionId }));
      retained = { id: payload.frameId, source, faces: result.faces };
      keepSource = true;
      timingsMs.total = performance.now() - start;
      return result;
    }
    if (faces.length === 1) {
      const quality = result.faces[0];
      result.quality = quality.quality;
      if (quality.reasonCode) {
        result.outcome = 'LOW_QUALITY';
        result.reasonCode = quality.reasonCode;
      } else if (payload.includeEmbedding !== false) {
        const alignStart = performance.now();
        crop = alignFace(cv, source, faces[0].landmarks);
        timingsMs.alignment = performance.now() - alignStart;
        featureInput = imageTensor(cv, ort, crop, 112, 112, true);
        const embeddingStart = performance.now();
        featureOutput = await recognizer.run({ [manifest.recognizer.input]: featureInput });
        result.embedding = normalizeEmbedding(featureOutput[recognizer.outputNames[0]].data);
        timingsMs.embedding = performance.now() - embeddingStart;
      }
    }
    if (payload.saveThumbnails) {
      const thumb = await thumbnail(frame, faces.length === 1 ? faces[0] : null);
      result.thumbnailDataUrl = thumb.thumbnailDataUrl;
      if (thumb.thumbnailOmissionReason)
        result.quality.thumbnailOmissionReason = thumb.thumbnailOmissionReason;
    }
    timingsMs.total = performance.now() - start;
    return result;
  } finally {
    if (!keepSource) source.delete();
    crop?.delete();
    input?.dispose();
    featureInput?.dispose();
    Object.values(output || {}).forEach((t) => t.dispose());
    Object.values(featureOutput || {}).forEach((t) => t.dispose());
  }
}

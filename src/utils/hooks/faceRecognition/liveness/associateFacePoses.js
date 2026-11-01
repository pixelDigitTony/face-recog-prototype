import { boxIoU } from '../recognition/faceTracker';

// MediaPipe result order is not a tracking identity. Require an exclusive,
// sufficiently separated geometric association for every pose observation.
export function associateFacePoses(faces, poses) {
  const claims = new Map(),
    choices = new Map();
  for (const face of faces) {
    if (face.ambiguous || face.reasonCode) continue;
    const matches = poses
      .map((pose, index) => ({ pose, index, iou: pose.box ? boxIoU(face.box, pose.box) : 0 }))
      .filter((item) => item.iou >= 0.35 && Number.isFinite(item.pose.yaw))
      .sort((a, b) => b.iou - a.iou);
    if (!matches.length || (matches[1] && matches[0].iou - matches[1].iou < 0.15)) continue;
    const match = matches[0];
    choices.set(face.trackId, match);
    claims.set(match.index, (claims.get(match.index) ?? 0) + 1);
  }
  return new Map([...choices].filter(([_id, match]) => claims.get(match.index) === 1));
}

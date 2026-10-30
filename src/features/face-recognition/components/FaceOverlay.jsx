import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { LivenessPrompt } from './LivenessPrompt';
import { ClosestRecord, identificationPresentation } from './ClosestRecord';
import { LightingFeedback } from './LightingFeedback';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
export function overlayBox(box, frameSize, size, mirrored = true) {
  const scale = Math.max(size[0] / frameSize[0], size[1] / frameSize[1]);
  const x = box[0] * scale - (frameSize[0] * scale - size[0]) / 2,
    y = box[1] * scale - (frameSize[1] * scale - size[1]) / 2;
  return {
    left: mirrored ? size[0] - x - box[2] * scale : x,
    top: y,
    width: box[2] * scale,
    height: box[3] * scale,
  };
}
function FaceLabel({
  face,
  box,
  size,
  showInstructions,
  liveness,
  status,
  actionLabel,
  similarity,
  maxLabelWidth,
  labelLeft,
}) {
  const ref = useRef(null),
    [height, setHeight] = useState(64);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setHeight(ref.current.getBoundingClientRect().height),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(0, Math.min(size[0] - 16, maxLabelWidth, Math.max(190, box.width)));
  const left =
    labelLeft ?? Math.max(8, Math.min(box.left + (box.width - width) / 2, size[0] - width - 8));
  const top = Math.max(8, Math.min(box.top - height - 14, size[1] - height - 16));
  return (
    <Box
      ref={ref}
      data-testid="face-label"
      data-track-id={face.trackId}
      sx={{
        position: 'absolute',
        left,
        top,
        width,
        maxHeight: Math.max(0, size[1] - 16),
        overflow: 'hidden',
        boxSizing: 'border-box',
        zIndex: 2,
        bgcolor: 'rgba(8,29,27,.88)',
        color: 'white',
        p: 1,
        borderRadius: 1,
        border: '1px solid rgba(255,255,255,.25)',
        overflowWrap: 'anywhere',
      }}
    >
      {showInstructions && (
        <Box sx={{ mb: 0.75 }}>
          <LivenessPrompt compact liveness={liveness} status={status} actionLabel={actionLabel} />
        </Box>
      )}
      <Box data-testid="face-label-details" sx={{ fontSize: 11, lineHeight: 1.4 }}>
        {face.identification && (
          <ClosestRecord identification={face.identification} compact={width < 160} />
        )}
        Face #{face.trackId} · Detection {(face.confidence * 100).toFixed(1)}%
        {similarity !== null && similarity !== undefined && (
          <>
            <br />
            {face.identification?.tracked ? 'Confirmed similarity: ' : 'Similarity: '}
            {formatPercentage(similarity)}
          </>
        )}
      </Box>
      <LightingFeedback lighting={face.quality?.lighting} guidance={showInstructions} />
    </Box>
  );
}

export function FaceOverlay({
  faces,
  frameSize,
  showInstructions = false,
  liveness,
  status,
  actionLabel,
  similarity = null,
}) {
  const ref = useRef(null),
    [size, setSize] = useState([0, 0]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize([entry.contentRect.width, entry.contentRect.height]),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <Box
      ref={ref}
      aria-hidden="true"
      sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {frameSize &&
        faces.map((face) => {
          // Give crowded labels disjoint horizontal slots in mirrored screen
          // order. The box and label retain the same track key as faces move.
          const columns = faces.length > 1;
          const ordered = columns
            ? [...faces].sort((a, b) => {
                const first = overlayBox(a.box, frameSize, size);
                const second = overlayBox(b.box, frameSize, size);
                return first.left + first.width / 2 - second.left - second.width / 2;
              })
            : [];
          const slot = ordered.findIndex((f) => f.trackId === face.trackId);
          const slotWidth = (size[0] - 16) / faces.length;
          const box = overlayBox(face.box, frameSize, size),
            blocked = face.identification
              ? [
                  'unknown',
                  'ambiguous',
                  'quality_blocked',
                  'identity_conflict',
                  'waiting_for_analysis',
                ].includes(face.identification.status)
              : faces.length > 1 || face.reasonCode;
          return (
            <Box key={face.trackId}>
              <Box
                data-testid="face-box"
                data-track-id={face.trackId}
                sx={{
                  position: 'absolute',
                  ...box,
                  border: '2px solid',
                  borderColor: face.identification
                    ? identificationPresentation(face.identification).color
                    : blocked
                      ? '#ffbf47'
                      : '#68c9ff',
                  borderRadius: 1,
                }}
              />
              <FaceLabel
                face={face}
                box={box}
                size={size}
                maxLabelWidth={columns ? Math.max(0, slotWidth - 8) : size[0] - 16}
                labelLeft={columns ? 12 + slot * slotWidth : undefined}
                showInstructions={showInstructions}
                liveness={liveness}
                status={faces.length > 1 ? 'multiple_faces' : status}
                actionLabel={actionLabel}
                similarity={
                  face.identification
                    ? face.identification.similarity
                    : faces.length === 1
                      ? similarity
                      : null
                }
              />
            </Box>
          );
        })}
      {showInstructions && faces.length === 0 && (
        <Box
          data-testid="no-face-instruction"
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 2,
            p: 1,
            borderRadius: 1,
            bgcolor: 'rgba(8,29,27,.88)',
            color: 'white',
          }}
        >
          <LivenessPrompt compact liveness={liveness} status={status} actionLabel={actionLabel} />
        </Box>
      )}
    </Box>
  );
}

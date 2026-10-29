import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
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
export function FaceOverlay({ faces, frameSize, similarity, status, person }) {
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
          const box = overlayBox(face.box, frameSize, size),
            blocked = faces.length > 1 || face.reasonCode;
          return (
            <Box
              key={face.trackId}
              data-testid="face-box"
              sx={{
                position: 'absolute',
                ...box,
                border: '2px solid',
                borderColor: blocked ? '#ffbf47' : '#68c9ff',
                borderRadius: 1,
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bgcolor: 'rgba(8,29,27,.9)',
                  color: 'white',
                  fontSize: 11,
                  p: 0.5,
                  lineHeight: 1.4,
                  maxWidth: Math.max(90, box.width),
                  overflowWrap: 'anywhere',
                }}
              >
                Face #{face.trackId} · Detection {(face.confidence * 100).toFixed(0)}%<br />
                {blocked
                  ? faces.length > 1
                    ? 'Multiple faces — paused'
                    : face.reasonCode.replaceAll('_', ' ')
                  : status.replaceAll('_', ' ')}
                {faces.length === 1 && person && (
                  <>
                    <br />
                    Verifying against {person.employeeCode}
                    <br />
                    Match {formatPercentage(similarity)}
                  </>
                )}
              </Box>
            </Box>
          );
        })}
    </Box>
  );
}

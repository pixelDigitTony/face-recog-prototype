import { Box, List, ListItem, Typography } from '@mui/material';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
import { ClosestRecord } from './ClosestRecord';
import { LightingFeedback } from './LightingFeedback';

export function DetectedFacesList({
  faces,
  similarity,
  status,
  person,
  liveness,
  identification = false,
}) {
  return (
    <>
      <Typography variant="h6">Detected faces ({faces.length})</Typography>
      <List aria-label="Detected faces" sx={{ maxHeight: 360, overflow: 'auto' }}>
        {faces.map((face) => (
          <ListItem key={face.trackId} data-track-id={face.trackId} divider disableGutters>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Face #{face.trackId} · Detection confidence {(face.confidence * 100).toFixed(1)}%
              </Typography>
              {identification ? (
                <>
                  <ClosestRecord identification={face.identification} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {face.identification.tracked ? 'Confirmed similarity: ' : 'Similarity: '}
                    {formatPercentage(face.identification.similarity)}
                    {face.identification.tracked || face.identification.ageMs == null
                      ? ''
                      : ` · ${Math.round(face.identification.ageMs)} ms ago`}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {faces.length > 1
                    ? 'Multiple faces — verification paused · Match: — · Liveness: not checked'
                    : `${face.reasonCode?.replaceAll('_', ' ') || status.replaceAll('_', ' ')}${person ? ` · Verifying against ${person.displayName} (${person.employeeCode})` : ''} · Match: ${formatPercentage(similarity)} · Liveness: ${liveness.status.replaceAll('_', ' ')}`}
                </Typography>
              )}
              <LightingFeedback lighting={face.quality?.lighting} guidance={!identification} />
            </Box>
          </ListItem>
        ))}
      </List>
      {!faces.length && (
        <Typography color="text.secondary" variant="body2">
          No current face detections.
        </Typography>
      )}
    </>
  );
}

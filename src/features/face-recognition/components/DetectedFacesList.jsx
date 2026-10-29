import { List, ListItem, ListItemText, Typography } from '@mui/material';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
export function DetectedFacesList({ faces, similarity, status, person, liveness }) {
  return (
    <>
      <Typography variant="h6">Detected faces ({faces.length})</Typography>
      <List aria-label="Detected faces" sx={{ maxHeight: 260, overflow: 'auto' }}>
        {faces.map((face) => (
          <ListItem key={face.trackId} divider disableGutters>
            <ListItemText
              primary={`Face #${face.trackId} · Detection confidence ${(face.confidence * 100).toFixed(1)}%`}
              secondary={
                faces.length > 1
                  ? 'Multiple faces — verification paused · Match: — · Liveness: not checked'
                  : `${face.reasonCode?.replaceAll('_', ' ') || status.replaceAll('_', ' ')}${person ? ` · Verifying against ${person.displayName} (${person.employeeCode})` : ''} · Match: ${formatPercentage(similarity)} · Liveness: ${liveness.status.replaceAll('_', ' ')}`
              }
            />
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

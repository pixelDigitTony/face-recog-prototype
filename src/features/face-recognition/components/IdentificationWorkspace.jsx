import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { useLiveFaceIdentification } from '@/utils/hooks/faceRecognition/useLiveFaceIdentification';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
import { RecordDetailsDialog } from '@/components/dialogs/faceRecognition/RecordDetailsDialog';
import { FaceOverlay } from './FaceOverlay';
import { DetectedFacesList } from './DetectedFacesList';

export const identificationStatus = (status) =>
  ({
    identified: 'Recognized',
    unknown: 'Unknown face',
    ambiguous: 'Ambiguous match',
    quality_blocked: 'Low image quality',
    waiting_for_analysis: 'Waiting for analysis',
    identity_conflict: 'Identity conflict',
    searching: 'Searching',
  })[status] ?? 'Searching';
export function IdentificationWorkspace() {
  const db = useLocalDatabase(),
    live = useLiveFaceIdentification();
  const [details, setDetails] = useState(null);
  const active = live.camera.active || live.starting;
  const announcement = live.faces
    .map(
      (f) =>
        `Face ${f.trackId}: ${identificationStatus(f.identification.status)}${f.identification.person ? `, ${f.identification.person.personSnapshot.displayName}` : ''}`,
    )
    .join('. ');
  return (
    <>
      <Typography variant="overline" color="primary">
        FACE LAB / AUTOMATIC IDENTIFICATION
      </Typography>
      <Typography variant="h4" sx={{ mt: 0.5, mb: 1 }}>
        Automatically find enrolled people.
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Faces are compared with enrollments saved in this browser.
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.35fr) minmax(0,1fr)' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Card>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
              <Chip
                label={
                  live.gallery
                    ? `${live.gallery.eligibleCount} eligible enrollments`
                    : 'Enrollments checked when scanning starts'
                }
              />
              {!!live.gallery?.excludedCount && (
                <Chip
                  variant="outlined"
                  label={`${live.gallery.excludedCount} excluded / incompatible`}
                />
              )}
            </Stack>
            {live.gallery?.eligibleCount === 0 && (
              <Alert
                severity="info"
                sx={{ mb: 2 }}
                action={
                  <Button component={Link} to="/enroll">
                    Enroll
                  </Button>
                }
              >
                No eligible enrollments. Face detection remains available.
              </Alert>
            )}
            <Box
              data-testid="live-camera"
              sx={{
                position: 'relative',
                aspectRatio: '4/3',
                bgcolor: '#102e28',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <Box
                component="video"
                ref={live.camera.videoRef}
                muted
                playsInline
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)',
                  visibility: live.camera.active ? 'visible' : 'hidden',
                }}
              />
              {!live.camera.active && (
                <Stack
                  sx={{ position: 'absolute', inset: 0, color: 'white', p: 3 }}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Typography variant="h6">Live camera preview</Typography>
                  <Typography variant="body2">Frames stay on this device.</Typography>
                </Stack>
              )}
              <FaceOverlay faces={live.faces} frameSize={live.frameSize} />
              {live.camera.active && (
                <Chip
                  size="small"
                  label={`${live.faces.length} faces · Live`}
                  sx={{ position: 'absolute', bottom: 12, left: 12, bgcolor: 'white' }}
                />
              )}
            </Box>
            <Stack direction="row" gap={1} sx={{ my: 2 }}>
              <Button
                variant="contained"
                onClick={live.start}
                disabled={active || db.mode !== 'writable' || Boolean(live.pending)}
                startIcon={live.starting ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {live.starting ? 'Loading recognition models…' : 'Start scanning'}
              </Button>
              <Button variant="outlined" onClick={live.stop} disabled={!active}>
                Stop
              </Button>
            </Stack>
            <Typography variant="caption" display="block">
              Similarity identification · Liveness not checked
            </Typography>
            <Typography variant="caption" display="block">
              Required: above 85% · Similarity score, not identity probability.
            </Typography>
            {live.error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {live.error}
              </Alert>
            )}
            {live.pending && (
              <Stack direction="row" gap={1} sx={{ mt: 1 }}>
                <Button onClick={live.retry}>Retry save</Button>
                <Button onClick={live.discard}>Discard unsaved result</Button>
              </Stack>
            )}
          </CardContent>
        </Card>
        <Stack gap={3}>
          <Card>
            <CardContent>
              <DetectedFacesList faces={live.faces} identification />
              <Box sx={visuallyHidden} role="status" aria-live="polite">
                {announcement}
              </Box>
              {live.latencyMs != null && (
                <Typography variant="caption">
                  Full analysis: {Math.round(live.latencyMs)} ms
                </Typography>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6">Recent scan results</Typography>
              <Typography variant="caption" color="text.secondary">
                Completed observations · separate from current faces
              </Typography>
              <Divider sx={{ my: 1 }} />
              <List aria-label="Recent scan results">
                {live.recent.map((event) => (
                  <ListItem
                    key={event.id}
                    disableGutters
                    divider
                    sx={{ gap: 1, alignItems: 'flex-start' }}
                  >
                    <ListItemText
                      primary={
                        event.personSnapshot
                          ? `Recognized: ${event.personSnapshot.displayName} (${event.personSnapshot.employeeCode})`
                          : event.outcome === 'UNKNOWN'
                            ? 'Unknown face'
                            : 'Ambiguous match'
                      }
                      secondary={`${formatPercentage(event.similarity)} · ${event.persisted ? 'Saved locally' : 'Not saved'} · Liveness not checked`}
                    />
                    <Button size="small" onClick={() => setDetails(event)}>
                      View
                    </Button>
                  </ListItem>
                ))}
              </List>
              {!live.recent.length && (
                <Typography color="text.secondary" sx={{ py: 3 }}>
                  No completed observations in this session.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Box>
      <RecordDetailsDialog record={details} onClose={() => setDetails(null)} />
    </>
  );
}

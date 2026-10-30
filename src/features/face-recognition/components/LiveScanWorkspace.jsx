import { EnrollmentSamples } from './EnrollmentSamples';
import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { visuallyHidden } from '@mui/utils';
import { useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { useLiveFaceTracking } from '@/utils/hooks/faceRecognition/useLiveFaceTracking';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
import { PersonDialog } from '@/components/dialogs/faceRecognition/PersonDialog';
import { FaceOverlay } from './FaceOverlay';
import { DetectedFacesList } from './DetectedFacesList';
import { LivenessPrompt } from './LivenessPrompt';
import { ScanResult } from './ScanResult';
import { CaptureWorkspace } from './CaptureWorkspace';

export function LiveScanWorkspace({ purpose = 'verify' }) {
  const db = useLocalDatabase(),
    [personId, setPersonId] = useState(''),
    [adding, setAdding] = useState(false),
    [diagnostic, setDiagnostic] = useState(false),
    [error, setError] = useState(null),
    [replaceTemplateId, setReplaceTemplateId] = useState(null),
    [sampleLabel, setSampleLabel] = useState('');
  const live = useLiveFaceTracking(personId, purpose, replaceTemplateId, sampleLabel);
  const enrollment = purpose === 'enroll',
    people =
      db.database?.people.filter(
        (p) =>
          enrollment ||
          db.database.templates.some(
            (t) => t.id === p.primaryTemplateId && t.enrollmentSource !== 'test_image',
          ),
      ) ?? [];
  const person = people.find((p) => p.id === personId) ?? null;
  const samples = db.database?.templates.filter((t) => t.personId === personId) ?? [];
  const actionLabel = replaceTemplateId
    ? 'Replace this sample'
    : samples.length
      ? 'Add face sample'
      : 'Capture & enroll';
  const atCapacity = enrollment && samples.length >= 5 && !replaceTemplateId;
  const active = live.camera.active || live.starting;
  useEffect(() => {
    if (
      replaceTemplateId &&
      live.result?.persisted &&
      !samples.some((s) => s.id === replaceTemplateId)
    )
      setReplaceTemplateId(null);
  }, [replaceTemplateId, live.result, samples]);
  async function enroll() {
    setError(null);
    try {
      await live.enroll();
    } catch (e) {
      setError(e.message);
    }
  }
  if (diagnostic)
    return (
      <>
        <Button onClick={() => setDiagnostic(false)} sx={{ mb: 2 }}>
          Return to live camera
        </Button>
        <Alert severity="info" sx={{ mb: 2 }}>
          Diagnostic images cannot pass liveness or produce a live match. Image enrollments are
          excluded from live verification.
        </Alert>
        <CaptureWorkspace purpose={purpose} />
      </>
    );
  return (
    <>
      <Typography variant="overline" color="primary">
        FACE LAB / {enrollment ? 'ENROLLMENT' : 'LIVE VERIFICATION'}
      </Typography>
      <Typography variant="h4" sx={{ mt: 0.5, mb: 1 }}>
        {enrollment ? 'Enroll with a live camera.' : 'A live view. A deliberate match.'}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Every detected face gets a box. Complete the motion challenge with one person in view.
      </Typography>
      {enrollment && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Use soft light facing you, avoid bright windows behind you and strong side shadows. Keep
          the camera at eye level and the lens clean. Lighting feedback is advisory.
        </Typography>
      )}
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
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <Autocomplete
                fullWidth
                options={people}
                value={person}
                disabled={active || Boolean(live.result && !live.result.persisted)}
                getOptionLabel={(p) => `${p.employeeCode} · ${p.displayName}`}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_, p) => {
                  setPersonId(p?.id ?? '');
                  setReplaceTemplateId(null);
                  setSampleLabel('');
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={enrollment ? 'Select a test person' : 'Select an enrolled person'}
                  />
                )}
              />
              {enrollment && (
                <Button
                  variant="outlined"
                  aria-label="Add person"
                  disabled={active || db.mode !== 'writable'}
                  onClick={() => setAdding(true)}
                >
                  <AddIcon />
                </Button>
              )}
            </Stack>
            {enrollment && person && (
              <>
                <EnrollmentSamples
                  person={person}
                  samples={samples}
                  disabled={
                    active ||
                    db.mode !== 'writable' ||
                    Boolean(live.result && !live.result.persisted)
                  }
                  replaceTemplateId={replaceTemplateId}
                  onReplace={setReplaceTemplateId}
                />
                <TextField
                  fullWidth
                  label="New sample label (optional)"
                  value={sampleLabel}
                  onChange={(e) => setSampleLabel(e.target.value)}
                  disabled={active}
                  slotProps={{ htmlInput: { maxLength: 60 } }}
                  sx={{ mb: 2 }}
                />
              </>
            )}
            {person &&
              db.database.templates.find((t) => t.id === person.primaryTemplateId)
                ?.enrollmentSource === 'legacy_unknown' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Enrollment liveness not checked. Re-enroll to record a camera challenge.
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
                  alignItems="center"
                  justifyContent="center"
                  spacing={1}
                >
                  <Typography variant="h6">Live camera preview</Typography>
                  <Typography variant="body2">
                    Start when you’re ready. Frames stay on this device.
                  </Typography>
                </Stack>
              )}
              <Box
                component="section"
                aria-label={person && active && !live.result ? 'Scan instructions' : undefined}
                sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <FaceOverlay
                  faces={live.faces}
                  frameSize={live.frameSize}
                  showInstructions={Boolean(person && active && !live.result)}
                  liveness={live.liveness}
                  status={live.status}
                  actionLabel={actionLabel}
                  similarity={live.similarity}
                />
                {person && active && !live.result && (
                  <Box sx={visuallyHidden}>
                    <LivenessPrompt
                      liveness={live.liveness}
                      status={live.status}
                      actionLabel={actionLabel}
                    />
                  </Box>
                )}
              </Box>
              {live.camera.active && (
                <Chip
                  label={`${live.faces.length} faces · Live`}
                  size="small"
                  sx={{ position: 'absolute', bottom: 12, left: 12, bgcolor: 'white' }}
                />
              )}
            </Box>
            <Stack direction="row" spacing={1} sx={{ my: 2 }} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={live.start}
                disabled={
                  active ||
                  atCapacity ||
                  db.mode !== 'writable' ||
                  Boolean(live.result && !live.result.persisted)
                }
                startIcon={live.starting ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {live.starting ? 'Loading camera models…' : 'Start live scan'}
              </Button>
              <Button variant="outlined" disabled={!active} onClick={live.stop}>
                Stop
              </Button>
              {(live.result?.persisted || live.status === 'completed') && live.camera.active && (
                <Button onClick={live.start}>Start next capture</Button>
              )}
            </Stack>
            {!person && (
              <Alert severity="info">
                {enrollment
                  ? 'Select or add a person to enroll.'
                  : 'Select a camera-enrolled person to verify. You can start with detection only.'}
              </Alert>
            )}
            {enrollment && (
              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2 }}
                disabled={live.status !== 'ready_to_enroll' || atCapacity}
                onClick={enroll}
              >
                {live.status === 'capturing_enrollment' || live.status === 'saving'
                  ? 'Saving enrollment…'
                  : actionLabel}
              </Button>
            )}
            {(live.error || live.camera.error || error) && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {live.error || live.camera.error || error}
              </Alert>
            )}
            <Divider sx={{ my: 2 }} />
            <Button
              size="small"
              disabled={active || Boolean(live.result && !live.result.persisted)}
              onClick={() => {
                live.stop();
                setDiagnostic(true);
              }}
            >
              Use test image
            </Button>
          </CardContent>
        </Card>
        <Stack spacing={3}>
          <Card>
            <CardContent>
              <Typography variant="overline">CURRENT MATCH SIMILARITY</Typography>
              <Typography variant="h3" sx={{ my: 1 }}>
                {formatPercentage(live.similarity)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Required: above 85% · Exactly 85% fails
              </Typography>
              {live.similarity !== null && (
                <Typography variant="caption">
                  Raw cosine {live.similarity.toFixed(6)} ·{' '}
                  {live.similarity > 0.85 ? 'Above cutoff' : 'At or below cutoff'}
                </Typography>
              )}
              <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                Similarity score, not identity probability. Liveness must also pass.
              </Typography>
              <Divider sx={{ my: 2 }} />
              <DetectedFacesList
                faces={live.faces}
                similarity={live.similarity}
                person={person}
                status={live.status}
                liveness={live.liveness}
              />
              {live.latencyMs != null && (
                <Typography variant="caption">
                  Full analysis: {Math.round(live.latencyMs)} ms
                </Typography>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Last completed attempt
              </Typography>
              <ScanResult workflow={{ ...live, error: null }} />
            </CardContent>
          </Card>
        </Stack>
      </Box>
      <PersonDialog
        key={String(adding)}
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={setPersonId}
      />
    </>
  );
}

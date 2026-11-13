import { LivenessMeter } from './LivenessMeter';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { useLiveFaceTracking } from '@/utils/hooks/faceRecognition/useLiveFaceTracking';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
import { FaceOverlay } from './FaceOverlay';
import { DetectedFacesList } from './DetectedFacesList';
import { EnrollmentSamples } from './EnrollmentSamples';
import { GuidedSampleReview } from './GuidedSampleReview';
import { ScanResult } from './ScanResult';
import { ClosestRecord } from './ClosestRecord';
import { LivenessPrompt } from './LivenessPrompt';

function EnrollmentTrackCard({ face, session, database, live, count }) {
  const [name, setName] = useState(''),
    [error, setError] = useState(null),
    [submitting, setSubmitting] = useState(false),
    [guided, setGuided] = useState(false),
    [replaceTemplateId, setReplaceTemplateId] = useState(null),
    [sampleLabel, setSampleLabel] = useState('');
  session ??= face?.enrollment;
  const trackId = face?.trackId ?? session.trackId;
  const matched =
    face?.discovery?.status === 'identified' &&
    database.people.find((p) => p.id === face.discovery.personId);
  const person = session?.person ?? matched;
  const samples = database.templates.filter((t) => t.personId === person?.id);
  const locked =
    submitting || (session && !['saved', 'completed', 'cancelled'].includes(session.status));
  const canName = face?.discovery?.status === 'unknown' && !locked && !matched;
  async function begin(personId = null) {
    setError(null);
    setSubmitting(true);
    try {
      await live.nameDetectedFace({
        trackId,
        name,
        personId,
        acknowledged: true,
        guided,
        replaceTemplateId,
        sampleLabel,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Box
      data-testid="enrollment-face-analysis"
      data-track-id={trackId}
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: face?.identification?.status === 'identified' ? 'success.main' : 'divider',
        borderRadius: 2,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <Typography fontWeight={700}>Face #{trackId} · Current match similarity</Typography>
      <Typography variant={count > 1 ? 'h4' : 'h3'} sx={{ my: 1 }}>
        {formatPercentage(face?.identification?.similarity)}
      </Typography>
      {face && <ClosestRecord identification={face.identification} />}
      <LivenessMeter
        meter={face?.meter ?? session?.meter}
        instructions
        passRate={database.settings?.livenessPassRate}
      />
      {!face && (
        <Typography>
          This face is outside the current feed. Its saved or sealed capture remains attached to
          Face #{trackId}.
        </Typography>
      )}
      {canName && (
        <Box
          component="form"
          sx={{ my: 2 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !submitting) begin();
          }}
        >
          <TextField
            fullWidth
            label={count === 1 ? "Detected person's name" : `Name for Face #${trackId}`}
            value={name}
            disabled={submitting}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            helperText="Press Enter to confirm this person agreed to browser-local storage and start their checks and automatic capture. Other faces can enroll at the same time."
          />
        </Box>
      )}
      {!locked && (canName || matched) && (
        <Stack spacing={1} sx={{ my: 2 }}>
          <ToggleButtonGroup
            exclusive
            value={guided ? 'guided' : 'single'}
            aria-label={`Enrollment capture mode for Face #${trackId}`}
            onChange={(_e, value) => {
              if (value) {
                setGuided(value === 'guided');
                setReplaceTemplateId(null);
              }
            }}
          >
            <ToggleButton value="single">Add one sample</ToggleButton>
            <ToggleButton value="guided" disabled={samples.length > 2}>
              Guided set — three samples
            </ToggleButton>
          </ToggleButtonGroup>
          <TextField
            label="New sample label (optional)"
            value={sampleLabel}
            disabled={guided}
            onChange={(e) => setSampleLabel(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
        </Stack>
      )}
      {session?.active && (
        <Box sx={{ my: 2 }}>
          <Typography fontWeight={700}>Enrolling {session.person.displayName}</Typography>
          <LivenessPrompt
            liveness={session.liveness}
            status={session.status}
            meter={session.meter}
            actionLabel="Automatic enrollment"
          />
        </Box>
      )}
      {session?.status === 'saved' && (
        <Alert severity="success" sx={{ my: 1 }}>
          Enrollment saved for {session.person.displayName}.
        </Alert>
      )}
      {session?.status === 'completed' && (
        <Alert severity="success" sx={{ my: 1 }}>
          Enrollment review completed for {session.person.displayName}.
        </Alert>
      )}
      {matched && !session?.active && (
        <Alert severity="success" sx={{ my: 1 }}>
          Already enrolled: {matched.displayName}. Add or replace a sample explicitly to keep this
          record.
        </Alert>
      )}
      {(error || session?.error) && (
        <Alert severity="error" sx={{ my: 1 }}>
          {error || session.error}
        </Alert>
      )}
      {person && samples.length > 0 && (
        <EnrollmentSamples
          person={database.people.find((p) => p.id === person.id) ?? person}
          samples={samples}
          disabled={!!locked}
          replaceTemplateId={replaceTemplateId}
          onReplace={(id) => {
            setGuided(false);
            setReplaceTemplateId(id);
          }}
        />
      )}
      {!locked && matched && (
        <Button
          variant="contained"
          disabled={!replaceTemplateId && samples.length + (guided ? 3 : 1) > 5}
          onClick={() => begin(matched.id)}
        >
          {replaceTemplateId
            ? 'Replace this sample'
            : guided
              ? 'Begin guided sample set'
              : 'Add face sample'}
        </Button>
      )}
      {session?.review && (
        <GuidedSampleReview
          samples={session.review}
          cameraContinues={live.camera.active}
          busy={session.status === 'saving_set'}
          onSave={(labels) => live.saveSet(labels, trackId)}
          onDiscard={() => live.discardSet(trackId)}
        />
      )}
      {session?.status === 'save_failed' && (
        <Stack direction="row" spacing={1}>
          <Button onClick={() => live.retry(trackId)}>Retry saving Face #{trackId}</Button>
          <Button onClick={() => live.discard(trackId)}>Discard Face #{trackId}</Button>
        </Stack>
      )}
      {session?.active && (
        <Button color="warning" onClick={() => live.cancelFace(trackId)}>
          Cancel enrollment for Face #{trackId}
        </Button>
      )}
      {!session && !canName && !matched && (
        <Typography variant="body2" color="text.secondary">
          Matching this face. Each person has separate checks and capture progress.
        </Typography>
      )}
    </Box>
  );
}
export function AutomaticEnrollmentWorkspace() {
  const db = useLocalDatabase(),
    live = useLiveFaceTracking('', 'enroll', null, '', false, true);
  const active = live.camera.active || live.starting;
  if (!db.database)
    return (
      <Stack spacing={2}>
        <Alert severity="warning">
          Browser data is unavailable. Use Settings to review storage recovery.
        </Alert>
        <Button disabled>Start live scan</Button>
      </Stack>
    );
  const sessionKey = (session) =>
    `session:${session.meter?.accepted?.enrollmentSessionId ?? `${session.trackId}:${session.person.id}`}`;
  const offscreen = (live.sessions ?? []).filter(
    (session) =>
      !live.faces.some(
        (face) => face.enrollment && sessionKey(face.enrollment) === sessionKey(session),
      ) &&
      ['review', 'saving_set', 'set_save_failed', 'save_failed', 'retrying'].includes(
        session.status,
      ),
  );
  const cards = [
    ...live.faces.map((face) => ({
      key: face.enrollment ? sessionKey(face.enrollment) : `face:${live.sessionId}:${face.trackId}`,
      face,
    })),
    ...offscreen.map((session) => ({ key: sessionKey(session), session })),
  ];
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Box>
        <Typography variant="overline">FACE LAB / ENROLLMENT</Typography>
        <Typography variant="h4">Enroll with a live camera.</Typography>
        <Typography color="text.secondary">
          Each tracked face can enroll independently. Enter a name in its match card and press
          Enter; follow the instructions attached to that face.
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Use soft frontal light and avoid backlighting or strong side shadows. Start with one
          clear, front-facing sample; add useful makeup, glasses or different-day variations. More
          samples are not automatically more accurate.
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.35fr) minmax(0,1fr)' },
          gap: 3,
          alignItems: 'start',
          minWidth: 0,
          '& > *': { minWidth: 0 },
        }}
      >
        <Card>
          <CardContent>
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
                >
                  <Typography variant="h6">Live camera preview</Typography>
                  <Typography>Start when you’re ready. Frames stay on this device.</Typography>
                </Stack>
              )}
              <Box
                component="section"
                aria-label="Enrollment instructions"
                sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <FaceOverlay
                  faces={live.faces}
                  frameSize={live.frameSize}
                  showInstructions
                  status={live.status}
                  liveness={live.liveness}
                  actionLabel="Automatic enrollment"
                  passRate={db.database.settings?.livenessPassRate}
                />
              </Box>
              {live.camera.active && (
                <Chip
                  label={`${live.faces.length} faces · Live`}
                  size="small"
                  sx={{ position: 'absolute', bottom: 12, left: 12, bgcolor: 'white' }}
                />
              )}
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
              <Button
                variant="contained"
                disabled={active || db.mode !== 'writable'}
                startIcon={live.starting ? <CircularProgress size={16} /> : null}
                onClick={live.start}
              >
                Start live scan
              </Button>
              <Button variant="outlined" disabled={!active} onClick={live.stop}>
                Stop
              </Button>
              {live.result?.persisted && active && (
                <Button
                  disabled={live.sessions?.some(
                    (s) => !['saved', 'completed', 'cancelled'].includes(s.status),
                  )}
                  onClick={live.start}
                >
                  Start next capture
                </Button>
              )}
            </Stack>
            <Typography role="status">{live.status.replaceAll('_', ' ')}</Typography>
            {(live.error || live.camera.error) && (
              <Alert severity="error">{live.error || live.camera.error}</Alert>
            )}
          </CardContent>
        </Card>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <Card>
            <CardContent>
              <Typography variant="overline">CURRENT MATCH SIMILARITY</Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                85% or above, with stability and uniqueness checks. Names, liveness and captures
                stay attached to their own face.
              </Typography>
              <Stack spacing={2}>
                {cards.map(({ key, face, session }) => (
                  <EnrollmentTrackCard
                    key={key}
                    face={face}
                    session={session}
                    database={db.database}
                    live={live}
                    count={live.faces.length}
                  />
                ))}
              </Stack>
              {!live.faces.length && !offscreen.length && (
                <Alert severity="info">
                  Keep faces in view while matching finishes. An unmatched face gets its own name
                  field here.
                </Alert>
              )}
              <Divider sx={{ my: 2 }} />
              <DetectedFacesList
                faces={live.faces}
                status={live.status}
                liveness={live.liveness}
                identification
                purpose="enroll"
                passRate={db.database.settings?.livenessPassRate}
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
              <Typography variant="h6">Last completed attempt</Typography>
              <ScanResult workflow={{ ...live, error: null }} />
            </CardContent>
          </Card>
        </Stack>
      </Box>
    </Stack>
  );
}

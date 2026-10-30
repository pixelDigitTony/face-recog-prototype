import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { useFaceServices, useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { useEvaluation } from '@/utils/hooks/faceRecognition/useEvaluation';
import { buildEnrollmentGallery } from '@/utils/hooks/faceRecognition/recognition/enrollmentGallery';
import {
  EVALUATION_THRESHOLDS,
  evaluationSummary,
  evaluateTrial,
} from '@/utils/hooks/faceRecognition/recognition/evaluation';
import { downloadJson } from '@/utils/hooks/faceRecognition/downloadJson';
import { FaceOverlay } from '../components/FaceOverlay';

const rate = (n, total) =>
  total ? `${n}/${total} (${((100 * n) / total).toFixed(1)}%)` : 'Unavailable (0 trials)';
const score = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
export function EvaluationPage() {
  const { repository, engine, context } = useFaceServices(),
    state = useLocalDatabase(),
    live = useEvaluation();
  const [personId, setPersonId] = useState(''),
    [participantLabel, setParticipantLabel] = useState(''),
    [notes, setNotes] = useState(''),
    [filter, setFilter] = useState(''),
    [mode, setMode] = useState('all'),
    [galleryVersion, setGalleryVersion] = useState(null),
    [currentGallery, setCurrentGallery] = useState(null),
    [error, setError] = useState(null),
    [loading, setLoading] = useState(false);
  const db = state.database,
    trials = db?.evaluationTrials ?? [];
  const active = ['loading', 'capturing', 'saving'].includes(live.status);
  useEffect(() => {
    let cancelled = false;
    if (!db || !engine.manifest) {
      setGalleryVersion(null);
      setCurrentGallery(null);
      return;
    }
    buildEnrollmentGallery(db, engine.manifest, context)
      .then((g) => {
        if (!cancelled) {
          setGalleryVersion(g.version);
          setCurrentGallery(g);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [db, engine, context, live.status, loading]);
  const filtered = trials.filter((t) =>
    `${t.participantLabel} ${t.notes}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const current = filtered.filter(
    (t) =>
      t.status === 'completed' && galleryVersion && t.report?.galleryVersion === galleryVersion,
  );
  const reports = useMemo(
    () =>
      currentGallery && engine.manifest
        ? current.map((t) => evaluateTrial(t, currentGallery, engine.manifest))
        : [],
    [db, galleryVersion, filter, currentGallery],
  );
  async function action(operation) {
    setError(null);
    try {
      await repository.commit(operation);
    } catch (e) {
      setError(e.message);
    }
  }
  async function rerun() {
    setLoading(true);
    try {
      await engine.initialize();
      await action({ type: 'rerunEvaluations', manifest: engine.manifest });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4">Evaluate recognition</Typography>
        <Typography color="text.secondary">
          Compare one reference against multiple samples using fresh, manually labeled trials.
          Experimental thresholds do not change Scan.
        </Typography>
      </Box>
      {(error || live.error) && <Alert severity="error">{error || live.error}</Alert>}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">New webcam trial · {trials.length}/100 saved</Typography>
            <TextField
              select
              label="Actual person"
              value={personId}
              disabled={active || !!live.pending}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <MenuItem value="">Not enrolled</MenuItem>
              {db?.people
                .filter((p) => p.acknowledgedAt)
                .map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.displayName} ({p.employeeCode})
                  </MenuItem>
                ))}
            </TextField>
            {!personId && (
              <TextField
                label="Participant label"
                value={participantLabel}
                disabled={active}
                onChange={(e) => setParticipantLabel(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 100 } }}
                helperText="Use the same label for repeat trials of this unenrolled participant."
              />
            )}
            <TextField
              label="Appearance / lighting notes"
              value={notes}
              disabled={active}
              onChange={(e) => setNotes(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <Box
              sx={{
                position: 'relative',
                aspectRatio: '4/3',
                maxWidth: 640,
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
                sx={{ width: '100%', height: '100%', transform: 'scaleX(-1)', objectFit: 'cover' }}
              />
              {!live.camera.active && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'white',
                    p: 2,
                    textAlign: 'center',
                  }}
                >
                  Start a fresh trial when ready. Completed results appear below.
                </Box>
              )}
              <FaceOverlay
                faces={live.camera.active ? live.faces : []}
                frameSize={live.frameSize}
                showInstructions={false}
              />
            </Box>
            <Typography role="status">
              {live.status} · {live.count}/3 observations. Keep one face in view. Liveness: not
              checked.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                disabled={
                  active ||
                  !!live.pending ||
                  loading ||
                  state.mode !== 'writable' ||
                  trials.length >= 100 ||
                  (!personId && !participantLabel.trim())
                }
                onClick={() => live.start({ personId, participantLabel, notes })}
              >
                Start trial
              </Button>
              <Button disabled={!active} onClick={() => live.cancel()}>
                Cancel trial
              </Button>
              {live.pending && (
                <>
                  <Button onClick={live.retry}>Retry saving trial</Button>
                  <Button onClick={live.discard}>Discard unsaved trial</Button>
                </>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      <Alert severity="info">
        Use separate capture sessions for enrollment and testing, including people who are not
        enrolled. Repeated trials of one participant are correlated. These results describe local
        tests, not certified accuracy. If a participant becomes enrolled later, delete their old Not
        enrolled trials before rerunning reports.
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button
          variant="outlined"
          disabled={active || loading || state.mode !== 'writable'}
          onClick={rerun}
        >
          {loading ? 'Evaluating…' : 'Rerun against current gallery'}
        </Button>
        <Button
          disabled={!trials.length}
          onClick={() =>
            downloadJson(
              JSON.stringify(
                {
                  policy: 'evaluation-multisample-v1',
                  currentGalleryVersion: galleryVersion,
                  trials: filtered,
                  experimentalReports: reports,
                },
                null,
                2,
              ),
              'anthonys-face-lab-evaluation.json',
            )
          }
        >
          Export evaluation
        </Button>
        <Button
          color="error"
          disabled={active || !trials.length || state.mode !== 'writable'}
          onClick={() => {
            if (window.confirm('Delete all evaluation trials?'))
              action({ type: 'clearEvaluations' });
          }}
        >
          Clear evaluation data
        </Button>
      </Stack>
      <TextField
        label="Filter participant / notes"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <Typography>
        {filtered.length} trials ·{' '}
        {new Set(filtered.map((t) => t.personId || `unknown:${t.participantLabel}`)).size} distinct
        labeled participants · {filtered.filter((t) => t.status !== 'completed').length} capture
        failures/cancellations ·{' '}
        {
          filtered.filter(
            (t) => t.status === 'completed' && t.report?.galleryVersion !== galleryVersion,
          ).length
        }{' '}
        outdated/incompatible reports
      </Typography>
      <TextField
        select
        label="Reference mode"
        value={mode}
        onChange={(e) => setMode(e.target.value)}
      >
        <MenuItem value="primary">Primary sample only</MenuItem>
        <MenuItem value="all">All samples</MenuItem>
      </TextField>
      <TableContainer component={Card}>
        <Table size="small" aria-label="Experimental threshold comparison">
          <TableHead>
            <TableRow>
              {[
                'Threshold',
                'Correct enrolled',
                'Missed enrolled',
                'Wrong person',
                'Unenrolled accepted',
                'Unenrolled rejected',
                'Excluded',
              ].map((h) => (
                <TableCell key={h}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {EVALUATION_THRESHOLDS.map((threshold) => {
              const c = evaluationSummary(reports, mode, threshold);
              return (
                <TableRow key={threshold} selected={threshold === 0.85}>
                  <TableCell>
                    {Math.round(threshold * 100)}%{threshold === 0.85 && ' · Scan boundary'}
                  </TableCell>
                  <TableCell>{rate(c.correct, c.enrolled)}</TableCell>
                  <TableCell>{rate(c.missed, c.enrolled)}</TableCell>
                  <TableCell>{rate(c.wrong_person, c.enrolled)}</TableCell>
                  <TableCell>{rate(c.unenrolled_accepted, c.unenrolled)}</TableCell>
                  <TableCell>{rate(c.unenrolled_rejected, c.unenrolled)}</TableCell>
                  <TableCell>{c.excluded}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="h6">Saved trials · outcomes at 85%</Typography>
      {filtered.map((t) => (
        <Card key={t.id}>
          <CardContent>
            <Typography fontWeight={700}>
              {t.participantLabel} · {new Date(t.createdAt).toLocaleString()}
            </Typography>
            <Typography>{t.notes}</Typography>
            <Typography>
              {t.status}
              {t.reason && ` · ${t.reason}`} ·{' '}
              {t.report?.excluded ||
                (t.report?.galleryVersion === galleryVersion
                  ? 'Current report'
                  : 'Outdated — rerun required')}
            </Typography>
            {t.report?.excludedPeople > 0 && (
              <Typography>
                {t.report.excludedPeople} people excluded: select an eligible primary sample.
              </Typography>
            )}
            {['primary', 'all'].map((m) => {
              const r = t.report?.modes?.[m]?.find((x) => x.threshold === 0.85);
              return (
                r && (
                  <Box key={m} sx={{ mt: 1 }}>
                    <Typography>
                      {m === 'all' ? 'All samples' : 'Primary only'}: {r.category} · {r.reason} ·{' '}
                      {r.predictedPersonId
                        ? db.people.find((p) => p.id === r.predictedPersonId)?.displayName ||
                          'Deleted person'
                        : 'No accepted identity'}
                    </Typography>
                    {r.scores?.map((s, i) => (
                      <Typography variant="caption" display="block" key={i}>
                        Observation {i + 1}: expected {score(s.expected)} · strongest other{' '}
                        {score(s.competing)} · closest{' '}
                        {db.people.find((p) => p.id === s.candidate.personId)?.displayName ??
                          'Deleted person'}{' '}
                        /{' '}
                        {db.templates.find((x) => x.id === s.candidate.templateId)?.label ??
                          'Deleted sample'}
                      </Typography>
                    ))}
                  </Box>
                )
              );
            })}
            <Button
              color="error"
              disabled={active || state.mode !== 'writable'}
              onClick={() => action({ type: 'deleteEvaluation', id: t.id })}
            >
              Delete trial
            </Button>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

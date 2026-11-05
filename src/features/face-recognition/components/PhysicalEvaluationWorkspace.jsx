import { useMemo, useState } from 'react';
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
} from '@mui/material';
import { useLocalDatabase, useFaceServices } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { usePhysicalEvaluation } from '@/utils/hooks/faceRecognition/usePhysicalEvaluation';
import { summarizePhysicalTrials } from '@/utils/hooks/faceRecognition/repositories/physicalTrial';
import { downloadJson } from '@/utils/hooks/faceRecognition/downloadJson';
import { FaceOverlay } from './FaceOverlay';
import { LivenessMeter } from './LivenessMeter';
import { LivenessPrompt } from './LivenessPrompt';
import { PhysicalTrialSetup } from './PhysicalTrialSetup';
import { PhysicalTrialReview } from './PhysicalTrialReview';
import { PhysicalSegmentMetrics } from './PhysicalSegmentMetrics';

const rate = (n, total) =>
  total ? `${n}/${total} (${((100 * n) / total).toFixed(1)}%)` : 'Unmeasured';
function ResultBucket({ title, value }) {
  return (
    <Box>
      <Typography fontWeight={700}>
        {title} - {value.denominator} measured segments
      </Typography>
      <Typography>
        Meter passed: {rate(value.meterPassed, value.denominator)} · Challenge passed:{' '}
        {rate(value.challengePassed, value.denominator)} · Combined passed:{' '}
        {rate(value.combinedPassed, value.denominator)}
      </Typography>
      <Typography>
        Combined not completed: {rate(value.denominator - value.combinedPassed, value.denominator)}
      </Typography>
    </Box>
  );
}
export function PhysicalEvaluationWorkspace() {
  const live = usePhysicalEvaluation();
  const { repository } = useFaceServices();
  const dbState = useLocalDatabase();
  const trials = dbState.database?.physicalTrials ?? [];
  const [filters, setFilters] = useState({ lighting: '', deviceLabel: '', expectedGroupSize: '' });
  const [error, setError] = useState(null);
  const report = useMemo(
    () =>
      summarizePhysicalTrials(trials, {
        ...filters,
        expectedGroupSize: filters.expectedGroupSize
          ? Number(filters.expectedGroupSize)
          : undefined,
      }),
    [trials, filters],
  );
  const active = ['loading', 'ready', 'running'].includes(live.status);
  const reviewing = ['review', 'saving', 'save_failed'].includes(live.status);
  const action = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };
  const faces = (live.faces ?? []).map((face) => ({
    ...face,
    enrollment: {
      active: true,
      liveness: face.liveness ?? {
        steps: [],
        step: 0,
        status: 'checking',
        prompt: 'Keep your face in view',
      },
      status: 'challenging',
    },
  }));
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Box>
        <Typography variant="h4">Physical camera and spoof trials</Typography>
        <Typography>
          Measure basic motion checks in authorized local trials. These results are experimental and
          are not certified presentation-attack detection.
        </Typography>
      </Box>
      <Alert severity="info">
        No frames, video or full landmarks are saved. Face segments and repeated trials are not
        independent participants.
      </Alert>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <PhysicalTrialSetup
              disabled={active || reviewing || dbState.mode !== 'writable'}
              count={trials.length}
              onStart={(options) => action(() => live.start(options))}
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
                sx={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
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
                  Camera preview
                </Box>
              )}
              <FaceOverlay
                faces={live.camera.active ? faces : []}
                frameSize={live.frameSize}
                showInstructions={live.camera.active && faces.length > 0}
              />
            </Box>
            <Typography role="status">
              {live.status} · {Math.floor((live.elapsedMs ?? 0) / 1000)} /{' '}
              {Math.round((live.durationMs ?? 0) / 1000)} seconds
            </Typography>
            {active && (
              <Button onClick={() => live.interrupt('Stopped by operator')}>Stop and review</Button>
            )}
            {faces.map((face) => (
              <Box key={face.segmentId} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <Typography fontWeight={700}>Face #{face.trackId}</Typography>
                <LivenessPrompt liveness={face.enrollment.liveness} status="challenging" />
                <LivenessMeter meter={face.meter} instructions />
              </Box>
            ))}
            {(error || live.error) && <Alert severity="error">{error || live.error}</Alert>}
            {reviewing && (
              <PhysicalTrialReview
                key={live.trial?.id ?? 'review'}
                segments={live.segments ?? []}
                interrupted={live.trial?.completion === 'interrupted'}
                pending={live.status === 'save_failed'}
                busy={live.status === 'saving'}
                error={live.error}
                onSave={(rows) => action(() => live.save(rows))}
                onRetry={() => action(() => live.retry())}
                onDiscard={() => live.discard()}
              />
            )}
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Experimental motion-check results</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                select
                label="Lighting filter"
                value={filters.lighting}
                onChange={(e) => setFilters({ ...filters, lighting: e.target.value })}
              >
                <MenuItem value="">All lighting</MenuItem>
                {['even', 'dim', 'backlit', 'uneven', 'other'].map((v) => (
                  <MenuItem key={v} value={v}>
                    {v}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Device filter"
                value={filters.deviceLabel}
                onChange={(e) => setFilters({ ...filters, deviceLabel: e.target.value })}
              />
              <TextField
                select
                label="Group size filter"
                value={filters.expectedGroupSize}
                onChange={(e) => setFilters({ ...filters, expectedGroupSize: e.target.value })}
              >
                <MenuItem value="">All sizes</MenuItem>
                {Array.from({ length: 10 }, (_, i) => (
                  <MenuItem key={i + 1} value={i + 1}>
                    {i + 1}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <ResultBucket title="Genuine person" value={report.genuine} />
            <ResultBucket title="Attack presentation" value={report.attack} />
            {Object.entries(report.bySubtype).map(([type, value]) => (
              <ResultBucket key={type} title={type.replaceAll('_', ' ')} value={value} />
            ))}
            <Typography>
              Incomplete: {report.incomplete} · Unscored: {report.unscored} · Unmeasured:{' '}
              {report.unmeasured} · Combined passes observed in interrupted segments:{' '}
              {report.observedInterruptedPasses}
            </Typography>
            <Typography fontWeight={700}>Planned and observed conditions</Typography>
            <Typography variant="body2">
              Planned: lighting, glasses, makeup, facial mobility, groups 1 / 2 / 4 / 10 and print /
              display / replay / camera motion presentations. Counts describe saved trials or
              segments, not independent participants.
            </Typography>
            {['even', 'dim', 'backlit', 'uneven', 'other'].map((lighting) => {
              const count = trials.filter((trial) => trial.lighting === lighting).length;
              return (
                <Typography key={lighting}>
                  Lighting {lighting}: {count ? `${count} trials` : 'Unmeasured'}
                </Typography>
              );
            })}
            {[1, 2, 4, 10].map((size) => {
              const count = trials.filter((trial) => {
                const points = trial.segments
                  .flatMap((segment) => [
                    [segment.firstSeenAt, 1],
                    [segment.lastSeenAt, -1],
                  ])
                  .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
                let current = 0,
                  peak = 0;
                for (const [, change] of points) {
                  current += change;
                  peak = Math.max(peak, current);
                }
                return peak >= size;
              }).length;
              return (
                <Typography key={size}>
                  Observed group {size}+: {count ? `${count} trials` : 'Unmeasured'}
                </Typography>
              );
            })}
            {[
              'stationary_print',
              'moved_print',
              'tilted_print',
              'bent_print',
              'display_photo',
              'prerecorded_video',
              'camera_motion',
            ].map((type) => {
              const count = trials
                .flatMap((trial) => trial.segments)
                .filter(
                  (segment) => segment.truth === 'attack' && segment.attackSubtype === type,
                ).length;
              return (
                <Typography key={type}>
                  {type.replaceAll('_', ' ')}: {count ? `${count} segments` : 'Unmeasured'}
                </Typography>
              );
            })}
            <Typography>
              Observed devices:{' '}
              {trials.length
                ? [...new Set(trials.map((trial) => trial.deviceLabel))].join(', ')
                : 'Unmeasured'}
            </Typography>
            <Typography>
              Appearance notes (operator recorded):{' '}
              {trials.length ? trials.map((trial) => trial.appearance).join('; ') : 'Unmeasured'}
            </Typography>
            <Button
              disabled={!trials.length}
              onClick={() =>
                downloadJson(
                  JSON.stringify({ policy: 'physical-motion-evaluation-v1', trials }, null, 2),
                  'physical-trials.json',
                )
              }
            >
              Export physical trials
            </Button>
            {trials.map((trial) => (
              <Box
                key={trial.id}
                sx={{ borderTop: 1, borderColor: 'divider', pt: 1, overflowWrap: 'anywhere' }}
              >
                <Typography fontWeight={700}>
                  {trial.label} · {trial.deviceLabel} · {trial.completion}
                </Typography>
                <Typography>
                  {trial.lighting} · group {trial.expectedGroupSize} · {trial.startedAt}
                </Typography>
                {trial.segments.map((segment) => (
                  <Box key={segment.segmentId} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      {segment.label || 'Unscored'} · {segment.truth}
                    </Typography>
                    <PhysicalSegmentMetrics segment={segment} />
                  </Box>
                ))}
                <Button
                  color="error"
                  disabled={dbState.mode !== 'writable' || active || reviewing}
                  onClick={() => {
                    if (window.confirm('Delete this physical trial?'))
                      action(() =>
                        repository.commit({ type: 'deletePhysicalTrial', id: trial.id }),
                      );
                  }}
                >
                  Delete trial
                </Button>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

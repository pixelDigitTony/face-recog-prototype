import { Alert, LinearProgress, Stack, Typography } from '@mui/material';
export function LivenessPrompt({
  liveness,
  status,
  actionLabel = 'Capture & enroll',
  compact = false,
}) {
  const total = liveness.steps?.length || 1;
  const disabled = liveness.reason === 'disabled_in_settings';
  const message =
    status === 'ready_to_enroll'
      ? compact
        ? `${disabled ? 'Liveness disabled · ' : ''}${liveness.prompt ?? 'Ready'} — tap ${actionLabel}`
        : `${disabled ? 'Not checked — disabled in Settings.' : 'Challenge complete.'} ${liveness.prompt ?? ''} Then click ${actionLabel}.`
      : status === 'capturing_enrollment'
        ? compact
          ? 'Hold still — saving…'
          : 'Keep looking straight ahead. Saving your enrollment…'
        : status === 'saving'
          ? 'Saving your result…'
          : status === 'preparing_enrollment'
            ? compact
              ? `${liveness.prompt ?? 'Hold still'} — preparing capture…`
              : `${disabled ? 'Not checked — disabled in Settings.' : 'Challenge complete.'} ${liveness.prompt ?? 'Hold still'} while the capture is prepared.`
            : status === 'comparing'
              ? compact
                ? 'Comparing enrolled face…'
                : 'Comparing with the selected person’s saved enrollment…'
              : status === 'multiple_faces'
                ? compact
                  ? 'One person at a time'
                  : 'Only one person may complete verification at a time'
                : status === 'analysis_delayed'
                  ? compact
                    ? 'Processing slowly — hold still'
                    : 'Analysis is taking too long. Keep one face in view; close other heavy tabs or try another device.'
                  : status === 'identity_blocked'
                    ? 'Look straight ahead so the same face can be confirmed'
                    : status === 'quality_blocked'
                      ? (liveness.prompt ?? 'Face the camera in even lighting')
                      : liveness.prompt;
  const text =
    liveness.status === 'checking' && status !== 'multiple_faces'
      ? `Step ${liveness.step + 1}/${total} · ${message}`
      : message;
  if (compact)
    return (
      <Stack spacing={0.5}>
        <Typography
          data-testid="face-instruction"
          component="div"
          sx={{ fontSize: { xs: 12, sm: 13 }, fontWeight: 700, lineHeight: 1.35, color: 'inherit' }}
        >
          {text}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, (liveness.step / total) * 100)}
          aria-label="Motion challenge progress"
          sx={{
            height: 3,
            borderRadius: 2,
            bgcolor: 'rgba(255,255,255,.25)',
            '& .MuiLinearProgress-bar': {
              bgcolor: status === 'ready_to_enroll' ? '#9be5af' : '#9edfff',
            },
          }}
        />
      </Stack>
    );
  return (
    <Stack spacing={1}>
      <Alert
        severity={
          status === 'ready_to_enroll'
            ? 'success'
            : status === 'multiple_faces'
              ? 'warning'
              : 'info'
        }
        role="status"
      >
        {text}
      </Alert>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, (liveness.step / total) * 100)}
        aria-label="Motion challenge progress"
      />
      <Typography variant="caption" color="text.secondary">
        Configurable challenges · Basic liveness only. Photo/video spoof resistance is not
        validated.
      </Typography>
    </Stack>
  );
}

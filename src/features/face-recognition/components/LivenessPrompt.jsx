import { Alert, LinearProgress, Stack, Typography } from '@mui/material';
export function LivenessPrompt({ liveness, status }) {
  const text =
    status === 'multiple_faces'
      ? 'Only one person may complete verification at a time'
      : status === 'analysis_delayed'
        ? 'Analysis delayed — hold still'
        : status === 'quality_blocked'
          ? 'Face the camera in even lighting'
          : liveness.prompt;
  return (
    <Stack spacing={1}>
      <Alert severity={status === 'multiple_faces' ? 'warning' : 'info'} role="status">
        {text}
      </Alert>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, (liveness.step / 4) * 100)}
        aria-label="Motion challenge progress"
      />
      <Typography variant="caption" color="text.secondary">
        Randomized head turns · Basic motion check only. Photo/video spoof resistance is not
        validated.
      </Typography>
    </Stack>
  );
}

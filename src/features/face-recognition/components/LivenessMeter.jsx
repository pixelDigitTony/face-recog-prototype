import { useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';

const labels = {
  initializing: 'Starting liveness analysis',
  collecting: 'Collecting motion evidence',
  passed_basic: 'Basic motion checks met',
  insufficient_quality: 'Cannot assess reliably - progress paused',
  unavailable: 'Liveness unavailable',
  invalidated: 'Rechecking liveness',
};
export function LivenessMeter({ meter, instructions = false, compact = false }) {
  const [shown, setShown] = useState(meter);
  const latest = useRef(meter);
  latest.current = meter;
  useEffect(() => {
    const timer = setInterval(() => setShown(latest.current), 200);
    return () => clearInterval(timer);
  }, []);
  if (!shown) return null;
  const status = shown.status ?? 'initializing',
    label =
      shown.reason === 'insufficient_sampling'
        ? 'Insufficient sampling - use a faster camera feed'
        : (labels[status] ?? labels.unavailable);
  const canShowNumber = ['collecting', 'passed_basic', 'insufficient_quality'].includes(status);
  const activity = shown.activity;
  const liveActivity = canShowNumber && Number.isFinite(activity?.score);
  const value = liveActivity ? activity.score : shown.score;
  const numeric = canShowNumber && Number.isFinite(value);
  const score = numeric ? Math.round(Math.max(0, Math.min(100, value))) : null;
  const activityLabel = activity?.idle ? 'No recent movement' : 'Live movement';
  const announcement = liveActivity ? `${label} - ${activityLabel}` : label;
  const hint =
    shown.progress?.head < 3
      ? 'Move your head slightly'
      : 'Blink naturally or change your expression';
  return (
    <Box
      data-testid="liveness-meter"
      data-status={status}
      sx={{ my: compact ? 0.5 : 1, minWidth: 0 }}
    >
      <Typography component="div" variant={compact ? 'caption' : 'body2'}>
        {numeric ? `Liveness evidence ${score}%` : 'Liveness evidence'} -{' '}
        {liveActivity ? activityLabel : label}
        {!liveActivity && status === 'passed_basic' && shown.acceptedAt
          ? ` at ${new Date(shown.acceptedAt).toLocaleTimeString()}`
          : ''}
      </Typography>
      {liveActivity && (
        <Typography component="div" variant="caption">
          {label}
          {status === 'passed_basic' && shown.acceptedAt
            ? ` at ${new Date(shown.acceptedAt).toLocaleTimeString()}`
            : ''}
        </Typography>
      )}
      <Box
        aria-live="polite"
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '1px',
          height: '1px',
          padding: 0,
          margin: 0,
          whiteSpace: 'nowrap',
          clipPath: 'inset(50%)',
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
        }}
      >
        {announcement}
      </Box>
      {numeric && (
        <LinearProgress
          variant="determinate"
          value={score}
          color={
            status === 'passed_basic' && (!liveActivity || score === 100) ? 'success' : 'warning'
          }
          aria-label="Liveness evidence"
          aria-valuetext={`${score}% - ${liveActivity ? `${activityLabel}; ${label}` : label}`}
        />
      )}
      {instructions && status === 'collecting' && (
        <Typography component="div" variant="caption">
          {hint}
        </Typography>
      )}
      {instructions &&
        status === 'insufficient_quality' &&
        shown.reason !== 'insufficient_sampling' && (
          <Typography component="div" variant="caption">
            Improve lighting so your eyes are visible
          </Typography>
        )}
    </Box>
  );
}

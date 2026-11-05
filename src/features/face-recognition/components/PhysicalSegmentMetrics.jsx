import { Typography } from '@mui/material';
export function PhysicalSegmentMetrics({ segment }) {
  const span =
    segment.observationCount > 0 ? segment.lastObservationAt - segment.firstObservationAt : null;
  const interval =
    segment.observationCount > 1 && span > 0 ? span / (segment.observationCount - 1) : null;
  const time = (value) =>
    value == null ? 'Not observed' : `${((value - segment.firstSeenAt) / 1000).toFixed(1)} s`;
  return (
    <>
      <Typography variant="caption" display="block">
        Observations: {segment.observationCount} · span:{' '}
        {span == null ? 'Unmeasured' : `${(span / 1000).toFixed(1)} s`} · mean interval:{' '}
        {interval == null
          ? 'Unmeasured'
          : `${interval.toFixed(0)} ms (${(1000 / interval).toFixed(1)} Hz)`}
      </Typography>
      <Typography variant="caption" display="block">
        Maximum gap:{' '}
        {segment.observationCount > 1 ? `${Math.round(segment.maxGapMs)} ms` : 'Unmeasured'} · gaps
        over 200 ms: {segment.gapCount} · peak movement:{' '}
        {segment.observationCount ? `${Math.round(segment.peakActivity)}%` : 'Unmeasured'}
      </Typography>
      <Typography variant="caption" display="block">
        Time to meter: {time(segment.meterPassedAt)} · challenge: {time(segment.challengePassedAt)}{' '}
        · combined: {time(segment.combinedPassedAt)}
      </Typography>
    </>
  );
}

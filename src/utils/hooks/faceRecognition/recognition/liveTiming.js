// Fixed, bounded CPU timing budget. Capture timestamps remain the source of
// evidence age; completedAt is only for detecting a stalled analysis loop.
export const LIVE_TIMING = Object.freeze({
  version: 'cpu-cadence-v2',
  maxFrameAgeMs: 1500,
  maxObservationGapMs: 1500,
  stalledAfterMs: 1500,
});

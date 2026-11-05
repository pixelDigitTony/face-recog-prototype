import { PhysicalSegmentMetrics } from './PhysicalSegmentMetrics';
import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';

const attacks = [
  'stationary_print',
  'moved_print',
  'tilted_print',
  'bent_print',
  'display_photo',
  'eye_mouth_cutout',
  'prerecorded_video',
  'camera_motion',
  'other_presentation',
];
export function PhysicalTrialReview({
  segments,
  interrupted,
  pending,
  busy,
  error,
  onSave,
  onRetry,
  onDiscard,
}) {
  const [rows, setRows] = useState({});
  const update = (id, patch) =>
    setRows((old) => ({
      ...old,
      [id]: { label: '', truth: 'unscored', attackSubtype: '', ...old[id], ...patch },
    }));
  const scored = Object.values(rows).filter((row) => row.truth !== 'unscored');
  const valid =
    scored.length > 0 &&
    scored.every((row) => row.label.trim() && (row.truth !== 'attack' || row.attackSubtype));
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Review physical trial</Typography>
      {interrupted && (
        <Alert severity="warning">
          Trial interrupted. Incomplete checks are not counted as rejections.
        </Alert>
      )}
      <Typography variant="body2">
        Each row is a continuous face segment. Repeated segments are not independent participants.
        Unscored rows are excluded from rates.
      </Typography>
      {!segments.length && (
        <Alert severity="info">
          No face segments were measured. There are no scored results to save.
        </Alert>
      )}
      {segments.map((segment) => {
        const row = rows[segment.segmentId] ?? { label: '', truth: 'unscored', attackSubtype: '' };
        return (
          <Box
            key={segment.segmentId}
            sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, minWidth: 0 }}
          >
            <Stack spacing={1}>
              <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                Face #{segment.trackId} - segment {segment.segmentId}
              </Typography>
              <PhysicalSegmentMetrics segment={segment} />
              <TextField
                label="Participant / presentation label"
                value={row.label}
                disabled={pending || busy}
                onChange={(e) => update(segment.segmentId, { label: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <TextField
                select
                label="Ground truth"
                value={row.truth}
                disabled={pending || busy}
                onChange={(e) => update(segment.segmentId, { truth: e.target.value })}
              >
                <MenuItem value="unscored">Unscored</MenuItem>
                <MenuItem value="genuine">Genuine person</MenuItem>
                <MenuItem value="attack">Attack presentation</MenuItem>
              </TextField>
              {row.truth === 'attack' && (
                <TextField
                  select
                  required
                  label="Attack subtype"
                  value={row.attackSubtype}
                  disabled={pending || busy}
                  onChange={(e) => update(segment.segmentId, { attackSubtype: e.target.value })}
                >
                  {attacks.map((attack) => (
                    <MenuItem key={attack} value={attack}>
                      {attack.replaceAll('_', ' ')}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
          </Box>
        );
      })}
      {error && <Alert severity="error">{error}</Alert>}
      {pending ? (
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button onClick={onRetry} disabled={busy}>
            Retry saving trial
          </Button>
          <Button onClick={onDiscard} disabled={busy}>
            Discard unsaved trial
          </Button>
        </Stack>
      ) : (
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button
            variant="contained"
            onClick={() =>
              onSave(
                Object.fromEntries(
                  segments.map((segment) => {
                    const row = rows[segment.segmentId] ?? { label: '', truth: 'unscored' };
                    return [
                      segment.segmentId,
                      { ...row, attackSubtype: row.truth === 'attack' ? row.attackSubtype : null },
                    ];
                  }),
                ),
              )
            }
            disabled={!valid || busy}
          >
            Save trial
          </Button>
          <Button onClick={onDiscard} disabled={busy}>
            Discard review
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

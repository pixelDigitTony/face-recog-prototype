import { useState } from 'react';
import { Alert, Avatar, Button, Stack, TextField, Typography } from '@mui/material';

export function GuidedSampleReview({ samples, busy, onSave, onDiscard, cameraContinues = false }) {
  const [labels, setLabels] = useState(samples.map((s) => s.label));
  const [error, setError] = useState(null);
  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Typography variant="h6">Review three samples</Typography>
      <Typography variant="body2">
        {cameraContinues
          ? 'These three samples are ready. Other faces continue processing while you review.'
          : 'The camera is stopped. Save all three references together or discard this set.'}
      </Typography>
      {samples.map((sample, index) => (
        <Stack key={index} direction="row" spacing={1}>
          <Avatar
            variant="rounded"
            src={sample.thumbnailDataUrl ?? undefined}
            alt={`Captured reference ${index + 1}`}
          >
            —
          </Avatar>
          <TextField
            fullWidth
            label={`Sample ${index + 1} label`}
            value={labels[index]}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 60 } }}
            onChange={(e) => setLabels(labels.map((l, i) => (i === index ? e.target.value : l)))}
          />
        </Stack>
      ))}
      {error && <Alert severity="error">{error}</Alert>}
      <Button
        variant="contained"
        disabled={busy || labels.some((l) => !l.trim())}
        onClick={async () => {
          setError(null);
          try {
            await onSave(labels);
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        {busy ? 'Saving set…' : 'Save three samples'}
      </Button>
      <Button disabled={busy} onClick={onDiscard}>
        Discard set
      </Button>
    </Stack>
  );
}

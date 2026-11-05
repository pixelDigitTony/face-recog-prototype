import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

export function PhysicalTrialSetup({ disabled, count, onStart }) {
  const [form, setForm] = useState({
    label: '',
    deviceLabel: '',
    lighting: '',
    appearance: '',
    expectedGroupSize: 1,
    durationSeconds: 30,
    authorized: false,
  });
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const valid =
    form.label.trim() &&
    form.deviceLabel.trim() &&
    form.lighting &&
    form.appearance.trim() &&
    form.authorized;
  return (
    <Stack
      component="form"
      spacing={2}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onStart(form);
      }}
    >
      <Typography variant="h6">New physical trial - {count}/100 saved</Typography>
      <TextField
        required
        label="Trial / session label"
        value={form.label}
        disabled={disabled}
        onChange={(e) => set('label', e.target.value)}
        slotProps={{ htmlInput: { maxLength: 100 } }}
      />
      <TextField
        required
        label="Device label"
        value={form.deviceLabel}
        disabled={disabled}
        onChange={(e) => set('deviceLabel', e.target.value)}
        slotProps={{ htmlInput: { maxLength: 100 } }}
      />
      <TextField
        required
        select
        label="Lighting condition"
        value={form.lighting}
        disabled={disabled}
        onChange={(e) => set('lighting', e.target.value)}
      >
        <MenuItem value="even">Even frontal light</MenuItem>
        <MenuItem value="dim">Dim</MenuItem>
        <MenuItem value="backlit">Backlit</MenuItem>
        <MenuItem value="uneven">Uneven / side light</MenuItem>
        <MenuItem value="other">Other</MenuItem>
      </TextField>
      <TextField
        required
        label="Appearance notes"
        value={form.appearance}
        disabled={disabled}
        onChange={(e) => set('appearance', e.target.value)}
        slotProps={{ htmlInput: { maxLength: 500 } }}
        helperText="Use pseudonyms where appropriate; describe glasses, makeup or other relevant conditions."
      />
      <TextField
        select
        label="Expected visible group size"
        value={form.expectedGroupSize}
        disabled={disabled}
        onChange={(e) => set('expectedGroupSize', Number(e.target.value))}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <MenuItem key={i + 1} value={i + 1}>
            {i + 1}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Target duration"
        value={form.durationSeconds}
        disabled={disabled}
        onChange={(e) => set('durationSeconds', Number(e.target.value))}
      >
        {[15, 30, 60].map((n) => (
          <MenuItem key={n} value={n}>
            {n} seconds
          </MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        control={
          <Checkbox
            checked={form.authorized}
            disabled={disabled}
            onChange={(e) => set('authorized', e.target.checked)}
          />
        }
        label="I confirm participants and presentations are authorized for local testing."
      />
      {count >= 100 && (
        <Alert severity="warning">
          The 100 physical trial limit is reached. Delete a trial before starting another.
        </Alert>
      )}
      <Button type="submit" variant="contained" disabled={disabled || !valid || count >= 100}>
        Start physical trial
      </Button>
    </Stack>
  );
}

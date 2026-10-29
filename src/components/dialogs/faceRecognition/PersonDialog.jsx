import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
} from '@mui/material';
import { useFaceServices } from '@/utils/hooks/faceRecognition/useLocalDatabase';

export function PersonDialog({ open, onClose, person, onSaved }) {
  const { repository } = useFaceServices();
  const [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{person ? 'Edit person' : 'Add a test person'}</DialogTitle>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          const data = new FormData(event.currentTarget);
          try {
            const value = {
              ...person,
              id: person?.id ?? crypto.randomUUID(),
              employeeCode: String(data.get('code')),
              displayName: String(data.get('name')),
              department: String(data.get('department')),
              acknowledgedAt: data.has('acknowledge')
                ? (person?.acknowledgedAt ?? new Date().toISOString())
                : null,
            };
            await repository.commit({ type: 'savePerson', person: value });
            onSaved?.(value.id);
            onClose();
          } catch (error) {
            setError(error.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              name="code"
              label="Employee code"
              required
              autoFocus
              defaultValue={person?.employeeCode ?? ''}
              inputProps={{ maxLength: 60 }}
            />
            <TextField
              name="name"
              label="Full name"
              required
              defaultValue={person?.displayName ?? ''}
              inputProps={{ maxLength: 120 }}
            />
            <TextField
              name="department"
              label="Department (optional)"
              defaultValue={person?.department ?? ''}
            />
            <FormControlLabel
              control={
                <Checkbox
                  name="acknowledge"
                  defaultChecked={Boolean(person?.acknowledgedAt)}
                  required
                />
              }
              label="I agree to store this test person's face data in this browser."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Save person
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

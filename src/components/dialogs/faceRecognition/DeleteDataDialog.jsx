import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useState } from 'react';

export function DeleteDataDialog({ action, onClose }) {
  const [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  return (
    <Dialog open={Boolean(action)} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{action?.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{action?.description}</DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await action.run();
              onClose();
            } catch (error) {
              setError(error.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete data
        </Button>
      </DialogActions>
    </Dialog>
  );
}

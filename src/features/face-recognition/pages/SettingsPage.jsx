import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useFaceServices, useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { DeleteDataDialog } from '@/components/dialogs/faceRecognition/DeleteDataDialog';
import { RecordDetailsDialog } from '@/components/dialogs/faceRecognition/RecordDetailsDialog';
import { StorageUsage } from '../components/StorageUsage';
import { useModels } from '@/utils/hooks/faceRecognition/useModels';
import { ModelStatus } from '../components/ModelStatus';
import { CaptureWorkspace } from '../components/CaptureWorkspace';

export function SettingsPage() {
  const { repository } = useFaceServices(),
    state = useLocalDatabase(),
    models = useModels();
  const settings = state.database?.settings;
  const [error, setError] = useState(null),
    [success, setSuccess] = useState(false),
    [reset, setReset] = useState(false),
    [details, setDetails] = useState(null),
    [diagnostic, setDiagnostic] = useState(false);
  if (diagnostic)
    return (
      <>
        <Button sx={{ mb: 2 }} onClick={() => setDiagnostic(false)}>
          Return to settings
        </Button>
        <Alert severity="info" sx={{ mb: 2 }}>
          Diagnostic image comparison only. Images cannot produce live identification or pass
          liveness.
        </Alert>
        <CaptureWorkspace purpose="verify" />
      </>
    );
  return (
    <>
      <Typography variant="overline" color="primary" fontWeight={700}>
        PROTOTYPE CONFIGURATION
      </Typography>
      <Typography variant="h4" sx={{ mt: 0.5, mb: 3 }}>
        Make the test your own.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <Card>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Recognition settings
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Changes apply to future captures. Historical results keep their original threshold.
            </Typography>
            {settings && (
              <form
                key={`${settings.matchThreshold}-${settings.saveThumbnails}`}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  setError(null);
                  setSuccess(false);
                  try {
                    await repository.commit({
                      type: 'settings',
                      settings: {
                        matchThreshold: 0.85,
                        saveThumbnails: data.has('thumbnails'),
                      },
                    });
                    setSuccess(true);
                  } catch (error) {
                    setError(error.message);
                  }
                }}
              >
                <Stack spacing={2}>
                  <TextField
                    name="threshold"
                    label="Required cosine threshold (above 85%)"
                    disabled
                    defaultValue={settings.matchThreshold}
                    type="number"
                    required
                    slotProps={{ htmlInput: { min: -1, max: 1, step: 0.001 } }}
                    helperText="Fixed rule: raw similarity > 0.85. Historical attempts keep their original policy."
                  />
                  <FormControlLabel
                    control={<Switch name="thumbnails" defaultChecked={settings.saveThumbnails} />}
                    label="Save small capture thumbnails"
                  />
                  <Typography variant="caption" color="text.secondary">
                    Full video and full-resolution frames are not retained. Embeddings are saved
                    with enrollment and diagnostic captures. Automatic identification stores score
                    summaries only.
                  </Typography>
                  {error && <Alert severity="error">{error}</Alert>}
                  {success && <Alert severity="success">Settings saved.</Alert>}
                  <Button type="submit" variant="contained" disabled={state.mode !== 'writable'}>
                    Save settings
                  </Button>
                </Stack>
              </form>
            )}
          </CardContent>
        </Card>
        <Stack spacing={3}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Local recognition engine
              </Typography>
              <ModelStatus models={models} />
              <Button
                size="small"
                sx={{ mt: 2 }}
                disabled={!models.manifest}
                onClick={() => setDetails(models.manifest)}
              >
                Inspect model manifest
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Browser database
              </Typography>
              <StorageUsage state={state} />
              <Typography variant="body2" color="text.secondary" sx={{ my: 2 }}>
                Up to 50 people and 200 combined captures and identification scans, within a 3 MB
                estimated storage budget. Records are never automatically removed.
              </Typography>
              <Button
                color="error"
                variant="outlined"
                disabled={!['writable', 'recovery'].includes(state.mode)}
                onClick={() => setReset(true)}
              >
                Reset prototype database
              </Button>
            </CardContent>
          </Card>
        </Stack>
      </Box>
      <DeleteDataDialog
        action={
          reset
            ? {
                title: 'Reset this prototype database?',
                description:
                  'Delete every local person, face template, capture and identification scan, and restore default settings. This affects only the current prototype key.',
                run: () => repository.reset(),
              }
            : null
        }
        onClose={() => setReset(false)}
      />
      <RecordDetailsDialog record={details} onClose={() => setDetails(null)} />
      <Button sx={{ mt: 3 }} onClick={() => setDiagnostic(true)}>
        Diagnostic image comparison
      </Button>
    </>
  );
}

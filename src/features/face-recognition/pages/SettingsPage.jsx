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
        <CaptureWorkspace purpose={diagnostic === 'enroll' ? 'enroll' : 'verify'} />
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
                key={JSON.stringify(settings)}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  setError(null);
                  setSuccess(false);
                  if (!data.has('turnLeft') && !data.has('turnRight') && !data.has('blink')) {
                    setError('Enable at least one enrollment challenge in Settings.');
                    return;
                  }
                  try {
                    await repository.commit({
                      type: 'settings',
                      settings: {
                        matchThreshold: 0.85,
                        saveThumbnails: data.has('thumbnails'),
                        enrollmentLiveness: {
                          version: 1,
                          turnLeft: data.has('turnLeft'),
                          turnRight: data.has('turnRight'),
                          blink: data.has('blink'),
                        },
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
                    label="Cosine threshold (85%)"
                    disabled
                    defaultValue={settings.matchThreshold}
                    type="number"
                    required
                    slotProps={{ htmlInput: { min: -1, max: 1, step: 0.001 } }}
                    helperText="Scan: similarity ≥ 0.85, stable and unique. Enrollment consistency: > 0.85. History keeps its recorded policy."
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
                  <Typography variant="h6">Enrollment liveness</Typography>
                  <Typography variant="body2">
                    Applies to the next enrollment session. Scan stays automatic. These are basic
                    challenges; replay resistance is not validated.
                  </Typography>
                  {Object.entries({
                    turnLeft: 'Turn left',
                    turnRight: 'Turn right',
                    blink: 'Blink',
                  }).map(([key, label]) => (
                    <FormControlLabel
                      key={key}
                      label={label}
                      control={
                        <Switch name={key} defaultChecked={settings.enrollmentLiveness[key]} />
                      }
                    />
                  ))}
                  <Typography variant="caption">
                    Liveness evidence meter required for live enrollment. Once blink, expression, or
                    head movement is detected, the meter shows the calculated amount of that
                    movement. It rises or falls only when a new movement calculates a different
                    amount, and it does not reset on a timer. A completed enrollment check remains
                    ready and its recorded evidence stays unchanged. These are basic motion checks,
                    not a probability of being alive; replay resistance is not validated. Prompted
                    Blink can be disabled while passive blink remains active. Enable at least one
                    prompted challenge for live enrollment.
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
                Up to 50 people, five samples per person, 200 combined captures and identification
                scans, 100 recognition evaluation trials and 100 physical trials, within a 3 MB
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
      <Button sx={{ mt: 3 }} onClick={() => setDiagnostic('enroll')}>
        Diagnostic image enrollment
      </Button>
    </>
  );
}

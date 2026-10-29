import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import { useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { useCamera } from '@/utils/hooks/faceRecognition/useCamera';
import { useFaceWorkflow } from '@/utils/hooks/faceRecognition/useFaceWorkflow';
import { useModels } from '@/utils/hooks/faceRecognition/useModels';
import { readTestImage } from '@/utils/hooks/faceRecognition/downloadJson';
import { PersonDialog } from '@/components/dialogs/faceRecognition/PersonDialog';
import { ModelStatus } from './ModelStatus';
import { CameraPreview } from './CameraPreview';
import { ScanResult } from './ScanResult';

export function CaptureWorkspace({ purpose }) {
  const state = useLocalDatabase(),
    camera = useCamera(),
    workflow = useFaceWorkflow(),
    models = useModels();
  const [selectedId, setSelectedId] = useState(''),
    [personDialog, setPersonDialog] = useState(false),
    [image, setImage] = useState(null),
    [error, setError] = useState(null);
  const imageRef = useRef(null),
    mode = purpose === 'enroll' ? 'enroll' : 'verify',
    isEnrollment = mode === 'enroll';
  const people = state.database?.people.filter((p) => isEnrollment || p.activeTemplateId) ?? [];
  const person = people.find((p) => p.id === selectedId) ?? null;
  const disabled = state.mode !== 'writable' || workflow.busy;
  useEffect(
    () => () => {
      if (imageRef.current) URL.revokeObjectURL(imageRef.current);
    },
    [],
  );
  async function selectImage(event) {
    setError(null);
    const file = event.target.files[0];
    if (!file) return;
    try {
      const frame = await readTestImage(file);
      if (imageRef.current) URL.revokeObjectURL(imageRef.current);
      const url = URL.createObjectURL(file);
      imageRef.current = url;
      setImage({ url, frame });
      camera.stop();
    } catch (error) {
      setError(error.message);
    }
    event.target.value = '';
  }
  return (
    <>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="primary" fontWeight={700}>
          FACE RECOGNITION / {isEnrollment ? 'ENROLLMENT' : 'VERIFICATION'}
        </Typography>
        <Typography variant="h4" sx={{ mt: 0.5, mb: 1 }}>
          {isEnrollment ? 'A face to put to the name.' : 'Verify a familiar face.'}
        </Typography>
        <Typography color="text.secondary">
          {isEnrollment
            ? 'Create a local enrollment to start testing face verification.'
            : 'Diagnostic comparison only. Images cannot pass liveness or create a live match.'}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.25fr) minmax(0,1fr)' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Card>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 2.5 }}
            >
              <Typography variant="h6">
                {isEnrollment ? 'Enroll a person' : 'Capture & compare'}
              </Typography>
              <Chip label="1:1 verification" size="small" variant="outlined" />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <Autocomplete
                fullWidth
                options={people}
                value={person}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                getOptionLabel={(p) => `${p.employeeCode} · ${p.displayName}`}
                onChange={(_, p) => setSelectedId(p?.id ?? '')}
                disabled={workflow.busy}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={isEnrollment ? 'Select a test person' : 'Select an enrolled person'}
                  />
                )}
              />
              {isEnrollment && (
                <Button
                  variant="outlined"
                  aria-label="Add person"
                  disabled={disabled}
                  onClick={() => setPersonDialog(true)}
                  sx={{ minWidth: 48, p: 1 }}
                >
                  <AddIcon />
                </Button>
              )}
            </Stack>
            {people.length === 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {isEnrollment
                  ? 'Add your first test person using the + button.'
                  : 'Enroll a person first, then return here to scan.'}
              </Alert>
            )}
            <CameraPreview
              imageOnly
              camera={camera}
              imageUrl={image?.url}
              onImage={selectImage}
              disabled={disabled}
            />
            {image && (
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  Image test mode · physical presence is not checked
                </Typography>
                <Button size="small" onClick={() => setImage(null)}>
                  Use camera
                </Button>
              </Stack>
            )}
            {(camera.error || error) && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {camera.error || error}
              </Alert>
            )}
            <Divider sx={{ my: 2 }} />
            <ModelStatus models={models} disabled={workflow.busy} />
            <Button
              fullWidth
              size="large"
              variant="contained"
              sx={{ mt: 2 }}
              disabled={
                disabled ||
                !person ||
                !person.acknowledgedAt ||
                models.status !== 'ready' ||
                (!camera.active && !image) ||
                Boolean(workflow.result && !workflow.result.persisted)
              }
              startIcon={
                workflow.busy ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <CenterFocusStrongOutlinedIcon />
                )
              }
              onClick={() =>
                workflow.run(
                  mode,
                  person.id,
                  image ? async () => structuredClone(image.frame) : camera.capture,
                )
              }
            >
              {workflow.busy
                ? 'Processing…'
                : isEnrollment
                  ? person?.activeTemplateId
                    ? 'Replace enrollment'
                    : 'Capture & enroll'
                  : 'Scan face'}
            </Button>
            {person?.activeTemplateId && isEnrollment && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                A saved capture will replace this person’s active template.
              </Typography>
            )}
          </CardContent>
        </Card>
        <Stack spacing={3}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Capture result
              </Typography>
              <ScanResult workflow={workflow} />
            </CardContent>
          </Card>
          <Card sx={{ bgcolor: '#edf4ea' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography fontWeight={650} sx={{ mb: 1 }}>
                A better capture starts here
              </Typography>
              <Stack spacing={1} color="text.secondary">
                <Typography variant="body2">01 &nbsp; Face the camera in even lighting.</Typography>
                <Typography variant="body2">02 &nbsp; Keep one face inside the frame.</Typography>
                <Typography variant="body2">
                  03 &nbsp; Hold still and use a natural expression.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
          <Typography variant="caption" color="text.secondary">
            Your camera frames are processed on this device. Only completed captures are written to
            the local database.
          </Typography>
        </Stack>
      </Box>
      <PersonDialog
        key={String(personDialog)}
        open={personDialog}
        onClose={() => setPersonDialog(false)}
        onSaved={setSelectedId}
      />
    </>
  );
}

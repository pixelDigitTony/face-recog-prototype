import { useState } from 'react';
import { Alert, Avatar, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import { useFaceServices } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { compatibleTemplate } from '@/utils/hooks/faceRecognition/workflows/faceWorkflow';
import { formatDate } from '@/utils/hooks/faceRecognition/tableFormatting';

function SampleCard({ sample, primary, disabled, onReplace, commit, manifest }) {
  const [label, setLabel] = useState(sample.label),
    [confirm, setConfirm] = useState(false);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Avatar
          src={sample.thumbnailDataUrl || undefined}
          alt={`Enrollment photo: ${sample.label}`}
          variant="rounded"
        >
          —
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2">
            {sample.label} {primary && <Chip size="small" label="Primary" />}
          </Typography>
          <Typography variant="caption">
            {formatDate(sample.createdAt)} · {sample.enrollmentSource}
          </Typography>
        </Box>
      </Stack>
      <Typography variant="caption" display="block">
        {manifest
          ? compatibleTemplate(sample, manifest)
            ? 'Compatible model'
            : 'Incompatible model'
          : 'Load models to check compatibility'}{' '}
        · {sample.enrollmentLiveness}
      </Typography>
      <Typography variant="caption" display="block">
        Brightness: {sample.quality?.brightness?.toFixed(0) ?? '—'} · Sharpness:{' '}
        {sample.quality?.blurVariance?.toFixed(0) ?? '—'}
      </Typography>
      <TextField
        fullWidth
        size="small"
        label="Sample label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        disabled={disabled}
        slotProps={{ htmlInput: { maxLength: 60 } }}
        sx={{ mt: 1 }}
      />
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5}>
        <Button
          disabled={disabled || !label.trim() || label === sample.label}
          onClick={() => commit('renameSample', sample, { label })}
        >
          Save label
        </Button>
        <Button disabled={disabled} onClick={() => onReplace(sample.id)}>
          Replace this sample
        </Button>
        <Button disabled={disabled || primary} onClick={() => commit('setPrimarySample', sample)}>
          Set as primary
        </Button>
        <Button color="error" disabled={disabled} onClick={() => setConfirm(true)}>
          Delete sample
        </Button>
      </Stack>
      {confirm && (
        <Alert severity="warning">
          Delete “{sample.label}”?
          <Button
            color="error"
            onClick={async () => {
              await commit('deleteSample', sample);
              setConfirm(false);
            }}
            disabled={disabled}
          >
            Confirm delete
          </Button>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
        </Alert>
      )}
    </Box>
  );
}

export function EnrollmentSamples({ person, samples, disabled, replaceTemplateId, onReplace }) {
  const { repository, engine } = useFaceServices();
  const [error, setError] = useState(null);
  async function commit(type, sample, extra = {}) {
    try {
      await repository.commit({
        type,
        personId: person.id,
        templateId: sample.id,
        expectedEnrollmentRevision: person.enrollmentRevision,
        ...extra,
      });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Typography variant="subtitle2">
        {person.displayName} · {samples.length}/5 face samples
      </Typography>
      <Typography variant="caption">
        Add two or three clear variations across different days. New samples preserve previous
        appearances.
      </Typography>
      {samples.length === 5 && !replaceTemplateId && (
        <Alert severity="info">
          Five sample limit reached. Replace or delete a sample to continue.
        </Alert>
      )}
      {replaceTemplateId && (
        <Alert severity="info">
          Replacing: {samples.find((s) => s.id === replaceTemplateId)?.label}
          <Button disabled={disabled} onClick={() => onReplace(null)}>
            Use Add face sample
          </Button>
        </Alert>
      )}
      {samples.map((sample) => (
        <SampleCard
          key={sample.id}
          sample={sample}
          primary={sample.id === person.primaryTemplateId}
          disabled={disabled}
          onReplace={onReplace}
          commit={commit}
          manifest={engine.manifest}
        />
      ))}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}

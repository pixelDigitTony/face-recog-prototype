import { Alert, Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useState } from 'react';
import { RecordDetailsDialog } from '@/components/dialogs/faceRecognition/RecordDetailsDialog';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';

export function ScanResult({ workflow }) {
  const [details, setDetails] = useState(null);
  const result = workflow.result;
  return (
    <Stack spacing={2} role="status" aria-live="polite">
      {workflow.error && <Alert severity="error">{workflow.error}</Alert>}
      {!result ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 40, color: '#b5c6b9', mb: 1 }} />
          <Typography fontWeight={600}>
            {workflow.busy ? 'Processing your capture…' : 'Ready for a capture'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            The result and saved status will appear here.
          </Typography>
        </Box>
      ) : (
        <>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Chip
              label={result.outcome.replaceAll('_', ' ')}
              color={
                ['MATCH', 'ENROLLED'].includes(result.outcome)
                  ? 'success'
                  : result.outcome === 'NO_MATCH'
                    ? 'warning'
                    : 'default'
              }
            />
            <Chip
              label={result.persisted ? 'Saved locally' : 'Not saved'}
              color={result.persisted ? 'default' : 'error'}
              variant="outlined"
            />
          </Stack>
          <Typography variant="h6">{result.personSnapshot.displayName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {result.personSnapshot.employeeCode} ·{' '}
            {result.purpose === 'enroll' ? 'Enrollment' : 'Verification'}
          </Typography>
          <Divider />
          <Stack direction="row" spacing={4}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Match similarity
              </Typography>
              <Typography variant="h5">{formatPercentage(result.similarity)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Threshold
              </Typography>
              <Typography variant="h5">
                {result.comparisonOperator ?? '>='} {(result.thresholdSnapshot * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Processing
              </Typography>
              <Typography variant="h5">
                {result.timingsMs.total ? `${Math.round(result.timingsMs.total)} ms` : '—'}
              </Typography>
            </Box>
          </Stack>
          {result.reasonCode && (
            <Alert severity="info">{result.reasonCode.replaceAll('_', ' ')}</Alert>
          )}
          {!result.persisted && (
            <Alert severity="error">
              {result.error} This result is only in memory and will be lost on reload.
            </Alert>
          )}
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button size="small" variant="outlined" onClick={() => setDetails(result)}>
              View result data
            </Button>
            {!result.persisted && (
              <Button size="small" disabled={workflow.busy} onClick={workflow.retry}>
                Retry save
              </Button>
            )}
            <Button size="small" disabled={workflow.busy} onClick={workflow.discard}>
              {result.persisted ? 'Clear result' : 'Discard unsaved result'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {result.livenessStatus === 'passed_basic'
              ? 'Basic liveness passed — motion challenge only'
              : 'Liveness not checked or not passed'}{' '}
            · Prototype result
          </Typography>
        </>
      )}
      <RecordDetailsDialog record={details} onClose={() => setDetails(null)} />
    </Stack>
  );
}

import { Alert, Box, Button, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';

export function ModelStatus({ models, disabled }) {
  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: '#f9fbf8',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <MemoryOutlinedIcon color="primary" />
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" fontWeight={650}>
            YuNet + SFace
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Runs on this device · WASM CPU
          </Typography>
        </Box>
        {models.status === 'ready' ? (
          <Chip label="Models ready" size="small" color="success" variant="outlined" />
        ) : (
          <Button
            size="small"
            variant="outlined"
            disabled={disabled || models.status === 'loading'}
            onClick={models.initialize}
          >
            {models.status === 'loading'
              ? 'Loading…'
              : models.status === 'error'
                ? 'Retry models'
                : 'Load models'}
          </Button>
        )}
      </Stack>
      {models.status === 'loading' && (
        <>
          <LinearProgress sx={{ mt: 2 }} />
          <Typography variant="caption" color="text.secondary">
            Preparing local inference. The first load includes the SFace model.
          </Typography>
        </>
      )}
      {models.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {models.error}
        </Alert>
      )}
    </Box>
  );
}

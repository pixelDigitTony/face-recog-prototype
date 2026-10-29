import { Box, LinearProgress, Typography } from '@mui/material';
export function StorageUsage({ state }) {
  const percentage =
    (state.estimatedBytes / (state.database?.settings.maxEstimatedBytes || 3145728)) * 100;
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption">Browser storage</Typography>
        <Typography variant="caption">
          {(state.estimatedBytes / 1048576).toFixed(2)} / 3 MB
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, percentage)}
        color={percentage >= 80 ? 'warning' : 'primary'}
        sx={{ height: 5, borderRadius: 3, bgcolor: '#dce6de' }}
      />
    </Box>
  );
}

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Box } from '@mui/material';

export function RecordDetailsDialog({ record, onClose }) {
  return (
    <Dialog open={Boolean(record)} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Stored record</DialogTitle>
      <DialogContent>
        {record?.thumbnailDataUrl && (
          <Box
            component="img"
            src={record.thumbnailDataUrl}
            alt="Stored capture thumbnail"
            sx={{ width: 96, height: 96, borderRadius: 2, mb: 2 }}
          />
        )}
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 2,
            bgcolor: '#f5f7f5',
            borderRadius: 2,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            fontSize: 12,
            maxHeight: '60vh',
            overflow: 'auto',
          }}
        >
          {JSON.stringify(record, null, 2)}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

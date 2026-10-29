import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';

export function CameraPreview({ camera, imageUrl, onImage, disabled, imageOnly = false }) {
  return (
    <>
      <Box
        sx={{
          position: 'relative',
          aspectRatio: '4 / 3',
          bgcolor: '#102e28',
          borderRadius: 2,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Box
          component="video"
          ref={camera.videoRef}
          muted
          playsInline
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)',
            display: camera.active && !imageUrl ? 'block' : 'none',
          }}
        />
        {imageUrl && (
          <Box
            component="img"
            src={imageUrl}
            alt="Selected test image"
            sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
        {!camera.active && !imageUrl && (
          <Stack
            alignItems="center"
            spacing={1.5}
            sx={{ color: '#d6e7de', p: 3, textAlign: 'center' }}
          >
            <VideocamOutlinedIcon sx={{ fontSize: 42, opacity: 0.75 }} />
            <Typography fontWeight={600}>Your camera preview</Typography>
            <Typography variant="body2" sx={{ color: '#92aaa0' }}>
              Start your camera when you’re ready.
            </Typography>
          </Stack>
        )}
        {(camera.active || imageUrl) && (
          <Chip
            label={imageUrl ? 'Test image' : 'Live camera'}
            size="small"
            sx={{ position: 'absolute', top: 16, left: 16, bgcolor: '#fff', fontWeight: 600 }}
          />
        )}
        <Box
          sx={{
            position: 'absolute',
            inset: '14% 24%',
            border: '1px dashed rgba(218,239,218,.45)',
            borderRadius: '45%',
            pointerEvents: 'none',
            display: camera.active && !imageUrl ? 'block' : 'none',
          }}
        />
      </Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        {!imageOnly && (
          <Button
            size="small"
            startIcon={<VideocamOutlinedIcon />}
            disabled={disabled || camera.starting}
            onClick={camera.active ? camera.stop : camera.start}
          >
            {camera.active ? 'Stop camera' : camera.starting ? 'Opening…' : 'Start camera'}
          </Button>
        )}
        <Button size="small" component="label" disabled={disabled}>
          Use test image
          <input
            aria-label="Choose test image"
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onImage}
          />
        </Button>
      </Stack>
    </>
  );
}

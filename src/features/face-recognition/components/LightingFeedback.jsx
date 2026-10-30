import { Box } from '@mui/material';
import { LIGHTING_FEEDBACK } from '@/utils/hooks/faceRecognition/recognition/lightingQuality';

export function LightingFeedback({ lighting, guidance = false }) {
  const warnings = lighting?.warnings?.filter((code) => LIGHTING_FEEDBACK[code]) ?? [];
  if (!warnings.length) return null;
  return (
    <Box data-testid="lighting-feedback" sx={{ mt: 0.5, fontSize: '0.75rem' }}>
      {warnings.map((code) => (
        <Box key={code}>
          <Box component="span" sx={{ fontWeight: 700 }}>
            {LIGHTING_FEEDBACK[code].label}
          </Box>
          {guidance && ` · ${LIGHTING_FEEDBACK[code].guidance}`}
        </Box>
      ))}
    </Box>
  );
}

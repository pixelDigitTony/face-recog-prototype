import { CssBaseline, ThemeProvider } from '@mui/material';
import { FaceRecognitionModule } from '@/features/face-recognition';
import { theme } from '@/theme/theme';
export function AppProviders({ services, children }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <FaceRecognitionModule services={services}>{children}</FaceRecognitionModule>
    </ThemeProvider>
  );
}

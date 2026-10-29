import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Container,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { NavLink, useLocation } from 'react-router-dom';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { useFaceServices, useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { StorageUsage } from '@/features/face-recognition/components/StorageUsage';
import { downloadJson } from '@/utils/hooks/faceRecognition/downloadJson';
import { AppRoutes } from './router';

const links = [
  ['/enroll', 'Enroll', PersonAddAltOutlinedIcon],
  ['/scan', 'Scan face', CenterFocusStrongOutlinedIcon],
  ['/database', 'Local database', StorageOutlinedIcon],
  ['/settings', 'Settings', TuneOutlinedIcon],
];
export function App() {
  const state = useLocalDatabase(),
    { repository } = useFaceServices(),
    location = useLocation();
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="aside"
        sx={{
          width: 236,
          flexShrink: 0,
          bgcolor: '#fff',
          borderRight: 1,
          borderColor: 'divider',
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          p: 3,
          position: 'fixed',
          inset: '0 auto 0 0',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 5 }}>
          <Box
            sx={{ bgcolor: 'primary.main', color: 'white', borderRadius: 2, p: 1, display: 'flex' }}
          >
            <FingerprintIcon />
          </Box>
          <Box>
            <Typography fontWeight={750} fontSize={20} letterSpacing="-.5px">
              STK{' '}
              <Box component="span" sx={{ fontWeight: 400 }}>
                Face Lab
              </Box>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              RECOGNITION PROTOTYPE
            </Typography>
          </Box>
        </Stack>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ mb: 1, fontSize: 10, letterSpacing: '1.5px' }}
        >
          WORKSPACE
        </Typography>
        <Stack spacing={0.75}>
          {links.map(([path, label, Icon]) => (
            <Button
              key={path}
              component={NavLink}
              to={path}
              startIcon={<Icon />}
              sx={{
                justifyContent: 'flex-start',
                px: 2,
                color: 'text.secondary',
                '&.active': { bgcolor: '#edf4ea', color: 'primary.main' },
                py: 1.5,
              }}
            >
              {label}
            </Button>
          ))}
        </Stack>
        <Box sx={{ mt: 'auto' }}>
          <Card sx={{ p: 2, bgcolor: '#f4f7ef', mb: 3, boxShadow: 'none' }}>
            <Typography variant="body2" fontWeight={650} sx={{ mb: 1 }}>
              Built for local testing
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Your enrollments and captures stay in this browser.
            </Typography>
            <ArrowOutwardIcon
              sx={{ display: 'block', fontSize: 18, mt: 1, color: 'primary.main' }}
            />
          </Card>
          <StorageUsage state={state} />
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">
            STK · Development workspace
          </Typography>
        </Box>
      </Box>
      <Box sx={{ ml: { xs: 0, md: '236px' }, flex: 1, minWidth: 0 }}>
        <Box
          component="header"
          sx={{
            px: { xs: 2, md: 4 },
            height: 76,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            bgcolor: 'white',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            <Box component="span" sx={{ fontWeight: 650, color: 'text.primary' }}>
              Face Lab
            </Box>{' '}
            &nbsp; / &nbsp; {links.find(([path]) => path === location.pathname)?.[1] ?? 'Workspace'}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label="Frontend only"
              variant="outlined"
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            />
            <Chip
              size="small"
              label="Prototype"
              sx={{ bgcolor: '#eaf2dc', color: '#40552e', fontWeight: 600 }}
            />
          </Stack>
        </Box>
        <Box
          component="nav"
          aria-label="Workspace navigation"
          sx={{
            display: { xs: 'flex', md: 'none' },
            overflowX: 'auto',
            bgcolor: 'white',
            px: 1,
            py: 1,
            gap: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {links.map(([path, label]) => (
            <Button
              key={path}
              component={NavLink}
              to={path}
              size="small"
              sx={{ whiteSpace: 'nowrap', '&.active': { bgcolor: '#edf4ea' } }}
            >
              {label}
            </Button>
          ))}
        </Box>
        <Container
          component="main"
          maxWidth="xl"
          sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, md: 4 } }}
        >
          <Alert
            severity="info"
            icon={<FingerprintIcon fontSize="small" />}
            sx={{
              mb: 3,
              bgcolor: '#edf2ec',
              color: '#445b49',
              '& .MuiAlert-icon': { color: '#56775c' },
            }}
          >
            Prototype — data is stored in this browser. Liveness is not checked.
          </Alert>
          {state.mode === 'loading' && <LinearProgress sx={{ mb: 2 }} />}
          {['readonly', 'recovery', 'unavailable'].includes(state.mode) && (
            <Alert
              severity={state.mode === 'readonly' ? 'warning' : 'error'}
              sx={{ mb: 3 }}
              action={
                state.mode === 'recovery' ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={async () =>
                      downloadJson(await repository.exportJson(), 'stk-face-recovery.json')
                    }
                  >
                    Download original
                  </Button>
                ) : undefined
              }
            >
              {state.error}
              {state.mode === 'recovery' &&
                ' Use Settings to explicitly reset this prototype database.'}
            </Alert>
          )}
          {state.estimatedBytes > 0.8 * (state.database?.settings.maxEstimatedBytes || 3145728) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Storage is over 80% full. Export or delete captures before the next save reaches
              capacity.
            </Alert>
          )}
          <AppRoutes />
        </Container>
      </Box>
    </Box>
  );
}

import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#174f43', dark: '#103d33', light: '#edf6f1' },
    secondary: { main: '#d6e8a7' },
    background: { default: '#f6f7f5', paper: '#fff' },
    text: { primary: '#172c28', secondary: '#66746f' },
    divider: '#e4e9e5',
    success: { main: '#23784a' },
    error: { main: '#b43835' },
  },
  typography: {
    fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-1px' },
    h5: { fontWeight: 700, letterSpacing: '-.5px' },
    h6: { fontWeight: 650 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, padding: '10px 18px' } },
    },
    MuiCard: {
      styleOverrides: {
        root: { border: '1px solid #e4e9e5', boxShadow: '0 2px 8px rgba(25,55,40,.025)' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { backgroundColor: '#f6f8f6', color: '#66746f', fontSize: 12, fontWeight: 600 },
        root: { borderColor: '#edf0ed' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 8 } } },
  },
});

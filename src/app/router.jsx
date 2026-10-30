import { Navigate, Route, Routes } from 'react-router-dom';
import {
  EnrollmentPage,
  ScanPage,
  DatabasePage,
  SettingsPage,
  EvaluationPage,
} from '@/features/face-recognition';
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/enroll" element={<EnrollmentPage />} />
      <Route path="/scan" element={<ScanPage />} />
      <Route path="/database" element={<DatabasePage />} />
      <Route path="/evaluate" element={<EvaluationPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/enroll" replace />} />
    </Routes>
  );
}

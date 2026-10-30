import { EvaluationPage } from './pages/EvaluationPage';
import { FaceServicesContext } from './servicesContext';
import { EnrollmentPage } from './pages/EnrollmentPage';
import { ScanPage } from './pages/ScanPage';
import { DatabasePage } from './pages/DatabasePage';
import { SettingsPage } from './pages/SettingsPage';

export function FaceRecognitionModule({ services, children }) {
  return <FaceServicesContext.Provider value={services}>{children}</FaceServicesContext.Provider>;
}
export const featurePages = {
  enroll: EnrollmentPage,
  scan: ScanPage,
  database: DatabasePage,
  settings: SettingsPage,
  evaluate: EvaluationPage,
};

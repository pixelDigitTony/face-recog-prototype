import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AppProviders } from './app/providers';
import { prototypeContext } from './app/config';
import { createPrototypeServices } from './utils/hooks/faceRecognition/createPrototypeServices';

const baseUrl = new URL(import.meta.env.BASE_URL, location.origin).href;
const services = createPrototypeServices({ context: prototypeContext, baseUrl });
createRoot(document.getElementById('root')).render(
  <AppProviders services={services}>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </AppProviders>,
);
window.addEventListener('pagehide', () => services.dispose(), { once: true });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});

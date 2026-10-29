import { useEffect, useState } from 'react';
import { useFaceServices } from './useLocalDatabase';

export function useModels() {
  const { engine } = useFaceServices();
  const [state, setState] = useState({
    status: engine.manifest ? 'ready' : 'idle',
    manifest: engine.manifest,
    error: null,
  });
  async function initialize() {
    setState({ status: 'loading', manifest: null, error: null });
    try {
      const manifest = await engine.initialize();
      setState({ status: 'ready', manifest, error: null });
    } catch (error) {
      setState({ status: 'error', manifest: null, error: error.message });
    }
  }
  // Initialization is explicit. Navigating to an already loaded engine reuses its worker.
  useEffect(() => {
    setState({
      status: engine.manifest ? 'ready' : 'idle',
      manifest: engine.manifest,
      error: null,
    });
  }, [engine]);
  return { ...state, initialize };
}

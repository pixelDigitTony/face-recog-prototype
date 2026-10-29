import { useEffect, useRef, useState } from 'react';
import { useFaceServices } from './useLocalDatabase';

export function useFaceWorkflow() {
  const { workflow } = useFaceServices();
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(null),
    [error, setError] = useState(null);
  const mounted = useRef(true),
    controller = useRef(null),
    running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function run(purpose, personId, capture) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    controller.current = new AbortController();
    try {
      const value = await workflow[purpose]({
        personId,
        capture,
        signal: controller.current.signal,
      });
      if (mounted.current) setResult(value);
    } catch (error) {
      if (mounted.current && error.name !== 'AbortError') setError(error.message);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function retry() {
    setBusy(true);
    try {
      const next = await workflow.retrySave(result.attemptId);
      if (mounted.current) setResult(next);
    } catch (error) {
      if (mounted.current) setError(error.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function discard() {
    if (result) workflow.discard(result.attemptId);
    setResult(null);
  }
  return { run, busy, result, error, retry, discard };
}

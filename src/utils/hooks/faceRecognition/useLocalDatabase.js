import { useContext, useEffect, useSyncExternalStore } from 'react';
import { FaceServicesContext } from '@/features/face-recognition/servicesContext';

export function useFaceServices() {
  const services = useContext(FaceServicesContext);
  if (!services) throw new Error('FaceRecognitionModule requires injected services.');
  return services;
}
export function useLocalDatabase() {
  const { repository } = useFaceServices();
  useEffect(() => {
    repository.load();
  }, [repository]);
  return useSyncExternalStore(repository.subscribe, repository.getSnapshot);
}

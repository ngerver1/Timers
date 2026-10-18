// New versions: the service worker downloads them in the background and the app
// offers an Update button, rather than reloading itself mid-morning.
import { useRegisterSW } from 'virtual:pwa-register/react';

export interface AppUpdate {
  ready: boolean;
  apply: () => void;
}

export function useAppUpdate(): AppUpdate {
  const {
    needRefresh: [ready],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => void registration.update().catch(() => undefined); // offline: try later
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    },
  });
  return { ready, apply: () => void updateServiceWorker(true) };
}

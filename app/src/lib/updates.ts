import { registerSW } from 'virtual:pwa-register';

// Keeps the installed app current: checks for a new version on open, whenever the app comes back to the
// front, and every 30 seconds while it is open. When a new version is found it installs and the page reloads by itself.
export function keepAppFresh() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  const update = registerSW({ immediate: true, onRegisteredSW: (_url, reg) => {
    if (!reg) return;
    const check = () => { void reg.update().catch(() => undefined); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.addEventListener('online', check);
    window.setInterval(() => { if (document.visibilityState === 'visible') check(); }, 30 * 1000);
  } });
  void update;
}

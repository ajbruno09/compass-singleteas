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
  // Safety net: if the service worker is stuck, compare the running bundle with the one the server has now.
  // When they differ, clear the caches and the service worker, then reload.
  const mine = () => (document.querySelector('script[type="module"][src*="assets/index-"]') as HTMLScriptElement | null)?.getAttribute('src') ?? '';
  const healIfStale = async () => {
    try {
      if (document.visibilityState !== 'visible' || reloaded) return;
      const html = await fetch('/index.html?hb=' + Date.now(), { cache: 'no-store' }).then((r) => r.text());
      const live = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0]; const now = mine().match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
      if (!live || !now || live === now) return;
      reloaded = true;
      const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister()));
      if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      window.location.reload();
    } catch { /* offline or blocked, try again next time */ }
  };
  window.setInterval(() => { void healIfStale(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { void healIfStale(); });
  void healIfStale();
}

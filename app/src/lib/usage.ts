import { useEffect } from 'react';
import { supabase } from './supabase';

// Counts one minute for every minute the person is really using the app: tapping, typing or scrolling,
// with the screen on and the app in front. An app left open and untouched stops counting after 2 minutes.
export function useUsagePing(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    let lastMinute = -1;
    const touch = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const tick = () => {
      if (document.hidden || Date.now() - last > 120000) return;
      const m = Math.floor(Date.now() / 60000);
      if (m === lastMinute) return;
      lastMinute = m;
      void supabase.rpc('usage_ping');
    };
    const id = window.setInterval(tick, 20000);
    tick();
    return () => { window.clearInterval(id); events.forEach((e) => window.removeEventListener(e, touch)); };
  }, [enabled]);
}

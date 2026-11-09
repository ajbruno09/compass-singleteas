import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Gate { pending: number; old: number; released: boolean; blocked: boolean }

// What the store has issued that a counter has not yet confirmed, and whether yesterday's issues block indent and SOS.
export function useReceiveGate(ids: number[]) {
  const key = ids.join(',');
  const [gates, setGates] = useState<Record<number, Gate>>({});
  const load = useCallback(async () => {
    if (!ids.length) { setGates({}); return; }
    const rs = await Promise.all(ids.map((id) => supabase.rpc('receive_gate', { p_location: id })));
    setGates(Object.fromEntries(ids.map((id, i) => [id, (rs[i].data as Gate | null) ?? { pending: 0, old: 0, released: false, blocked: false }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void load();
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('compass:gate', again); document.addEventListener('visibilitychange', again); window.addEventListener('focus', again);
    const iv = window.setInterval(again, 60000);
    return () => { window.removeEventListener('compass:gate', again); document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); window.clearInterval(iv); };
  }, [load]);
  const pending = ids.reduce((a, id) => a + (gates[id]?.pending ?? 0), 0);
  return { gates, pending, reload: load };
}

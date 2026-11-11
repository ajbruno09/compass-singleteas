import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';

// Floats above SOS for the people who weigh the LPG at closing. Pulses until tonight's weighing is done.
export function GasFab() {
  const { profile } = useSession();
  const nav = useNavigate();
  const here = useLocation().pathname;
  const [rows, setRows] = useState<{ weighed_today: boolean }[]>([]);
  const [hour, setHour] = useState(() => new Date().getHours());
  const load = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase.rpc('gas_to_weigh');
    setRows((data as { weighed_today: boolean }[]) ?? []);
    setHour(new Date().getHours());
  }, [profile]);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 60000); return () => window.clearInterval(t); }, [load, here]);
  if (here !== '/' && !here.startsWith('/indent')) return null;
  if (rows.length === 0) return null;
  const todo = rows.some((r) => !r.weighed_today);
  // Closing time (3 pm to 4 am) it pulses. Earlier in the day it stays calm, so an empty cylinder can still be reported.
  const early = hour < 15 && hour >= 4;
  if (!todo) return <div className="gasfab done" aria-live="polite">LPG weighed ✓</div>;
  return <button className={early ? 'gasfab calm' : 'gasfab'} onClick={() => nav('/gas')} aria-label="Weigh the LPG cylinders now">⚖ Weigh LPG</button>;
}

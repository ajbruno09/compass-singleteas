import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { SosButton } from './Sos';

const KEY = 'compass.counter';
export const getCounter = (ids: number[]) => { try { const v = Number(sessionStorage.getItem(KEY)); if (ids.includes(v)) return v; } catch { /* ignore */ } return ids[0] ?? 0; };
export const setCounter = (id: number) => { try { sessionStorage.setItem(KEY, String(id)); } catch { /* ignore */ } window.dispatchEvent(new Event('compass:counter')); };

// Staff shell: the bottom bar from the approved mock (Home, Indent, Closing, SOS) on every staff screen.
export function StaffShell() {
  const { myLocations } = useSession();
  const nav = useNavigate();
  const here = useLocation().pathname;
  const [due, setDue] = useState(0);
  const ids = myLocations.map((l) => l.id);
  const loc = getCounter(ids);
  useEffect(() => {
    (async () => {
      if (!ids.length) return;
      const bd = await supabase.rpc('business_date', { p_at: new Date().toISOString() });
      const { data } = await supabase.from('stock_counts').select('location_id').in('location_id', ids).eq('business_date', String(bd.data)).eq('frequency', 'daily').eq('status', 'submitted');
      const done = new Set(((data as { location_id: number }[]) ?? []).map((r) => r.location_id));
      setDue(ids.filter((i) => !done.has(i)).length);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(','), here]);
  const tab = here === '/' ? 'home' : here.startsWith('/indent') ? 'indent' : here.startsWith('/count') || here.startsWith('/closing') ? 'closing' : '';
  const items: [string, string, string, number, () => void][] = [
    ['home', '🏠', 'Home', 0, () => nav('/')],
    ['indent', '📝', 'Indent', 0, () => nav(`/indent?loc=${loc}`)],
    ['closing', '🧮', 'Closing', due, () => nav('/closing')],
    ['sos', '🚨', 'SOS', 0, () => window.dispatchEvent(new Event('compass:sos'))]
  ];
  return (
    <div className="staffshell">
      <Outlet />
      {myLocations.length > 0 && <SosButton locations={myLocations} defaultId={loc} hideFab />}
      <nav className="staffnav" aria-label="Main">
        {items.map(([k, e, l, n, go]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={go} aria-current={tab === k ? 'page' : undefined}><span aria-hidden>{e}</span>{l}{n > 0 && <i>{n}</i>}</button>
        ))}
      </nav>
    </div>
  );
}

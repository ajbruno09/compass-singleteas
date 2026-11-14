import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Icon } from '../components/Icon';
import { getCounter, setCounter } from '../components/StaffNav';

interface It { id: number; count_frequency: string }

// Closing stock: Daily, Weekly, or Monthly. Nothing is listed until one is chosen.
export function ClosingHub() {
  const { myLocations } = useSession();
  const nav = useNavigate();
  const ids = myLocations.map((l) => l.id);
  const [loc, setLoc] = useState(getCounter(ids));
  const [n, setN] = useState({ daily: 0, weekly: 0, monthly: 0 });
  const [done, setDone] = useState({ daily: false, weekly: false, monthly: false });
  const [wk, setWk] = useState<{ open: boolean; sunday: boolean; override: boolean } | null>(null);
  const [mo, setMo] = useState<{ open: boolean; first_of_month: boolean; override: boolean } | null>(null);
  useEffect(() => {
    (async () => {
      if (!loc) return;
      const { data } = await supabase.rpc('department_items', { p_location_id: loc });
      const list = (data as It[]) ?? [];
      setN({ daily: list.filter((i) => i.count_frequency === 'daily').length, weekly: list.filter((i) => i.count_frequency !== 'off').length, monthly: list.filter((i) => i.count_frequency === 'monthly').length });
      const bd = String((await supabase.rpc('business_date', { p_at: new Date().toISOString() })).data);
      const [d, w, m, st, mst] = await Promise.all([
        supabase.from('stock_counts').select('status').eq('location_id', loc).eq('frequency', 'daily').eq('business_date', bd).eq('status', 'submitted').limit(1),
        supabase.from('stock_counts').select('status').eq('location_id', loc).eq('frequency', 'weekly').eq('business_date', bd).eq('status', 'submitted').limit(1),
        supabase.from('stock_counts').select('status').eq('location_id', loc).eq('frequency', 'monthly').eq('business_date', bd).eq('status', 'submitted').limit(1),
        supabase.rpc('weekly_status', { p_location: loc }),
        supabase.rpc('monthly_status', { p_location: loc })
      ]);
      const wDone = ((w.data as unknown[]) ?? []).length > 0;
      const mDone = ((m.data as unknown[]) ?? []).length > 0;
      setDone({ daily: ((d.data as unknown[]) ?? []).length > 0 || wDone, weekly: wDone, monthly: mDone });
      setWk((st.data as typeof wk) ?? { open: false, sunday: false, override: false });
      setMo((mst.data as typeof mo) ?? { open: false, first_of_month: false, override: false });
    })();
  }, [loc]);
  const Big = ({ e, h, sub, ok, freq, off }: { e: string; h: string; sub: string; ok: boolean; freq: string; off?: boolean }) => (
    <button className="countercard" disabled={off && !ok} style={off && !ok ? { opacity: 0.45, filter: 'grayscale(1)', cursor: 'default' } : undefined} onClick={() => nav(`/count?loc=${loc}&freq=${freq}`)}>
      <span style={{ color: 'var(--brand)' }}><Icon name={e} size={32} stroke={1.6} /></span>
      <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>{h}</span><span className="small muted">{sub}</span></span>
      <span className={'chip ' + (ok ? 'done' : off ? 'off' : 'due')}>{ok ? 'Done ✓' : off ? 'Not today' : 'Open'}</span>
    </button>
  );
  return (
    <div className="phone">
      <div className="phone-head"><b style={{ font: '800 20px/24px var(--font-display)' }}>Closing stock</b></div>
      {myLocations.length > 1 && <div className="countersw" role="group" aria-label="Counter">{myLocations.map((l) => <button key={l.id} className={l.id === loc ? 'on' : ''} onClick={() => { setCounter(l.id); setLoc(l.id); }}>{l.name}</button>)}</div>}
      <p className="muted">What would you like to count{myLocations.length > 1 ? ` for ${myLocations.find((l) => l.id === loc)?.name ?? ''}` : ''}?</p>
      <Big e="sun" h="Daily" sub={wk?.open ? 'Not today, it is the weekly count' : `${n.daily} cost items · chicken, paneer, eggs, oil`} ok={done.daily} freq="daily" off={!!wk?.open} />
      <Big e="cal" h="Weekly" sub={wk?.open ? `All ${n.weekly} items, count everything once` : 'Sundays only, unless Admin opens it'} ok={done.weekly} freq="weekly" off={!wk?.open} />
      {n.monthly > 0 && <Big e="cal" h="Monthly" sub={mo?.open ? `${n.monthly} items counted once a month` : 'Open on the 1st, unless Admin opens it'} ok={done.monthly} freq="monthly" off={!mo?.open} />}
      <div className="card small muted">On a weekly day the weekly list has every item and the daily count is not needed. Every item must be counted. Enter 0 if you have none.</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Icon } from '../components/Icon';
import { getCounter, setCounter } from '../components/StaffNav';

interface It { id: number; count_frequency: string }

// Closing stock: two big choices, Daily or Weekly. Nothing is listed until one is chosen.
export function ClosingHub() {
  const { myLocations } = useSession();
  const nav = useNavigate();
  const ids = myLocations.map((l) => l.id);
  const [loc, setLoc] = useState(getCounter(ids));
  const [n, setN] = useState({ daily: 0, weekly: 0 });
  const [done, setDone] = useState({ daily: false, weekly: false });
  useEffect(() => {
    (async () => {
      if (!loc) return;
      const { data } = await supabase.rpc('department_items', { p_location_id: loc });
      const list = (data as It[]) ?? [];
      setN({ daily: list.filter((i) => i.count_frequency === 'daily').length, weekly: list.filter((i) => i.count_frequency === 'weekly').length });
      const bd = String((await supabase.rpc('business_date', { p_at: new Date().toISOString() })).data);
      const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const monStr = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
      const [d, w] = await Promise.all([
        supabase.from('stock_counts').select('status').eq('location_id', loc).eq('frequency', 'daily').eq('business_date', bd).eq('status', 'submitted').limit(1),
        supabase.from('stock_counts').select('status').eq('location_id', loc).eq('frequency', 'weekly').gte('business_date', monStr).eq('status', 'submitted').limit(1)
      ]);
      setDone({ daily: ((d.data as unknown[]) ?? []).length > 0, weekly: ((w.data as unknown[]) ?? []).length > 0 });
    })();
  }, [loc]);
  const Big = ({ e, h, sub, ok, freq }: { e: string; h: string; sub: string; ok: boolean; freq: string }) => (
    <button className="countercard" onClick={() => nav(`/count?loc=${loc}&freq=${freq}`)}>
      <span style={{ color: 'var(--brand)' }}><Icon name={e} size={32} stroke={1.6} /></span>
      <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>{h}</span><span className="small muted">{sub}</span></span>
      <span className={'chip ' + (ok ? 'done' : 'due')}>{ok ? 'Done ✓' : 'Open'}</span>
    </button>
  );
  return (
    <div className="phone">
      <div className="phone-head"><b style={{ font: '800 20px/24px var(--font-display)' }}>Closing stock</b></div>
      {myLocations.length > 1 && <div className="countersw" role="group" aria-label="Counter">{myLocations.map((l) => <button key={l.id} className={l.id === loc ? 'on' : ''} onClick={() => { setCounter(l.id); setLoc(l.id); }}>{l.name}</button>)}</div>}
      <p className="muted">What would you like to count{myLocations.length > 1 ? ` for ${myLocations.find((l) => l.id === loc)?.name ?? ''}` : ''}?</p>
      <Big e="sun" h="Daily" sub={`${n.daily} cost items · chicken, paneer, eggs, oil`} ok={done.daily} freq="daily" />
      <Big e="cal" h="Weekly" sub={`${n.weekly} items · spices, masalas, non food`} ok={done.weekly} freq="weekly" />
      <div className="card small muted">Items you count daily are not repeated in the weekly list. Every item must be counted. Enter 0 if you have none.</div>
    </div>
  );
}

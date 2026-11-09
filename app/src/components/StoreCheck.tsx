import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { errText } from '../lib/format';

export interface HealthItem { key: string; sev: 'red' | 'amber' | 'blue'; title: string; detail: string; route: string; state: 'open' | 'claimed' | 'promised' | 'snoozed'; until: string | null; age_days: number; shown: number; still_open: boolean }
type Local = Record<string, { k: 'done' | 'later'; w: string }>;
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const at = (hour: number, dayOffset = 0) => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); const off = new Date().getTime() - new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getTime(); return new Date(d.getTime() + off).toISOString(); };

export function useHealth() {
  const [items, setItems] = useState<HealthItem[] | null>(null);
  const load = useCallback(async () => { const { data } = await supabase.rpc('store_health'); setItems((data as HealthItem[]) ?? []); }, []);
  useEffect(() => { void load(); }, [load]);
  return { items, load };
}

export function StoreCheck() {
  const { items, load } = useHealth();
  const toast = useToast();
  const [local, setLocal] = useState<Local>({});
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { const c = () => setMenu(null); document.addEventListener('click', c); return () => document.removeEventListener('click', c); }, []);
  if (!items) return null;

  const hidden = (i: HealthItem) => local[i.key] ?? (i.state === 'claimed' ? { k: 'done' as const, w: '' } : (i.state === 'snoozed' || i.state === 'promised') && i.until && new Date(i.until) > new Date() ? { k: 'later' as const, w: i.state === 'promised' ? 'I will do it today. Asks again at 5 pm' : 'reminder set' } : null);
  const open = items.filter((i) => !hidden(i)).length;
  async function act(i: HealthItem, action: 'done' | 'today' | 'later' | 'undo', until?: string, w?: string) {
    setMenu(null);
    if (action === 'undo') setLocal((l) => { const n = { ...l }; delete n[i.key]; return n; });
    else setLocal((l) => ({ ...l, [i.key]: action === 'done' ? { k: 'done', w: '' } : { k: 'later', w: w ?? '' } }));
    const { error } = await supabase.rpc('health_act', { p_key: i.key, p_action: action, p_until: until ?? null });
    if (error) { toast(errText(error)); setLocal((l) => { const n = { ...l }; delete n[i.key]; return n; }); }
    else if (action === 'undo') void load();
  }
  return (
    <section className="card chk">
      <div className="chk-head"><h2>Morning check <span className={'chk-n' + (open ? '' : ' z')}>{open ? open : '✓'}</span></h2><span className="small muted">Every morning</span></div>
      {items.length === 0 && <p className="small muted" style={{ padding: '4px 14px 10px' }}>All clear. Nothing needs your attention.</p>}
      {items.map((i) => {
        const h = hidden(i);
        if (h?.k === 'done') return <div className="chk-row" key={i.key}><span className="chk-dot ok" /><div className="chk-t"><span className="small" style={{ color: 'var(--ok)' }}>✓ {i.title}: marked done. Compass will check.</span> <button className="chk-undo" onClick={() => void act(i, 'undo')}>Undo</button></div></div>;
        if (h?.k === 'later') return <div className="chk-row" key={i.key}><span className="chk-dot off" /><div className="chk-t"><span className="small muted">{i.title}: {h.w}.</span> <button className="chk-undo" onClick={() => void act(i, 'undo')}>Undo</button></div></div>;
        return (
          <div className="chk-row" key={i.key} style={{ position: 'relative' }}>
            <span className={'chk-dot ' + i.sev} />
            <div className="chk-t"><Link to={i.route}>{i.title}</Link>
              <span>{i.still_open ? 'Compass still sees this open · ' : ''}{i.detail}{i.age_days > 0 ? ` · Day ${i.age_days + 1}` : i.shown > 1 ? ` · Shown ${i.shown}×` : ' · New'}</span></div>
            <div className="chk-acts">
              <button className="chk-b ok" onClick={() => void act(i, 'done')}>Done</button>
              <button className="chk-b" onClick={(e) => { e.stopPropagation(); setMenu(menu === i.key ? null : i.key); }}>Later ▾</button>
            </div>
            {menu === i.key && (
              <div className="chk-menu" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => void act(i, 'today', undefined, 'I will do it today. Asks again at 5 pm')}>I will do it today</button><hr />
                <button onClick={() => void act(i, 'later', hoursFromNow(1), 'reminder in 1 hour')}>Remind me in 1 hour</button>
                <button onClick={() => void act(i, 'later', at(14), 'reminder this afternoon')}>This afternoon</button>
                <button onClick={() => void act(i, 'later', at(8, 1), 'reminder tomorrow morning')}>Tomorrow morning</button>
              </div>
            )}
          </div>
        );
      })}
      <div className="chk-foot">Items stay here until Compass sees them done. Open for 2 days, Admin sees them too.</div>
    </section>
  );
}

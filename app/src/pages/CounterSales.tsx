import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { Sheet } from '../components/Sheet';
import '../counter-sales.css';

interface RowD { d: string; g: string; item: string; qty: number; net: number }
interface Data { days: string[]; rows: RowD[]; staff: { d: string; qty: number }[] }
// how each group from the sales report is shown here
const LABEL: Record<string, string> = { 'Hot Beverages': 'Hot brew', 'Joos & Shakes': 'Joos & Shakes', 'South Indian': 'South Indian & biryani', 'Ice Creams': 'Ice creams' };
const ORDER = ['Hot Beverages', 'Tandoor', 'Snacks', 'South Indian', 'Continental', 'Joos & Shakes', 'Indian', 'Chinese', 'Ice Creams'];
const label = (g: string) => LABEL[g] ?? g;
const dd = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const yest = () => new Date(Date.now() + 5.5 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
interface Item { item: string; byDay: Record<string, number> }

export function CounterSales() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [day, setDay] = useState<string>('');   // an ISO date, or 'w' for the last 7 days
  const [cur, setCur] = useState('');
  const [all, setAll] = useState(false);
  const [view, setView] = useState<'counter' | 'moves'>('counter');
  const [open, setOpen] = useState<{ g: string; it: Item } | null>(null);

  useEffect(() => {
    supabase.rpc('counter_sales').then(({ data: d, error }) => { if (error) { setErr(errText(error)); return; } setData(d as Data); });
  }, []);
  const days = data?.days ?? [];
  useEffect(() => { if (days.length && !day) setDay(days[0]); }, [days, day]);

  // group -> item -> pieces per day
  const by = useMemo(() => {
    const m = new Map<string, Map<string, Item>>();
    for (const r of data?.rows ?? []) {
      const gm = m.get(r.g) ?? new Map<string, Item>(); m.set(r.g, gm);
      const it = gm.get(r.item) ?? { item: r.item, byDay: {} }; gm.set(r.item, it);
      it.byDay[r.d] = (it.byDay[r.d] ?? 0) + Number(r.qty);
    }
    return m;
  }, [data]);
  const groups = useMemo(() => [...by.keys()].sort((a, b) => (ORDER.indexOf(a) + 100) % 100 - (ORDER.indexOf(b) + 100) % 100), [by]);
  useEffect(() => { if (groups.length && !groups.includes(cur)) setCur(groups[0]); }, [groups, cur]);

  const val = (it: Item, k: string) => (k === 'w' ? days.reduce((a, d) => a + (it.byDay[d] ?? 0), 0) : it.byDay[k] ?? 0);
  // usual per day = the other days we hold, so a day is compared with its own history
  const others = (k: string) => days.filter((d) => d !== k);
  const usual = (it: Item, k: string) => { const o = others(k); return o.length >= 2 ? o.reduce((a, d) => a + (it.byDay[d] ?? 0), 0) / o.length : null; };
  const total = (g: string, k: string) => [...(by.get(g)?.values() ?? [])].reduce((a, it) => a + val(it, k), 0);
  const dayLabel = (d: string) => (d === yest() ? 'Yesterday' : d === ist() ? 'Today' : dd(d));
  const vs = (it: Item) => {
    if (day === 'w') return <span className="cs-fl">7 days</span>;
    const u = usual(it, day); if (u == null || u < 1) return null;
    const p = Math.round(((val(it, day) - u) / u) * 100);
    if (Math.abs(p) < 8) return <span className="cs-fl">same</span>;
    return p > 0 ? <span className="cs-up">▲ {p}%</span> : <span className="cs-dn">▼ {-p}%</span>;
  };

  if (err) return <p className="muted">{err}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!days.length) return (<><div className="pagehead"><div><p className="label">Today</p><h1>Counter sales</h1></div></div>
    <div className="cs-card"><p className="cs-note">No item sales yet. The nightly sales report from the POS fills this page.</p></div></>);

  const list = [...(by.get(cur)?.values() ?? [])].sort((a, b) => (a.item === 'Others') as unknown as number - ((b.item === 'Others') as unknown as number) || val(b, day) - val(a, day)).filter((it) => val(it, day) > 0);
  const max = Math.max(...list.map((i) => val(i, day)), 1);
  const shown = all ? list : list.slice(0, 8);
  const hasHistory = days.length >= 3;

  const moves = (() => {
    if (!hasHistory) return [];
    const out: { g: string; it: Item; v: number; u: number; p: number }[] = [];
    for (const g of groups) for (const it of by.get(g)!.values()) { const u = usual(it, days[0]); const v = it.byDay[days[0]] ?? 0; if (u == null || u < 3) continue; out.push({ g, it, v, u, p: Math.round(((v - u) / u) * 100) }); }
    return out;
  })();
  const mk = (l: typeof moves) => l.map((x) => (
    <button key={x.g + x.it.item} className="cs-mv" onClick={() => setOpen({ g: x.g, it: x.it })}>
      <div><div>{x.it.item}</div><div className="cs-s">{label(x.g)} · {x.v} sold {dayLabel(days[0]).toLowerCase()} · usual {Math.round(x.u)}</div></div>
      <span className={x.p > 0 ? 'cs-up' : 'cs-dn'}>{x.p > 0 ? '▲' : '▼'} {Math.abs(x.p)}%</span>
    </button>));

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Today</p><h1>Counter sales</h1>
          <p className="muted small" style={{ marginTop: 2 }}>How many pieces each counter sold, from the daily sales report. Staff items are not counted.</p></div>
      </div>
      <div className="cs-days">
        {days.slice(0, 3).map((d) => <button key={d} className={`cs-chip${day === d ? ' on' : ''}`} onClick={() => setDay(d)}>{dayLabel(d)}</button>)}
        {days.length > 1 && <button className={`cs-chip${day === 'w' ? ' on' : ''}`} onClick={() => setDay('w')}>Last {days.length} days</button>}
      </div>
      <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <div className="cs-seg"><button className={view === 'counter' ? 'on' : ''} onClick={() => setView('counter')}>By counter</button><button className={view === 'moves' ? 'on' : ''} onClick={() => setView('moves')}>Going up and down</button></div>
        <span className="small muted">{day === 'w' ? `${dd(days[days.length - 1])} to ${dd(days[0])}` : dd(day)}</span>
      </div>

      {view === 'counter' ? (
        <>
          <div className="cs-tabs">{groups.map((g) => <div key={g} className={`cs-tab${g === cur ? ' on' : ''}`} onClick={() => { setCur(g); setAll(false); }}><b>{label(g)}</b><span>{total(g, day)} pieces</span></div>)}</div>
          <div className="cs-card">
            <div className="cs-head"><b>{label(cur)}</b><span className="small muted">{total(cur, day)} pieces · {list.length} items</span></div>
            {shown.map((it, i) => (
              <button key={it.item} className={`cs-row${i < 4 ? ' top' : ''}`} onClick={() => setOpen({ g: cur, it })}>
                <span className="cs-rk">{i + 1}</span><span>{it.item}</span><span className="cs-q">{val(it, day)}</span>
                <div className="cs-bar"><i style={{ width: `${(val(it, day) / max) * 100}%` }} /></div><span className="cs-vs">{vs(it)}</span>
              </button>))}
            {list.length === 0 && <p className="cs-note">Nothing sold here on this day.</p>}
            {list.length > 8 && <button className="cs-more" onClick={() => setAll(!all)}>{all ? 'Show top 8 only' : `Show all ${list.length} items`}</button>}
            {!hasHistory && <p className="cs-note">The up and down arrows appear once there are three days of item sales. {days.length} day{days.length > 1 ? 's' : ''} so far.</p>}
          </div>
        </>
      ) : hasHistory ? (
        <div className="cs-two" style={{ marginTop: 12 }}>
          <div className="cs-card"><div className="cs-head"><b>Going up</b><span className="small muted">vs the usual day</span></div>{mk([...moves].sort((a, b) => b.p - a.p).filter((x) => x.p > 0).slice(0, 6))}</div>
          <div className="cs-card"><div className="cs-head"><b>Going down</b><span className="small muted">vs the usual day</span></div>{mk([...moves].sort((a, b) => a.p - b.p).filter((x) => x.p < 0).slice(0, 6))}</div>
        </div>
      ) : (
        <div className="cs-card" style={{ marginTop: 12 }}><p className="cs-note">This view needs at least three days of item sales to compare. {days.length} day{days.length > 1 ? 's' : ''} so far, and it grows every night.</p></div>
      )}

      {open && (
        <Sheet title={open.it.item} onClose={() => setOpen(null)}>
          <p className="label">{label(open.g)}</p>
          <p className="muted small" style={{ margin: 0 }}>Pieces sold per day</p>
          {(() => {
            const ds = [...days].reverse(); const mx = Math.max(...ds.map((d) => open.it.byDay[d] ?? 0), 1);
            return <div className="cs-spark">{ds.map((d, i) => { const v = open.it.byDay[d] ?? 0; return <div key={d} className={i === ds.length - 1 ? 'last' : ''}><em>{v}</em><i style={{ height: `${(v / mx) * 70}px` }} /><span>{dd(d).split(' ')[0]}</span></div>; })}</div>;
          })()}
          <div className="cs-kv"><span>{dayLabel(days[0])}</span><b>{open.it.byDay[days[0]] ?? 0}</b></div>
          <div className="cs-kv"><span>Usual per day</span><b>{(days.reduce((a, d) => a + (open.it.byDay[d] ?? 0), 0) / days.length).toFixed(1)}</b></div>
          <div className="cs-kv"><span>Best day</span><b>{Math.max(...days.map((d) => open.it.byDay[d] ?? 0))}</b></div>
          <div className="cs-kv"><span>All {days.length} days</span><b>{days.reduce((a, d) => a + (open.it.byDay[d] ?? 0), 0)}</b></div>
        </Sheet>
      )}
    </>
  );
}

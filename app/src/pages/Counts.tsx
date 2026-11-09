import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty } from '../lib/format';
import { timeOf } from '../lib/ist';

interface Item { id: number; name: string; unit: string }
interface CountRow { id: string; location_id: number; status: string; submitted_at: string | null; stock_count_lines: { item_id: number; qty: number; expected: number | null }[] }

export function Counts() {
  const { locations } = useSession();
  const [day, setDay] = useState('');
  const [rows, setRows] = useState<CountRow[]>([]);
  const [items, setItems] = useState<Record<number, Item>>({});
  const [openId, setOpenId] = useState('');
  const [wo, setWo] = useState<{ sunday: boolean; all: boolean; locations: number[] }>({ sunday: false, all: false, locations: [] });
  const loadWo = useCallback(async () => { const { data } = await supabase.rpc('weekly_override_today'); if (data) setWo(data as typeof wo); }, []);
  useEffect(() => { void loadWo(); }, [loadWo]);
  async function toggleWeekly(id: number, on: boolean) { await supabase.rpc('set_weekly_open', { p_location: id, p_on: on }); void loadWo(); }
  useEffect(() => {
    supabase.rpc('business_date', { p_at: new Date().toISOString() }).then(({ data }) => setDay(String(data)));
    supabase.from('items').select('id, name, unit').then(({ data }) => setItems(Object.fromEntries(((data as Item[]) ?? []).map((i) => [i.id, i]))));
  }, []);
  const load = useCallback(async () => {
    if (!day) return;
    const { data } = await supabase.from('stock_counts').select('id, location_id, status, submitted_at, stock_count_lines(item_id, qty, expected)').eq('business_date', day).in('frequency', ['daily', 'weekly']).order('frequency');
    setRows((data as CountRow[]) ?? []);
  }, [day]);
  useEffect(() => { void load(); const p = window.setInterval(() => { void load(); }, 30000); return () => window.clearInterval(p); }, [load]);
  const places = locations.filter((l) => l.active);
  return (
    <>
      <div className="pagehead"><div><p className="label">Store</p><h1>Closing counts</h1><p className="muted small" style={{ marginTop: 2 }}>Each counter counts what is left at closing. Differences against the books show here and fix the stock.</p></div>
        <Link to="/count?loc=1" className="btn">Count the store</Link></div>
      <div className="stack">{places.map((l) => {
        const r = rows.find((x) => x.location_id === l.id && x.status === 'submitted') ?? rows.find((x) => x.location_id === l.id);
        const wOn = wo.sunday || wo.all || wo.locations.includes(l.id);
        const sent = r?.status === 'submitted';
        const diffs = (r?.stock_count_lines ?? []).filter((x) => x.expected != null && Math.abs(Number(x.qty) - Number(x.expected)) > 0.0005);
        const open = openId === l.id + (r?.id ?? '');
        return <div key={l.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between', cursor: sent ? 'pointer' : 'default' }} onClick={() => sent && setOpenId(open ? '' : l.id + r!.id)}>
            <div><b>{l.name}</b> {sent && <span className="muted small">· {r!.stock_count_lines.length} items · {timeOf(r!.submitted_at)}</span>}</div>
            <div className="row" style={{ gap: 8 }}>
              {l.id !== 1 && (wo.sunday ? <span className="chip off">Weekly day</span> : <button className={'btn small ' + (wOn ? 'secondary' : '')} onClick={(e) => { e.stopPropagation(); void toggleWeekly(l.id, !wo.locations.includes(l.id) && !wOn); }}>{wOn ? 'Weekly open · turn off' : 'Open weekly count today'}</button>)}
            {sent ? (diffs.length ? <span className="chip late">{diffs.length} differ</span> : <span className="chip done">Matches</span>) : r ? <span className="chip due">Counting</span> : <span className="chip off">Not counted</span>}
            </div>
          </div>
          {open && diffs.length > 0 && <div className="tablewrap" style={{ marginTop: 10 }}><table><thead><tr><th>Item</th><th className="r">Books said</th><th className="r">Counted</th><th className="r">Difference</th></tr></thead>
            <tbody>{diffs.map((d) => { const it = items[d.item_id]; const df = Number(d.qty) - Number(d.expected); return <tr key={d.item_id}><td>{it?.name}</td><td className="r num">{fmtQty(Number(d.expected), it?.unit)}</td><td className="r num">{fmtQty(Number(d.qty), it?.unit)}</td><td className="r num" style={{ color: df < 0 ? '#A35405' : '#1C7A53', fontWeight: 700 }}>{df > 0 ? '+' : ''}{fmtQty(df, it?.unit)}</td></tr>; })}</tbody></table></div>}
        </div>; })}</div>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { useToast } from './Toast';

interface Line { item_id: number; name: string; unit: string; need: number; issued: number; mode: 'store' | 'buy' | null; have: number }
interface Order { id: number; name: string; qty: number; for_date: string; urgent: boolean; by: string; lines: Line[] }
const n2 = (n: number) => String(Math.round(n * 1000) / 1000);
const dlabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Issue the ingredients of a production order against the order itself.
export function ProdIssue() {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('prod_orders_open');
    setOrders(((data as Order[]) ?? []).map((o) => ({ ...o, qty: Number(o.qty), lines: o.lines.map((l) => ({ ...l, need: Number(l.need), issued: Number(l.issued), have: Number(l.have) })) })));
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => window.clearInterval(id);
  }, [load]);
  if (orders.length === 0) return null;

  const rem = (l: Line) => Math.max(0, l.need - l.issued);
  const can = (l: Line) => l.mode != null && rem(l) > 1e-9 && l.have > 1e-9;
  const suggest = (l: Line) => Math.min(l.have, rem(l));
  const val = (o: Order, l: Line) => vals[`${o.id}:${l.item_id}`] ?? (can(l) ? n2(suggest(l)) : '');

  async function issue(o: Order) {
    const lines = o.lines.filter((l) => can(l)).map((l) => ({ item_id: l.item_id, qty: Number(val(o, l)) })).filter((x) => x.qty > 0);
    if (!lines.length) return toast('Nothing to issue yet.');
    setBusy(o.id);
    const { error } = await supabase.rpc('prod_issue', { p_order: o.id, p_lines: lines });
    setBusy(null);
    if (error) return toast(errText(error));
    toast('Issued for ' + o.name); setVals((v) => { const n = { ...v }; for (const l of o.lines) delete n[`${o.id}:${l.item_id}`]; return n; }); await load();
  }

  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      {orders.map((o) => {
        const done = o.lines.length > 0 && o.lines.every((l) => l.mode != null && rem(l) < 1e-9);
        const undec = o.lines.filter((l) => l.mode == null).length;
        const waiting = o.lines.filter((l) => l.mode != null && rem(l) > 1e-9 && l.have <= 1e-9).length;
        const some = o.lines.some((l) => l.issued > 0);
        return (
          <div className="card" key={o.id} style={{ borderColor: 'var(--brand)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div><b>Production order: {o.name} {n2(o.qty)}</b> {o.urgent && <span className="chip late">Urgent</span>}
                <div className="muted small">{o.by ? `Asked by ${o.by} · ` : ''}needed {dlabel(o.for_date)}. Issue exactly these ingredients for this order.</div></div>
              <span className={'chip ' + (done ? 'done' : some ? 'late' : 'due')}>{done ? 'All issued' : some ? 'Partly issued' : 'Not issued yet'}</span>
            </div>
            {undec > 0 && <p className="banner warn" style={{ marginTop: 8 }}>{undec} {undec === 1 ? 'ingredient is' : 'ingredients are'} not decided yet. <Link to="/buying">Decide in Buying</Link> whether to give from the store or buy outside.</p>}
            {o.lines.length === 0 ? <p className="muted small" style={{ marginTop: 8 }}>No ingredients were asked for this order.</p> : (
              <div className="tablewrap" style={{ border: 0, boxShadow: 'none', marginTop: 8 }}>
                <table>
                  <thead><tr><th>Ingredient</th><th className="r">Needed</th><th className="r">In store</th><th className="r" style={{ width: 130 }}>Issue now</th><th>Status</th></tr></thead>
                  <tbody>{o.lines.map((l) => (
                    <tr key={l.item_id}>
                      <td><b>{l.name}</b></td>
                      <td className="r num">{n2(rem(l))} {l.unit}</td>
                      <td className="r num muted">{n2(l.have)} {l.unit}</td>
                      <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110 }} aria-label={`Issue ${l.name}`} disabled={!can(l)} value={val(o, l)} onChange={(e) => setVals((v) => ({ ...v, [`${o.id}:${l.item_id}`]: e.target.value.replace(/[^0-9.]/g, '') }))} /></td>
                      <td>{rem(l) < 1e-9 && l.mode != null ? <span className="chip done">Issued</span>
                        : l.mode == null ? <span className="chip due">Not decided</span>
                        : l.have <= 1e-9 ? <span className="chip due">{l.mode === 'buy' ? 'Waiting for the purchase' : 'Not in store'}</span>
                        : l.have < rem(l) - 1e-9 ? <span className="chip late">Short by {n2(rem(l) - l.have)} {l.unit}</span> : <span className="chip">Ready</span>}</td>
                    </tr>))}</tbody>
                </table>
              </div>)}
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span className="small muted">{waiting > 0 ? `${waiting} waiting for the delivery. Issue the rest now, the others later.` : ''}</span>
              <button className="btn primary" disabled={busy === o.id || !o.lines.some((l) => can(l))} onClick={() => void issue(o)}>{busy === o.id ? 'Issuing…' : 'Issue for this order'}</button>
            </div>
          </div>);
      })}
    </div>
  );
}

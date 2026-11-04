import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty, errText } from '../lib/format';
import { timeOf } from '../lib/ist';
import { useToast } from '../components/Toast';

interface Item { id: number; name: string; unit: string }
interface IssueRow { id: string; issue_number: string; to_location_id: number; status: string; issued_at: string | null; issue_lines: { item_id: number; qty_issued: number; qty_received: number | null }[] }

export function Issue() {
  const { locations } = useSession();
  const toast = useToast();
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const [loc, setLoc] = useState<number | null>(null);
  const [day, setDay] = useState('');
  const [items, setItems] = useState<Record<number, Item>>({});
  const [asked, setAsked] = useState<Record<number, number>>({});
  const [store, setStore] = useState<Record<number, number>>({});
  const [vals, setVals] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState<number[]>([]);
  const [find, setFind] = useState('');
  const [today, setToday] = useState<IssueRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.rpc('business_date', { p_at: new Date().toISOString() }).then(({ data }) => setDay(String(data)));
    supabase.from('items').select('id, name, unit').eq('active', true).order('name').then(({ data }) => setItems(Object.fromEntries(((data as Item[]) ?? []).map((i) => [i.id, i]))));
  }, []);
  useEffect(() => { if (loc == null && counters.length) setLoc(counters[0].id); }, [counters, loc]);

  const loadToday = useCallback(async () => {
    if (!day) return;
    const { data } = await supabase.from('issues').select('id, issue_number, to_location_id, status, issued_at, issue_lines(item_id, qty_issued, qty_received)').gte('issued_at', day + 'T00:00:00+05:30').order('issued_at', { ascending: false });
    setToday((data as IssueRow[]) ?? []);
  }, [day]);
  useEffect(() => { void loadToday(); }, [loadToday]);

  useEffect(() => {
    if (!loc || !day) return;
    setVals({}); setExtra([]); setErr('');
    (async () => {
      const [ind, oh] = await Promise.all([
        supabase.from('indents').select('indent_lines(item_id, qty)').eq('location_id', loc).eq('for_date', day).in('status', ['submitted', 'locked']),
        supabase.from('stock_on_hand').select('item_id, qty').eq('location_id', 1)
      ]);
      const a: Record<number, number> = {};
      for (const r of (ind.data as { indent_lines: { item_id: number; qty: number }[] }[]) ?? []) for (const l of r.indent_lines) a[l.item_id] = (a[l.item_id] ?? 0) + Number(l.qty);
      setAsked(a);
      setStore(Object.fromEntries(((oh.data as { item_id: number; qty: number }[]) ?? []).map((r) => [r.item_id, Number(r.qty)])));
      setVals(Object.fromEntries(Object.entries(a).map(([id, q]) => [id, String(q)])));
    })();
  }, [loc, day]);

  const ids = useMemo(() => Object.keys(asked).map(Number).concat(extra.filter((e) => !(e in asked))).filter((id) => items[id]).sort((a, b) => items[a].name.localeCompare(items[b].name)), [asked, extra, items]);
  const matches = useMemo(() => find.trim().length < 2 ? [] : Object.values(items).filter((i) => i.name.toLowerCase().includes(find.toLowerCase()) && !ids.includes(i.id)).slice(0, 6), [find, items, ids]);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? '';

  async function send() {
    setErr('');
    const lines = Object.entries(vals).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ item_id: Number(id), qty: Number(v) }));
    if (!lines.length) return setErr('Enter a quantity for at least one item.');
    setBusy(true);
    const { error } = await supabase.rpc('create_issue', { p_to: loc, p_lines: lines });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast(`Issued to ${locName(loc!)}. The counter will confirm.`); setVals({}); setAsked({}); setExtra([]); void loadToday();
  }

  return (
    <>
      <div className="pagehead"><div><p className="label">Store</p><h1>Issue to counters</h1><p className="muted small" style={{ marginTop: 2 }}>Filled from what each counter asked for. Change any amount, then send. The counter confirms what it received.</p></div></div>
      <div className="seg" role="group" aria-label="Counter">{counters.map((c) => <button key={c.id} aria-pressed={loc === c.id} onClick={() => setLoc(c.id)}>{c.name}</button>)}</div>
      <div className="tablewrap"><table>
        <thead><tr><th>Item</th><th className="r">Asked</th><th className="r">In store</th><th className="r" style={{ width: 130 }}>Issue now</th></tr></thead>
        <tbody>{ids.map((id) => { const it = items[id]; const have = store[id] ?? 0; const want = Number(vals[id] ?? 0); const short = want > have;
          return <tr key={id}><td><b>{it.name}</b> <span className="muted small">{it.unit}</span></td>
            <td className="r num">{asked[id] != null ? fmtQty(asked[id], it.unit) : <span className="muted small">extra</span>}</td>
            <td className="r num" style={{ color: short ? 'var(--bad, #B42335)' : undefined, fontWeight: short ? 700 : 400 }}>{fmtQty(have, it.unit)}</td>
            <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110 }} aria-label={`Issue ${it.name}`} value={vals[id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [id]: e.target.value }))} /></td></tr>; })}</tbody>
      </table>{ids.length === 0 && <p className="empty">{loc ? `${locName(loc)} has not sent an indent for today. You can still add items below.` : ''}</p>}</div>
      <label className="field"><span>Add another item</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a few letters" /></label>
      {matches.length > 0 && <div className="row">{matches.map((m) => <button key={m.id} className="qchip" onClick={() => { setExtra((p) => [...p, m.id]); setFind(''); }}>{m.name}</button>)}</div>}
      {err && <p className="banner bad" role="alert">{err}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || !loc} onClick={send}>{busy ? 'Sending…' : `Issue to ${loc ? locName(loc) : '…'}`}</button></div>

      <h2 style={{ marginTop: 8 }}>Issued today</h2>
      {today.length === 0 ? <p className="muted">Nothing issued yet today.</p> : (
        <div className="stack">{today.map((s) => {
          const diff = s.issue_lines.filter((l) => l.qty_received != null && Math.abs(Number(l.qty_received) - Number(l.qty_issued)) > Math.max(0.001, Number(l.qty_issued) * 0.02));
          return <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><b>{locName(s.to_location_id)}</b> <span className="muted small">· {s.issue_number} · {timeOf(s.issued_at)} · {s.issue_lines.length} items</span></div>
              {s.status === 'submitted' ? <span className="chip due">Waiting for counter</span> : diff.length ? <span className="chip late">{diff.length} differ</span> : <span className="chip done">Confirmed</span>}
            </div>
            {diff.length > 0 && <div className="small" style={{ marginTop: 6 }}>{diff.map((l) => `${items[l.item_id]?.name}: issued ${fmtQty(Number(l.qty_issued), items[l.item_id]?.unit)}, counter says ${fmtQty(Number(l.qty_received), items[l.item_id]?.unit)}`).join(' · ')}</div>}
          </div>; })}</div>
      )}
    </>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { dayLabel } from '../lib/ist';
import { errText } from '../lib/format';
import { DatePicker } from '../components/DatePicker';
import { useToast } from '../components/Toast';

interface Item { id: number; name: string; unit: string; group_id: number | null }
interface Ind { location_id: number; status: string; first_submitted_at: string | null; submitted_at: string | null; indent_lines: { item_id: number; qty: number }[] }
interface Iss { to_location_id: number; issue_lines: { item_id: number; qty_issued: number }[] }
interface Po { status: string; party?: boolean; po_lines: { item_id: number; qty: number }[] }
interface Line { loc: number; item: Item; need: number; ready: number; coming: number; buy: number }

const n2 = (n: number) => String(Math.round(n * 100) / 100);
const EPS = 1e-9;

// Store view: what to set aside from store stock for each counter, ahead of time, and what is still on its way.
export function KeepReady() {
  const { locations } = useSession();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [target, setTarget] = useState('');
  const [view, setView] = useState<'counter' | 'item'>('counter');
  const [items, setItems] = useState<Item[]>([]);
  const [inds, setInds] = useState<Ind[]>([]);
  const [iss, setIss] = useState<Iss[]>([]);
  const [pos, setPos] = useState<Po[]>([]);
  const [stock, setStock] = useState<Record<number, number>>({});
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  const [partyLoc, setPartyLoc] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { supabase.rpc('indent_for_date').then(({ data }) => { const d = String(data); setDate(d); setTarget(d); }); }, []);
  useEffect(() => {
    supabase.from('items').select('id, name, unit, group_id').eq('active', true).then(({ data }) => setItems((data as Item[]) ?? []));
    supabase.rpc('party_loc').then(({ data }) => setPartyLoc(data == null ? null : Number(data)));
  }, []);

  const load = useCallback(async () => {
    if (!date) return;
    const [a, b, c, d, e] = await Promise.all([
      supabase.from('indents').select('location_id, status, first_submitted_at, submitted_at, indent_lines(item_id, qty)').eq('for_date', date),
      supabase.from('issues').select('to_location_id, issue_lines(item_id, qty_issued)').eq('for_date', date),
      supabase.from('purchase_orders').select('status, party, po_lines(item_id, qty)').eq('for_date', date).eq('status', 'sent'),
      supabase.from('stock_on_hand').select('item_id, qty').eq('location_id', 1),
      supabase.rpc('keep_ready_list', { p_date: date })
    ]);
    setInds((a.data as Ind[]) ?? []); setIss((b.data as Iss[]) ?? []); setPos(((c.data as Po[]) ?? []).filter((p) => !p.party));
    setStock(Object.fromEntries(((d.data as { item_id: number; qty: number }[]) ?? []).map((r) => [r.item_id, Number(r.qty)])));
    setTicks(new Set(((e.data as { location_id: number; item_id: number }[]) ?? []).map((r) => `${r.location_id}:${r.item_id}`)));
    setLoading(false);
  }, [date]);
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 30000); return () => window.clearInterval(t); }, [load]);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const counters = locations.filter((l) => l.kind === 'department' && l.active && l.id !== partyLoc);

  // Hand out stock, then incoming orders, to the counters in the order they sent their indents.
  const lines: Line[] = useMemo(() => {
    const sent = inds.filter((r) => (r.status === 'submitted' || r.status === 'locked') && r.location_id !== partyLoc)
      .sort((x, y) => (x.first_submitted_at ?? x.submitted_at ?? '').localeCompare(y.first_submitted_at ?? y.submitted_at ?? ''));
    const issued = new Map<string, number>();
    for (const i of iss) for (const l of i.issue_lines) { const k = `${i.to_location_id}:${l.item_id}`; issued.set(k, (issued.get(k) ?? 0) + Number(l.qty_issued)); }
    const coming = new Map<number, number>();
    for (const p of pos) for (const l of p.po_lines) coming.set(l.item_id, (coming.get(l.item_id) ?? 0) + Number(l.qty));
    const pool = new Map<number, number>(); const pc = new Map<number, number>();
    const out: Line[] = [];
    for (const r of sent) {
      for (const l of r.indent_lines) {
        const item = itemMap.get(l.item_id); if (!item) continue;
        const need = Math.max(0, Number(l.qty) - (issued.get(`${r.location_id}:${l.item_id}`) ?? 0));
        if (need <= EPS) continue;
        if (!pool.has(l.item_id)) { pool.set(l.item_id, Math.max(0, stock[l.item_id] ?? 0)); pc.set(l.item_id, coming.get(l.item_id) ?? 0); }
        const ready = Math.min(need, pool.get(l.item_id)!); pool.set(l.item_id, pool.get(l.item_id)! - ready);
        const cm = Math.min(need - ready, pc.get(l.item_id)!); pc.set(l.item_id, pc.get(l.item_id)! - cm);
        out.push({ loc: r.location_id, item, need, ready, coming: cm, buy: Math.max(0, need - ready - cm) });
      }
    }
    return out;
  }, [inds, iss, pos, stock, itemMap, partyLoc]);

  async function tick(loc: number, item: number, on: boolean) {
    const key = `${loc}:${item}`;
    setTicks((t) => { const n = new Set(t); if (on) n.add(key); else n.delete(key); return n; });
    const { error } = await supabase.rpc('keep_ready_set', { p_date: date, p_loc: loc, p_item: item, p_on: on });
    if (error) { toast(errText(error)); void load(); }
  }

  const byCounter = counters.map((c) => ({ c, rows: lines.filter((x) => x.loc === c.id).sort((a, b) => (a.item.group_id ?? 99) - (b.item.group_id ?? 99) || a.item.name.localeCompare(b.item.name)) })).filter((x) => x.rows.length > 0);
  const byItem = useMemo(() => {
    const m = new Map<number, Line[]>();
    for (const l of lines) m.set(l.item.id, [...(m.get(l.item.id) ?? []), l]);
    return [...m.values()].sort((a, b) => (a[0].item.group_id ?? 99) - (b[0].item.group_id ?? 99) || a[0].item.name.localeCompare(b[0].item.name));
  }, [lines]);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? '';
  const readyCount = lines.filter((l) => l.ready > EPS).length;
  const doneCount = lines.filter((l) => l.ready > EPS && ticks.has(`${l.loc}:${l.item.id}`)).length;
  const comingCount = lines.filter((l) => l.coming > EPS).length;

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Store view</p><h1>Keep ready for {date ? dayLabel(date) : '…'}</h1>
          <p className="muted small" style={{ marginTop: 2 }}>What you can set aside from the store for each counter now, and what is still on its way.</p></div>
        <div className="row"><DatePicker value={date} onChange={setDate} tomorrow={target} label="Date" /></div>
      </div>

      <div className="kpis">
        <div className="card kp"><div className="label">Counters waiting</div><div className="num kpn">{byCounter.length}</div></div>
        <div className="card kp"><div className="label">Ready from store</div><div className="num kpn">{doneCount} of {readyCount}</div><div className="muted small">kept ready</div></div>
        <div className="card kp"><div className="label">Still coming</div><div className="num kpn">{comingCount}</div><div className="muted small">items on order</div></div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className={`btn${view === 'counter' ? ' primary' : ''}`} onClick={() => setView('counter')}>By counter</button>
        <button className={`btn${view === 'item' ? ' primary' : ''}`} onClick={() => setView('item')}>By item</button>
      </div>

      {loading ? <p className="muted">Loading…</p> : lines.length === 0 ? <p className="empty card">Nothing to keep ready. Counters' asks appear here once they send their indents.</p> : view === 'counter' ? (
        <div className="stack">
          {byCounter.map(({ c, rows }) => (
            <div key={c.id} className="card" style={{ padding: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <b>{c.name}</b>
                <span className="muted small">{rows.filter((r) => r.ready > EPS && ticks.has(`${c.id}:${r.item.id}`)).length} of {rows.filter((r) => r.ready > EPS).length} kept ready</span>
              </div>
              <table>
                <thead><tr><th>Item</th><th className="r">Asked</th><th>Keep ready</th><th>On its way</th></tr></thead>
                <tbody>{rows.map((r) => { const k = `${c.id}:${r.item.id}`; const on = ticks.has(k); return (
                  <tr key={r.item.id}>
                    <td><b>{r.item.name}</b></td>
                    <td className="r num">{n2(r.need)} {r.item.unit}</td>
                    <td>{r.ready > EPS ? (
                      <label className="row" style={{ gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={on} onChange={(e) => void tick(c.id, r.item.id, e.target.checked)} /><span className={on ? 'chip done' : 'chip due'}>{on ? 'Kept ready' : 'Keep'} {n2(r.ready)} {r.item.unit}</span></label>
                    ) : <span className="muted small">None in store</span>}</td>
                    <td>{r.coming > EPS && <span className="chip late">Coming {n2(r.coming)} {r.item.unit}</span>}{r.buy > EPS && <span className="chip off">Still to buy {n2(r.buy)} {r.item.unit}</span>}{r.coming <= EPS && r.buy <= EPS && <span className="muted small">All covered</span>}</td>
                  </tr>); })}</tbody>
              </table>
            </div>))}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="tablewrap" style={{ border: 0, boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Item</th><th className="r">In store</th><th className="r">Asked</th><th>Set aside from store</th><th>On its way</th></tr></thead>
              <tbody>{byItem.map((ls) => { const it = ls[0].item; const rd = ls.filter((l) => l.ready > EPS); const cm = ls.reduce((t, l) => t + l.coming, 0); const bu = ls.reduce((t, l) => t + l.buy, 0); return (
                <tr key={it.id}>
                  <td><b>{it.name}</b></td>
                  <td className="r num muted">{n2(Math.max(0, stock[it.id] ?? 0))} {it.unit}</td>
                  <td className="r num">{n2(ls.reduce((t, l) => t + l.need, 0))} {it.unit}</td>
                  <td className="small">{rd.length ? rd.map((l) => `${locName(l.loc)} ${n2(l.ready)}${ticks.has(`${l.loc}:${it.id}`) ? ' ✓' : ''}`).join(' · ') : <span className="muted">None in store</span>}</td>
                  <td>{cm > EPS && <span className="chip late">Coming {n2(cm)} {it.unit}</span>}{bu > EPS && <span className="chip off">Still to buy {n2(bu)} {it.unit}</span>}{cm <= EPS && bu <= EPS && <span className="muted small">All covered</span>}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>When stock is not enough for everyone, the counter that sent its indent first gets it first. Tick each one as you set it aside.</p>
    </>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, date as fdate } from '../lib/format';
import { useToast } from '../components/Toast';

interface Row {
  item_id: number; name: string; unit: string; group_id: number | null; default_vendor_id: string | null; rate_group: string | null; item_created: string;
  price: number | null; pack_label: string | null; pack_qty: number | null; content_qty: number | null; content_unit: string | null; bill_date: string | null; source: string | null; ref: string | null;
  unit_cost: number | null; prev_unit_cost: number | null; prev_date: string | null;
}
interface Vendor { id: string; name: string; is_store: boolean }
interface Edit { pack_label?: string; pack_qty?: string; price?: string; vendor_id?: string; content_qty?: string; content_unit?: string }
const MEASURED = ['kg', 'g', 'L', 'l', 'ml'];
const CONTENT_UNITS = ['ml', 'L', 'g', 'kg'];
const PACKS = ['kg', 'pack', 'tray', 'case', 'bag', 'box', 'bottle', 'piece', 'roll', 'dozen', 'litre', 'can'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const inr = (n: number) => '₹' + (n >= 100 ? Math.round(n).toLocaleString('en-IN') : n.toFixed(2));
const FILTERS = [['all', 'All items'], ['need', 'Needs details'], ['price', 'No price'], ['vendor', 'No vendor'], ['new', 'New']] as const;
type F = typeof FILTERS[number][0];

function sourceText(r: Row) {
  if (!r.price) return 'Not set yet';
  const d = r.bill_date ? fdate(r.bill_date) : '';
  if (r.source === 'bill') return `Bill ${d}${r.ref ? ', ' + r.ref.replace(/ bill.*$/i, '') : ''}`;
  if (r.source === 'group') return `Daily rate ${d}`;
  if (r.source === 'old') return 'Earlier entry';
  return `Typed in ${d}`;
}

export function BuyingSetup() {
  const { profile } = useSession();
  const toast = useToast();
  const can = ['owner', 'manager', 'store', 'accounts'].includes(profile?.role ?? '');
  const [rows, setRows] = useState<Row[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [groups, setGroups] = useState<Record<number, string>>({});
  const [manual, setManual] = useState(false);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [filter, setFilter] = useState<F>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [gRate, setGRate] = useState('');
  const [gDate, setGDate] = useState(today());

  const load = useCallback(async () => {
    const [b, v, g] = await Promise.all([
      supabase.from('item_price_book').select('*').order('name').limit(2000),
      supabase.from('vendors').select('id, name, is_store').eq('active', true).order('name'),
      supabase.from('item_groups').select('id, name'),
    ]);
    setRows(((b.data as Row[]) ?? []).map((r) => ({ ...r, price: r.price == null ? null : Number(r.price), pack_qty: r.pack_qty == null ? null : Number(r.pack_qty), unit_cost: r.unit_cost == null ? null : Number(r.unit_cost), prev_unit_cost: r.prev_unit_cost == null ? null : Number(r.prev_unit_cost) })));
    setVendors((v.data as Vendor[]) ?? []);
    setGroups(Object.fromEntries(((g.data as { id: number; name: string }[]) ?? []).map((x) => [x.id, x.name])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const vName = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);
  const val = (r: Row) => {
    const e = edits[r.item_id] ?? {};
    return { pack_label: e.pack_label ?? r.pack_label ?? '', pack_qty: e.pack_qty ?? (r.pack_qty != null ? String(r.pack_qty) : ''), price: e.price ?? (r.price != null ? String(r.price) : ''), vendor_id: e.vendor_id ?? r.default_vendor_id ?? '', content_qty: e.content_qty ?? (r.content_qty != null ? String(r.content_qty) : ''), content_unit: e.content_unit ?? r.content_unit ?? 'ml' };
  };
  const needs = (r: Row) => { const v = val(r); return !v.pack_label || !(Number(v.pack_qty) > 0) || !(Number(v.price) > 0) || !v.vendor_id; };
  const LAUNCH = '2026-11-09'; // items added from this day on are shown as New
  const isNew = (r: Row) => !r.price && r.item_created.slice(0, 10) >= LAUNCH && Date.now() - new Date(r.item_created).getTime() < 14 * 864e5;
  const counts = useMemo(() => ({
    all: rows.length, need: rows.filter(needs).length, price: rows.filter((r) => !r.price).length,
    vendor: rows.filter((r) => !r.default_vendor_id).length, new: rows.filter(isNew).length,
  }), [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
    return filter === 'all' || (filter === 'need' && needs(r)) || (filter === 'price' && !r.price) || (filter === 'vendor' && !r.default_vendor_id) || (filter === 'new' && isNew(r));
  });
  const set = (id: number, patch: Edit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const changed = Object.keys(edits).length;
  const chicken = rows.filter((r) => r.rate_group === 'fresh_chicken');
  const chickenNow = chicken.find((r) => r.price != null);
  const newCount = rows.filter(isNew).length;

  const arrow = (r: Row) => {
    if (r.unit_cost == null || r.prev_unit_cost == null) return <span className="muted">—</span>;
    const d = r.unit_cost - r.prev_unit_cost; const pc = (d / r.prev_unit_cost) * 100;
    if (Math.abs(pc) < 0.05) return <span className="muted">no change</span>;
    return <span style={{ color: d > 0 ? 'var(--bad)' : 'var(--ok)' }}>{d > 0 ? '▲' : '▼'} {Math.abs(pc).toFixed(1)}%</span>;
  };

  async function save() {
    setBusy(true);
    const rowsOut = Object.entries(edits).map(([id, e]) => { const r = rows.find((x) => x.item_id === Number(id))!; const v = val(r); return { item_id: r.item_id, pack_label: v.pack_label, pack_qty: v.pack_qty, price: v.price, vendor_id: v.vendor_id, content_qty: v.content_qty, content_unit: v.content_unit }; });
    const { error } = await supabase.rpc('save_buying_setup', { p_rows: rowsOut });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    setEdits({}); toast('Saved'); void load();
  }
  async function applyGroup() {
    const rate = Number(gRate); if (!(rate > 0)) { toast('Enter the rate per kg'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('set_group_rate', { p_group: 'fresh_chicken', p_rate: rate, p_date: gDate, p_vendor: chicken[0]?.default_vendor_id ?? null, p_source: 'group', p_ref: null });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    setGRate(''); toast(`Rate applied to ${chicken.length} items`); void load();
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div><p className="label">Items</p><h1>Buying setup and prices</h1><p className="muted small">How each item is bought, what it costs and who supplies it. Prices include GST. New items appear here by themselves.</p></div>
        {can && <button className={manual ? 'btn primary' : 'btn secondary'} aria-pressed={manual} onClick={() => { setManual(!manual); if (manual) setEdits({}); }}>{manual ? 'Manual update: on' : 'Manual update'}</button>}
      </div>
      {manual && <p className="banner warn">Manual update is on. Use this for handwritten bills and one-off items. Everything else fills itself from bills. Switch it off when you are done.</p>}
      {newCount > 0 && <p className="banner">{newCount} new {newCount === 1 ? 'item was' : 'items were'} added to your Items list and show here, marked New. Fill their details when you buy them next.</p>}

      {chicken.length > 0 && (
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div><b>Fresh chicken (Srinidhi)</b><p className="muted small">One rate per bill, applied to all {chicken.length} {chicken.length === 1 ? "cut" : "cuts"} automatically.</p></div>
          {manual
            ? <div className="row" style={{ gap: 8 }}><input type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} style={{ width: 150 }} /><input className="num" inputMode="decimal" placeholder="₹ per kg" value={gRate} onChange={(e) => setGRate(e.target.value)} style={{ width: 100 }} /><button className="btn primary" disabled={busy} onClick={() => void applyGroup()}>Apply to {chicken.length} items</button></div>
            : <div>{chickenNow ? <><span className="chip done">Latest bill</span> <b className="num">{inr(chickenNow.unit_cost ?? 0)} / kg</b> <span className="muted small">{sourceText(chickenNow)}{chickenNow.prev_unit_cost ? `, was ${inr(chickenNow.prev_unit_cost)}` : ''}</span></> : <span className="muted">No rate yet</span>}</div>}
        </div>
      )}

      <div className="row" style={{ gap: 8, margin: '14px 0 10px', flexWrap: 'wrap' }}>
        <div className="seg">{FILTERS.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} ({counts[k]})</button>)}</div>
        <input placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: 'auto', width: 220 }} />
      </div>

      <div className="tablewrap"><table className="table" style={{ minWidth: 900 }}>
        <thead><tr><th>Item</th><th>We buy it as</th><th className="r">Quantity in one pack</th><th className="r">Contents of one unit</th><th className="r">Pack price (incl. GST)</th><th className="r">Cost per counted unit</th><th>Usual vendor</th><th>Status</th></tr></thead>
        <tbody>
          {shown.map((r) => {
            const v = val(r); const pq = Number(v.pack_qty); const pr = Number(v.price);
            const live = edits[r.item_id] && pq > 0 && pr > 0 ? pr / pq : r.unit_cost;
            const st = !v.pack_label || !(pq > 0) ? 'Needs pack size' : !(pr > 0) ? 'Needs price' : !v.vendor_id ? 'Needs vendor' : 'Complete';
            return (
              <tr key={r.item_id} style={edits[r.item_id] ? { background: 'var(--warn-bg)' } : undefined}>
                <td style={{ minWidth: 170 }}><b>{r.name}</b>{isNew(r) && <span className="chip due" style={{ marginLeft: 8 }}>New</span>}<div className="muted small">{r.rate_group === 'fresh_chicken' ? 'Fresh chicken rate group' : (r.group_id ? groups[r.group_id] : '')}</div></td>
                <td>{manual ? <select style={{ width: 110 }} value={v.pack_label} onChange={(e) => set(r.item_id, { pack_label: e.target.value })}><option value="">Choose</option>{PACKS.map((p) => <option key={p}>{p}</option>)}</select> : (v.pack_label || <span className="muted">Not set</span>)}</td>
                <td className="r num">{manual ? <input className="num" inputMode="decimal" style={{ width: 80 }} value={v.pack_qty} placeholder={r.unit} onChange={(e) => set(r.item_id, { pack_qty: e.target.value })} /> : (v.pack_qty ? `${v.pack_qty} ${r.unit}` : <span className="muted">—</span>)}</td>
                <td className="r num">{MEASURED.includes(r.unit) ? <span className="muted">Measured in {r.unit}</span> : manual ? <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><input className="num" inputMode="decimal" style={{ width: 70 }} value={v.content_qty} placeholder="e.g. 500" onChange={(e) => set(r.item_id, { content_qty: e.target.value })} /><select style={{ width: 64 }} value={v.content_unit} onChange={(e) => set(r.item_id, { content_unit: e.target.value })}>{CONTENT_UNITS.map((u) => <option key={u}>{u}</option>)}</select></span> : (Number(v.content_qty) > 0 ? `${v.content_qty} ${v.content_unit} per ${r.unit}` : <span className="muted">Not set</span>)}</td>
                <td className="r num">{manual ? <input className="num" inputMode="decimal" style={{ width: 84 }} value={v.price} placeholder="₹" onChange={(e) => set(r.item_id, { price: e.target.value })} /> : (v.price ? '₹' + Number(v.price).toLocaleString('en-IN') : <span className="muted">—</span>)}</td>
                <td className="r num"><b>{live != null ? `${inr(live)} / ${r.unit}` : '—'}</b><div className="small">{arrow(r)}{r.prev_unit_cost != null && <span className="muted"> was {inr(r.prev_unit_cost)}</span>}</div>{live != null && Number(v.content_qty) > 0 && !MEASURED.includes(r.unit) && <div className="small">{(() => { const big = v.content_unit === 'L' || v.content_unit === 'kg'; const per = live / (Number(v.content_qty) * (big ? 1000 : 1)); return `₹${per.toFixed(per < 1 ? 3 : 2)} / ${big ? (v.content_unit === 'L' ? 'ml' : 'g') : v.content_unit}`; })()}</div>}<div className="small muted">{sourceText(r)}</div></td>
                <td>{manual ? <select style={{ width: 170 }} value={v.vendor_id} onChange={(e) => set(r.item_id, { vendor_id: e.target.value })}><option value="">Choose</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : (vName.get(v.vendor_id) ?? <span className="muted">Not set</span>)}</td>
                <td><span className={`chip ${st === 'Complete' ? 'done' : 'late'}`}>{st}</span></td>
              </tr>
            );
          })}
          {shown.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>Nothing here.</td></tr>}
        </tbody>
      </table></div>

      {manual && changed > 0 && (
        <div className="stickybar" style={{ position: 'sticky', bottom: 12, display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center', background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '10px 14px', width: 'fit-content', margin: '14px auto 0' }}>
          <span>{changed} {changed === 1 ? 'item' : 'items'} changed</span>
          <button className="btn secondary" onClick={() => setEdits({})}>Discard</button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';

interface Row {
  item_id: number; name: string; unit: string; group_id: number | null; default_vendor_id: string | null;
  price: number | null; pack_label: string | null; pack_qty: number | null; content_qty: number | null; content_unit: string | null; unit_cost: number | null;
}
interface Vendor { id: string; name: string }
interface Group { id: number; name: string }
type Tab = 'ren' | 'cost' | 'price' | 'buy' | 'pack' | 'dup' | 'grp' | 'inh' | 'cln';
interface Cost { item_id: number; name: string; unit: string; kind: string; cost: number | null; missing: { id: number; name: string }[]; markup: number; rate: number | null }
const PACKS = ['kg', 'g', 'L', 'ml', 'pack', 'tray', 'case', 'bag', 'box', 'bottle', 'piece', 'roll', 'dozen', 'can'];
const SMALL = ['g', 'ml'];
const CONTAINERS = ['bottle', 'pkt', 'tub', 'roll'];
const DUPS: [string, string, string][] = [['Amul Cheese', 'Cheese Block', 'Amul Cheese was added for the Cheese Balls recipe. Cheese Block already has a price and a vendor.']];
const GROUP_FIX: Record<string, string[]> = { 'Brown Onion': ['Vegetables & Fruits', 'Spices'], 'Brown Garlic': ['Spices', 'Vegetables & Fruits'] };
const fnum = (n: number) => (n >= 100 ? Math.round(n).toString() : n >= 1 ? n.toFixed(2) : n.toFixed(4)).replace(/\.?0+$/, '');

export function DataCheck() {
  const { profile } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tab, setTab] = useState<Tab>('cost');
  const [costs, setCosts] = useState<Cost[]>([]);
  const [rq, setRq] = useState('');
  const [renId, setRenId] = useState<number | null>(null);
  const [renVal, setRenVal] = useState('');
  const [ed, setEd] = useState<Record<string, Record<string, string>>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [b, v, g] = await Promise.all([
      supabase.from('item_price_book').select('item_id, name, unit, group_id, default_vendor_id, price, pack_label, pack_qty, content_qty, content_unit, unit_cost').order('name').limit(2000),
      supabase.from('vendors').select('id, name').eq('active', true).order('name'),
      supabase.from('item_groups').select('id, name').order('sort'),
    ]);
    const c = await supabase.rpc('cost_overview'); setCosts((c.data as Cost[]) ?? []);
    setRows((b.data as Row[]) ?? []); setVendors((v.data as Vendor[]) ?? []); setGroups((g.data as Group[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const inHouse = useMemo(() => new Set(vendors.filter((x) => x.name.toLowerCase().replace(/\s/g, '') === 'inhouse').map((x) => x.id)), [vendors]);
  const gName = useMemo(() => new Map(groups.map((x) => [x.id, x.name])), [groups]);
  const byName = useMemo(() => new Map(rows.map((r) => [r.name, r])), [rows]);

  const wrongPack = rows.filter((r) => SMALL.includes(r.unit) && r.pack_qty != null && r.price != null && (
    (r.pack_qty > 0 && r.pack_qty <= 5 && r.price >= 20) || (r.unit_cost != null && r.unit_cost > 5)));
  const wrongIds = new Set(wrongPack.map((r) => r.item_id));
  const gapIds = new Set(costs.flatMap((c) => c.missing.map((m) => m.id)));
  const buy = rows.filter((r) => !wrongIds.has(r.item_id) && !(r.default_vendor_id && inHouse.has(r.default_vendor_id) && !gapIds.has(r.item_id)) && (!r.price || !r.default_vendor_id || !r.pack_label || !(r.pack_qty && r.pack_qty > 0)) && !CONTAINERS.includes(r.unit) || (!wrongIds.has(r.item_id) && CONTAINERS.includes(r.unit) && !(r.default_vendor_id && inHouse.has(r.default_vendor_id)) && (!r.price || !r.default_vendor_id)));
  const pack = rows.filter((r) => CONTAINERS.includes(r.unit) && !(r.content_qty && r.content_qty > 0));
  const dups = DUPS.filter(([a, b]) => byName.has(a) && byName.has(b) && !skip['dup' + a]);
  const grp = rows.filter((r) => GROUP_FIX[r.name] && gName.get(r.group_id ?? -1) === 'Oil, Sugar & Salt');
  const inh = rows.filter((r) => r.default_vendor_id && inHouse.has(r.default_vendor_id) && !r.price);
  const stray = rows.filter((r) => r.content_unit && !(r.content_qty && r.content_qty > 0));

  const incomplete = costs.filter((c) => c.missing.length > 0);
  const counts: Record<Tab, number> = { ren: 0, cost: incomplete.length, price: wrongPack.length, buy: buy.length, pack: pack.length, dup: dups.length, grp: grp.length, inh: 0, cln: stray.length };
  const left = counts.cost + counts.price + counts.buy + counts.pack + counts.dup + counts.grp + (stray.length ? 1 : 0);
  const TABS: [Tab, string][] = [['cost', 'Costing'], ['ren', 'Rename items'], ['price', 'Wrong price'], ['buy', 'Missing price'], ['pack', 'Pack sizes'], ['dup', 'Possible duplicates'], ['grp', 'Wrong group'], ['inh', 'Made in house'], ['cln', 'Cleanup']];

  const val = (id: number, k: string, dflt: string) => ed[id]?.[k] ?? dflt;
  const set = (id: number, k: string, v: string) => setEd((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));

  async function saveRows(out: Record<string, unknown>[], done = 'Saved') {
    setBusy(true);
    const { error } = await supabase.rpc('save_buying_setup', { p_rows: out });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    toast(done); void load();
  }
  async function rpc(name: string, args: Record<string, unknown>, done: string) {
    setBusy(true);
    const { error } = await supabase.rpc(name, args);
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    toast(done); void load();
  }

  if (profile?.role !== 'owner') return <div className="page"><p className="muted">Only the owner can open this page.</p></div>;

  const nameBlock = (id: number, name: string, why: string) => renId === id ? (
    <div>
      <div className="row" style={{ gap: 6 }}>
        <input autoFocus style={{ minWidth: 180 }} value={renVal} onChange={(e) => setRenVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && renVal.trim().length > 1) { void rpc('dc_rename_item', { p_item: id, p_name: renVal }, 'Renamed'); setRenId(null); } if (e.key === 'Escape') setRenId(null); }} />
        <button className="btn primary" disabled={busy || renVal.trim().length < 2} onClick={() => { void rpc('dc_rename_item', { p_item: id, p_name: renVal }, 'Renamed'); setRenId(null); }}>Save name</button>
        <button className="btn secondary" onClick={() => setRenId(null)}>Cancel</button>
      </div>
      <div className="muted small">{why}</div>
    </div>
  ) : (
    <div>
      <button title="Tap to correct the name" onClick={() => { setRenId(id); setRenVal(name); }} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, cursor: 'text', textAlign: 'left', borderBottom: '1px dashed var(--muted, #8a9a91)' }}>{name}</button>
      <div className="muted small">{why}</div>
    </div>
  );
  const nameCell = (r: Row, why: string) => <td>{nameBlock(r.item_id, r.name, why)}</td>;

  return (
    <div className="page">
      <div className="pagehead">
        <div><p className="label">Owner</p><h1>Data check</h1><p className="muted small">Fix it here and it saves straight to Compass. Nothing is ever deleted.</p></div>
        <div style={{ textAlign: 'right' }}><div className="num" style={{ fontSize: 28, fontWeight: 600 }}>{left}</div><div className="muted small">to look at</div></div>
      </div>
      <div className="seg" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}{k === 'ren' ? '' : k !== 'inh' ? ` (${counts[k]})` : ` (${inh.length})`}</button>)}
      </div>

      {tab === 'ren' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>Fix a spelling or a wrong name. You can also tap any item name on the other tabs to correct it there. Recipes, stock, prices and history stay attached, and the old name is kept so bills and reports still match.</p>
          <input placeholder="Search for an item" value={rq} onChange={(e) => setRq(e.target.value)} style={{ width: 280, marginBottom: 10 }} />
          <div className="tablewrap"><table className="table">
            <tbody>{rows.filter((r) => !rq || r.name.toLowerCase().includes(rq.toLowerCase())).slice(0, 40).map((r) => {
              const n = val(r.item_id, 'n', r.name); const ch = n.trim() !== r.name;
              return <tr key={r.item_id}>
                <td><input style={{ width: '100%', minWidth: 220 }} value={n} onChange={(e) => set(r.item_id, 'n', e.target.value)} /></td>
                <td className="muted small">{gName.get(r.group_id ?? -1)}, counted in {r.unit}</td>
                <td className="r">{ch && <button className="btn primary" disabled={busy || n.trim().length < 2} onClick={() => rpc('dc_rename_item', { p_item: r.item_id, p_name: n }, 'Renamed')}>Save</button>}</td>
              </tr>;
            })}</tbody></table></div>
          {rows.filter((r) => !rq || r.name.toLowerCase().includes(rq.toLowerCase())).length > 40 && <p className="muted small" style={{ marginTop: 8 }}>Showing the first 40. Search to narrow it down.</p>}
        </div>
      )}

      {tab === 'cost' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>What each in-house item costs to make, worked out from its recipe and the prices in Buying setup. The rate is the cost plus the markup, and it is the only figure counters see. Set the markup for each item.</p>
          {costs.length === 0 ? <p className="muted">No recipes yet.</p> : <div className="tablewrap"><table className="table">
            <thead><tr><th>Item</th><th className="r">Cost to make</th><th className="r">Markup %</th><th className="r">Rate for counters</th><th>Status</th></tr></thead>
            <tbody>{costs.map((c) => {
              const m = val(c.item_id, 'm', String(c.markup)); const un = c.unit === 'kg' ? 'kg' : 'pc';
              const miss = [...new Map(c.missing.map((x) => [x.id, x.name])).values()];
              return <tr key={c.item_id}>
                <td>{nameBlock(c.item_id, c.name, `per ${un}`)}</td>
                <td className="r num">{c.cost != null ? '₹' + c.cost.toFixed(2) : '-'}</td>
                <td className="r"><input className="num" style={{ width: 60 }} inputMode="decimal" value={m} onChange={(e) => set(c.item_id, 'm', e.target.value)} />
                  {m !== String(c.markup) && <button className="btn primary" style={{ marginLeft: 6 }} disabled={busy || !(Number(m) >= 0)} onClick={() => rpc('dc_set_markup', { p_item: c.item_id, p_pct: Number(m) }, 'Markup saved')}>Save</button>}</td>
                <td className="r num">{c.rate != null && miss.length === 0 ? '₹' + c.rate.toFixed(2) : '-'}</td>
                <td>{miss.length === 0 ? <span className="chip done">Complete</span> : <span className="muted small">Cannot price yet: {miss.slice(0, 6).join(', ')}{miss.length > 6 ? ` and ${miss.length - 6} more` : ''}. Add the price under Missing price.</span>}</td>
              </tr>;
            })}</tbody></table></div>}
        </div>
      )}

      {tab === 'price' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>Counted in grams or ml, but the pack size looks like it was typed in kg or litres, so the cost per gram is 1000 times too high. Check the numbers and save.</p>
          {wrongPack.length === 0 ? <p className="muted">All clear.</p> : <div className="tablewrap"><table className="table">
            <thead><tr><th>Item</th><th className="r">Pack holds ({'g or ml'})</th><th className="r">Pack price</th><th className="r">Cost per {'g or ml'}</th><th></th></tr></thead>
            <tbody>{wrongPack.map((r) => {
              const sugg = r.pack_qty != null && r.pack_qty <= 5 ? r.pack_qty * 1000 : r.pack_qty ?? 0;
              const q = Number(val(r.item_id, 'q', fnum(sugg))); const p = Number(val(r.item_id, 'p', String(r.price ?? '')));
              return <tr key={r.item_id}>
                {nameCell(r, `Now: ${r.pack_qty} ${r.unit} for ₹${r.price}, which is ₹${fnum(r.unit_cost ?? 0)} per ${r.unit}`)}
                <td className="r"><input className="num" style={{ width: 90 }} inputMode="decimal" value={val(r.item_id, 'q', fnum(sugg))} onChange={(e) => set(r.item_id, 'q', e.target.value)} /> {r.unit}</td>
                <td className="r">₹<input className="num" style={{ width: 90 }} inputMode="decimal" value={val(r.item_id, 'p', String(r.price ?? ''))} onChange={(e) => set(r.item_id, 'p', e.target.value)} /></td>
                <td className="r num">{q > 0 && p > 0 ? '₹' + fnum(p / q) : '-'}</td>
                <td className="r"><button className="btn primary" disabled={busy || !(q > 0 && p > 0)} onClick={() => saveRows([{ item_id: r.item_id, pack_label: r.pack_label ?? 'kg', pack_qty: String(q), price: String(p), vendor_id: r.default_vendor_id ?? '' }])}>Save</button></td>
              </tr>;
            })}</tbody></table></div>}
        </div>
      )}

      {tab === 'buy' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>Things you buy that still need a vendor, a pack or a price. Pack size is in the item's own unit (for example grams for a spice).</p>
          {buy.length === 0 ? <p className="muted">All clear.</p> : <div className="tablewrap"><table className="table">
            <thead><tr><th>Item</th><th>Vendor</th><th>Pack</th><th className="r">Pack price</th><th></th></tr></thead>
            <tbody>{buy.map((r) => {
              const v = val(r.item_id, 'v', r.default_vendor_id ?? ''); const l = val(r.item_id, 'l', r.pack_label ?? (r.unit === 'g' ? 'g' : r.unit));
              const q = val(r.item_id, 'q', r.pack_qty != null ? String(r.pack_qty) : ''); const p = val(r.item_id, 'p', r.price != null ? String(r.price) : '');
              const ok = !!v && !!l && Number(q) > 0 && Number(p) > 0;
              return <tr key={r.item_id}>
                {nameCell(r, `Counted in ${r.unit}${r.default_vendor_id ? '' : ', no vendor yet'}`)}
                <td><select value={v} onChange={(e) => set(r.item_id, 'v', e.target.value)}><option value="">Choose vendor</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                <td><input className="num" style={{ width: 70 }} inputMode="decimal" placeholder="Qty" value={q} onChange={(e) => set(r.item_id, 'q', e.target.value)} /> <select value={l} onChange={(e) => set(r.item_id, 'l', e.target.value)}>{[...new Set([l, ...PACKS])].map((x) => <option key={x}>{x}</option>)}</select></td>
                <td className="r">₹<input className="num" style={{ width: 80 }} inputMode="decimal" value={p} onChange={(e) => set(r.item_id, 'p', e.target.value)} /></td>
                <td className="r"><button className="btn primary" disabled={busy || !ok} onClick={() => saveRows([{ item_id: r.item_id, pack_label: l, pack_qty: q, price: p, vendor_id: v }])}>Save</button></td>
              </tr>;
            })}</tbody></table></div>}
        </div>
      )}

      {tab === 'pack' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>Bottles and packets with no size inside. With it, Compass can buy whole packs and cost by the ml or gram.</p>
          {pack.length === 0 ? <p className="muted">All clear.</p> : <div className="tablewrap"><table className="table">
            <thead><tr><th>Item</th><th>One {'unit'} holds</th><th></th></tr></thead>
            <tbody>{pack.map((r) => {
              const q = val(r.item_id, 'q', ''); const u = val(r.item_id, 'u', 'ml');
              return <tr key={r.item_id}>
                {nameCell(r, `Counted as 1 ${r.unit}`)}
                <td><input className="num" style={{ width: 90 }} inputMode="decimal" placeholder="Size" value={q} onChange={(e) => set(r.item_id, 'q', e.target.value)} /> <select value={u} onChange={(e) => set(r.item_id, 'u', e.target.value)}>{['ml', 'L', 'g', 'kg'].map((x) => <option key={x}>{x}</option>)}</select></td>
                <td className="r"><button className="btn primary" disabled={busy || !(Number(q) > 0)} onClick={() => saveRows([{ item_id: r.item_id, content_qty: q, content_unit: u }])}>Save</button></td>
              </tr>;
            })}</tbody></table></div>}
        </div>
      )}

      {tab === 'dup' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>Merging moves every recipe line to one item and switches the other off. An item with stock, orders or price history is never merged.</p>
          {dups.length === 0 ? <p className="muted">All clear.</p> : dups.map(([a, b, why]) => (
            <div key={a} className="row" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'space-between', padding: '10px 0' }}>
              <div>{nameBlock(byName.get(a)!.item_id, a, why)}</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn primary" disabled={busy} onClick={() => rpc('dc_merge_item', { p_from: byName.get(a)!.item_id, p_to: byName.get(b)!.item_id }, `Merged into ${b}`)}>Merge into {b}</button>
                <button className="btn secondary" onClick={() => setSkip({ ...skip, ['dup' + a]: true })}>Keep both</button>
              </div>
            </div>))}
        </div>
      )}

      {tab === 'grp' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>These were put in the wrong group when they were added.</p>
          {grp.length === 0 ? <p className="muted">All clear.</p> : grp.map((r) => {
            const g = val(r.item_id, 'g', GROUP_FIX[r.name][0]);
            return <div key={r.item_id} className="row" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'space-between', padding: '10px 0' }}>
              <div>{nameBlock(r.item_id, r.name, `Now in ${gName.get(r.group_id ?? -1)}`)}</div>
              <div className="row" style={{ gap: 8 }}>
                <select value={g} onChange={(e) => set(r.item_id, 'g', e.target.value)}>{groups.map((x) => <option key={x.id}>{x.name}</option>)}</select>
                <button className="btn primary" disabled={busy} onClick={() => { const id = groups.find((x) => x.name === g)?.id; if (id) void rpc('dc_set_group', { p_item: r.item_id, p_group: id }, 'Group changed'); }}>Save</button>
              </div>
            </div>;
          })}
        </div>
      )}

      {tab === 'inh' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>Made in the kitchen, so they need no price. Compass costs them from their recipes. Nothing to do here.</p>
          <p className="small">{inh.map((r) => r.name).join(', ') || 'None'}</p>
        </div>
      )}

      {tab === 'cln' && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 8 }}>{stray.length} items carry a stray "ml" with no size. It does nothing, but it is clutter and it confuses pack rules.</p>
          <button className="btn primary" disabled={busy || stray.length === 0} onClick={() => rpc('dc_clear_stray_ml', {}, 'Cleared')}>{stray.length ? 'Clear them all' : 'All clear'}</button>
        </div>
      )}
    </div>
  );
}

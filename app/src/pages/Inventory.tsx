import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, money } from '../lib/format';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface D { id: number; name: string; category: string; qty: number; replace_cost: number | null; kept_at: string; active: boolean }
interface L { item_id: number; expected: number; counted: number; broken: number; added: number; durable_counts: { count_date: string } }
const CATS = ['Glasses', 'Plates', 'Bowls', 'Cutlery', 'Serving ware', 'Cups', 'Other'];
const dfmt = (s: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(s + 'T00:00:00'));

export function Inventory() {
  const { profile } = useSession();
  const canEdit = profile?.role === 'owner' || profile?.role === 'store';
  const [tab, setTab] = useState<'list' | 'count' | 'report'>('list');
  const [rows, setRows] = useState<D[]>([]);
  const [lines, setLines] = useState<L[]>([]);
  const [edit, setEdit] = useState<D | 'new' | null>(null);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.from('durable_items').select('*').order('category').order('name'), supabase.from('durable_count_lines').select('item_id, expected, counted, broken, added, durable_counts(count_date)')]);
    setRows((a.data as D[]) ?? []); setLines((b.data as unknown as L[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <div className="pagehead"><div><p className="label">Store</p><h1>Plates, glasses and cutlery</h1><p className="muted small" style={{ marginTop: 2 }}>What you own, a weekly count, and what breaks or goes missing.</p></div>
        <div className="row">{canEdit && <Link to="/upload?tab=durables" className="btn"><Icon name="layers" /> Bulk upload</Link>}{canEdit && <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" /> Add type</button>}</div></div>
      <div className="seg"><button aria-pressed={tab === 'list'} onClick={() => setTab('list')}>What we have</button><button aria-pressed={tab === 'count'} onClick={() => setTab('count')}>Weekly count</button><button aria-pressed={tab === 'report'} onClick={() => setTab('report')}>Breakage and missing</button></div>
      {tab === 'list' && <List rows={rows} canEdit={canEdit} onEdit={setEdit} />}
      {tab === 'count' && <Count rows={rows.filter((r) => r.active)} canEdit={canEdit} onSaved={() => { void load(); setTab('report'); }} />}
      {tab === 'report' && <Report rows={rows} lines={lines} />}
      {edit && <Form item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </>
  );
}

function List({ rows, canEdit, onEdit }: { rows: D[]; canEdit: boolean; onEdit: (d: D) => void }) {
  const cats = [...new Set(rows.map((r) => r.category))];
  if (!rows.length) return <p className="empty card">Nothing here yet. Add each type once, or use Bulk upload.</p>;
  return <>{cats.map((c) => <div key={c}><h2 style={{ marginBottom: 8 }}>{c}</h2><div className="tablewrap"><table><thead><tr><th>Type</th><th className="r">We have</th><th className="r">Replace cost</th><th>Kept at</th>{canEdit && <th style={{ width: 70 }} />}</tr></thead>
    <tbody>{rows.filter((r) => r.category === c).map((r) => <tr key={r.id}><td><b>{r.name}</b>{!r.active && <span className="chip off" style={{ marginLeft: 8 }}>Not in use</span>}</td><td className="r num">{r.qty}</td><td className="r num">{r.replace_cost != null ? money(r.replace_cost) : '—'}</td><td className="muted">{r.kept_at}</td>{canEdit && <td><button className="btn quiet" onClick={() => onEdit(r)}>Edit</button></td>}</tr>)}</tbody></table></div></div>)}</>;
}

function Count({ rows, canEdit, onSaved }: { rows: D[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<Record<number, { c: string; b: string; a: string }>>({});
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (id: number, k: 'c' | 'b' | 'a', val: string) => setV((p) => { const cur = p[id] ?? { c: '', b: '', a: '' }; return { ...p, [id]: { ...cur, [k]: val } }; });
  const filled = rows.filter((r) => v[r.id]?.c !== undefined && v[r.id].c !== '');
  async function save() {
    setErr(''); setBusy(true);
    const { error } = await supabase.rpc('save_durable_count', { p_note: note, p_lines: filled.map((r) => ({ item_id: r.id, counted: Number(v[r.id].c), broken: Number(v[r.id].b || 0), added: Number(v[r.id].a || 0) })) });
    setBusy(false); if (error) return setErr(errText(error)); toast('Count saved'); onSaved();
  }
  if (!canEdit) return <p className="empty card">Only Admin or the store can do the weekly count.</p>;
  return <>
    <p className="muted small">Count what is on the shelves and in use. Add how many broke and how many new ones were added since the last count. Compass works out what is missing.</p>
    <div className="tablewrap"><table><thead><tr><th>Type</th><th className="r">Last count</th><th className="r" style={{ width: 90 }}>Added</th><th className="r" style={{ width: 90 }}>Broken</th><th className="r" style={{ width: 100 }}>Counted now</th><th className="r" style={{ width: 90 }}>Missing</th></tr></thead>
      <tbody>{rows.map((r) => { const x = v[r.id]; const exp = r.qty + Number(x?.a || 0) - Number(x?.b || 0); const miss = x?.c !== undefined && x.c !== '' ? exp - Number(x.c) : null;
        return <tr key={r.id}><td><b>{r.name}</b><div className="small muted">{r.category}</div></td><td className="r num">{r.qty}</td>
          {(['a', 'b', 'c'] as const).map((k) => <td key={k} className="r"><input inputMode="numeric" className="num" style={{ textAlign: 'right', width: 76 }} aria-label={`${k === 'a' ? 'Added' : k === 'b' ? 'Broken' : 'Counted'} ${r.name}`} value={x?.[k] ?? ''} onChange={(e) => set(r.id, k, e.target.value)} /></td>)}
          <td className="r num" style={{ fontWeight: 600, color: miss && miss > 0 ? '#B42335' : miss && miss < 0 ? '#1C7A53' : undefined }}>{miss == null ? '' : miss}</td></tr>; })}</tbody></table></div>
    <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {err && <p className="banner bad" role="alert">{err}</p>}
    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || filled.length === 0} onClick={save}>{busy ? 'Saving…' : `Save count (${filled.length} types)`}</button></div></>;
}

function Report({ rows, lines }: { rows: D[]; lines: L[] }) {
  const [days, setDays] = useState(30);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const agg = useMemo(() => rows.map((r) => { const ls = lines.filter((l) => l.item_id === r.id && l.durable_counts?.count_date >= since); const broken = ls.reduce((s, l) => s + Number(l.broken), 0); const missing = ls.reduce((s, l) => s + Math.max(0, Number(l.expected) - Number(l.counted)), 0); return { r, broken, missing, cost: (broken + missing) * (r.replace_cost ?? 0) }; }).filter((x) => x.broken || x.missing).sort((a, b) => b.cost - a.cost), [rows, lines, since]);
  const total = agg.reduce((s, x) => s + x.cost, 0);
  const dates = [...new Set(lines.map((l) => l.durable_counts?.count_date))].filter(Boolean).sort().reverse().slice(0, 6);
  return <>
    <div className="seg">{[[7, '7 days'], [30, '30 days'], [90, '90 days']].map(([d, l]) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d as number)}>{l}</button>)}</div>
    {agg.length === 0 ? <p className="empty card">No breakage or missing items recorded in this period. Do a weekly count to start the record.</p> : <>
      <p><b>Cost of breakage and missing: {money(total)}</b> <span className="muted">in the last {days} days{dates.length ? `, counts on ${dates.map(dfmt).join(', ')}` : ''}</span></p>
      <div className="tablewrap"><table><thead><tr><th>Type</th><th className="r">Broken</th><th className="r">Missing</th><th className="r">Replacement cost</th></tr></thead><tbody>{agg.map((x) => <tr key={x.r.id}><td><b>{x.r.name}</b></td><td className="r num">{x.broken}</td><td className="r num">{x.missing}</td><td className="r num">{x.r.replace_cost != null ? money(x.cost) : 'no cost set'}</td></tr>)}</tbody></table></div></>}</>;
}

function Form({ item, onClose, onSaved }: { item: D | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? ''); const [cat, setCat] = useState(item?.category ?? 'Glasses'); const [qty, setQty] = useState(item ? String(item.qty) : '');
  const [cost, setCost] = useState(item?.replace_cost?.toString() ?? ''); const [kept, setKept] = useState(item?.kept_at ?? ''); const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    if (!name.trim()) return setErr('Give it a name.'); setBusy(true); setErr('');
    const { error } = await supabase.rpc('save_durable', { p_id: item?.id ?? null, p_name: name, p_category: cat, p_qty: qty === '' ? 0 : Number(qty), p_cost: cost === '' ? null : Number(cost), p_kept: kept, p_active: active });
    setBusy(false); if (error) return setErr(errText(error)); toast('Saved'); onSaved();
  }
  return <Sheet title={item ? 'Edit type' : 'Add type'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
    <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Juice glass" /></label>
    <div className="form-grid"><label className="field"><span>Category</span><select value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
      {!item && <label className="field"><span>How many we have now</span><input inputMode="numeric" className="num" value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
      <label className="field"><span>Replacement cost each (₹)</span><input inputMode="decimal" className="num" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      <label className="field"><span>Kept at</span><input value={kept} onChange={(e) => setKept(e.target.value)} placeholder="e.g. Juice counter" /></label></div>
    {item && <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />In use</label>}
    {err && <p className="banner bad" role="alert">{err}</p>}</Sheet>;
}

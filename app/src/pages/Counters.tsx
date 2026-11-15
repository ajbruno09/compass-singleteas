import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/Sheet';

interface Shelf { id: number; name: string; icon: string }

// Admin: the list of counters. Hiding a counter keeps every old record and removes it from all lists and phones.
export function Counters() {
  const { allLocations, reload } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<Record<number, number>>({});
  const [people, setPeople] = useState<Record<number, number>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfCount, setShelfCount] = useState<Record<number, number>>({});
  const [have, setHave] = useState<Record<string, number>>({});
  const [assigned, setAssigned] = useState<Record<number, number[]>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<number[]>([]);

  const load = useCallback(async () => {
    const [il, pl, sg, im, cs] = await Promise.all([supabase.from('item_locations').select('item_id, location_id'), supabase.from('profile_locations').select('location_id'),
      supabase.from('item_groups').select('id, name, icon').eq('active', true).order('sort').order('id'), supabase.from('items').select('id, group_id').eq('active', true).not('group_id', 'is', null),
      supabase.rpc('counter_shelves_list')]);
    const grp = new Map(((im.data as { id: number; group_id: number }[]) ?? []).map((x) => [x.id, x.group_id]));
    const sc: Record<number, number> = {}; grp.forEach((g) => { sc[g] = (sc[g] ?? 0) + 1; }); setShelfCount(sc);
    const hv: Record<string, number> = {}; ((il.data as { item_id: number; location_id: number }[]) ?? []).forEach((r) => { const g = grp.get(r.item_id); if (g != null) hv[`${r.location_id}:${g}`] = (hv[`${r.location_id}:${g}`] ?? 0) + 1; }); setHave(hv);
    const as: Record<number, number[]> = {}; ((cs.data as { location_id: number; group_id: number }[]) ?? []).forEach((r) => { (as[r.location_id] ??= []).push(r.group_id); }); setAssigned(as);
    setShelves((sg.data as Shelf[]) ?? []);
    const tally = (rows: { location_id: number }[] | null) => { const m: Record<number, number> = {}; (rows ?? []).forEach((r) => { m[r.location_id] = (m[r.location_id] ?? 0) + 1; }); return m; };
    setItems(tally(il.data as { location_id: number }[])); setPeople(tally(pl.data as { location_id: number }[]));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setNames(Object.fromEntries(allLocations.map((l) => [l.id, l.name]))); }, [allLocations]);

  async function save(id: number | null, name: string, sort: number | null, active: boolean | null) {
    setBusy(true);
    const { error } = await supabase.rpc('save_counter', { p_id: id, p_name: name, p_sort: sort, p_active: active });
    setBusy(false);
    if (error) { toast(errText(error)); return false; }
    await reload(); await load(); return true;
  }
  async function move(i: number, dir: -1 | 1) {
    const a = allLocations[i]; const b = allLocations[i + dir];
    if (!a || !b) return;
    const sa = a.sort; const sb = b.sort === a.sort ? a.sort + dir : b.sort;
    setBusy(true);
    const r1 = await supabase.rpc('save_counter', { p_id: a.id, p_name: a.name, p_sort: sb, p_active: null });
    const r2 = await supabase.rpc('save_counter', { p_id: b.id, p_name: b.name, p_sort: sa, p_active: null });
    setBusy(false);
    if (r1.error || r2.error) toast(errText((r1.error ?? r2.error)!));
    await reload();
  }
  function openAssign(id: number) { setDraft(assigned[id] ?? []); setOpen(id); }
  async function saveShelves() {
    if (open == null) return;
    const was = assigned[open] ?? [];
    const dropped = was.filter((g) => !draft.includes(g));
    const gone = dropped.reduce((n, g) => n + (have[`${open}:${g}`] ?? 0), 0);
    if (gone > 0 && !window.confirm(`This takes ${gone} ${gone === 1 ? 'item' : 'items'} off this counter. Old orders and counts stay safe. Continue?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('set_counter_shelves', { p_loc: open, p_groups: draft });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    const d = data as { added?: number; removed?: number } | null;
    setOpen(null); toast(`Shelves saved${d?.added ? ` · ${d.added} items added` : ''}${d?.removed ? ` · ${d.removed} removed` : ''}`);
    await load();
  }
  const sumAdd = open == null ? 0 : draft.reduce((n, g) => n + Math.max(0, (shelfCount[g] ?? 0) - (have[`${open}:${g}`] ?? 0)), 0);
  const sumDrop = open == null ? 0 : (assigned[open] ?? []).filter((g) => !draft.includes(g)).reduce((n, g) => n + (have[`${open}:${g}`] ?? 0), 0);
  async function add() {
    const top = Math.max(0, ...allLocations.map((l) => l.sort)) + 1;
    if (await save(null, adding, top, true)) { setAdding(''); toast('Counter added'); }
  }

  return (
    <>
      <div className="pagehead"><div><p className="label">Masters</p><h1>Counters</h1>
        <p className="muted small" style={{ marginTop: 2 }}>The places that order from the store. Hide a counter you no longer use. Its old records stay safe.</p></div></div>
      <div className="tablewrap"><table style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup><col style={{ width: 90 }} /><col style={{ width: 200 }} /><col /><col style={{ width: 80 }} /><col style={{ width: 80 }} /><col style={{ width: 260 }} /></colgroup>
        <thead><tr><th>Order</th><th>Name</th><th>Shelves</th><th className="r">Items</th><th className="r">People</th><th /></tr></thead>
        <tbody>{allLocations.map((l, i) => (
          <tr key={l.id} style={{ opacity: l.active ? 1 : 0.55 }}>
            <td><span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="btn quiet" disabled={busy || i === 0} aria-label="Move up" onClick={() => void move(i, -1)}>↑</button>
              <button className="btn quiet" disabled={busy || i === allLocations.length - 1} aria-label="Move down" onClick={() => void move(i, 1)}>↓</button></span></td>
            <td><input value={names[l.id] ?? ''} onChange={(e) => setNames((p) => ({ ...p, [l.id]: e.target.value }))} onBlur={() => { if ((names[l.id] ?? '').trim() && names[l.id] !== l.name) void save(l.id, names[l.id], null, null); }} aria-label={`Name of ${l.name}`} />
              {l.kind === 'store' && <span className="muted small"> The store itself</span>}{l.personal && <span className="chip" style={{ marginLeft: 8, background: '#F1ECFA', color: '#5B3FA0' }}>Personal</span>}{!l.active && <span className="chip off" style={{ marginLeft: 8 }}>Hidden</span>}</td>
            <td><span className="row" style={{ gap: 5 }}>{(assigned[l.id] ?? []).map((g) => { const sh = shelves.find((x) => x.id === g); if (!sh) return null; const h = have[`${l.id}:${g}`] ?? 0, t = shelfCount[g] ?? 0; return <span key={g} className={`chip ${h < t ? 'due' : ''}`}>{sh.icon} {sh.name}{h < t ? ` ${h}/${t}` : ''}</span>; })}{!(assigned[l.id] ?? []).length && <span className="muted small">No shelves yet</span>}</span></td>
            <td className="r num">{items[l.id] ?? 0}</td><td className="r num">{people[l.id] ?? 0}</td>
            <td className="r"><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>{l.active && <button className="btn primary" disabled={busy} onClick={() => openAssign(l.id)}>Assign shelves</button>}{l.kind !== 'store' && <button className="btn" disabled={busy} onClick={() => void save(l.id, l.name, null, !l.active)}>{l.active ? 'Hide' : 'Show again'}</button>}</span></td>
          </tr>))}</tbody>
      </table></div>
      <div className="card stack">
        <b>Add a counter</b>
        <div className="row"><input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="For example: Juice Bar" style={{ maxWidth: 280 }} onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) void add(); }} />
          <button className="btn primary" disabled={busy || !adding.trim()} onClick={() => void add()}>Add</button></div>
        <p className="muted small">After adding, tick it on each item it uses (Items, then Used at) and assign people to it (People).</p>
      </div>
      {open != null && (
        <Sheet title={`Assign shelves: ${allLocations.find((l) => l.id === open)?.name ?? ''}`} onClose={() => setOpen(null)} footer={<div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="small muted">{sumAdd || sumDrop ? <>{sumAdd > 0 && <b style={{ color: 'var(--deep)' }}>+{sumAdd} items</b>}{sumAdd > 0 && sumDrop > 0 && ' · '}{sumDrop > 0 && <b style={{ color: 'var(--bad)' }}>−{sumDrop} items</b>}</> : 'No change yet'}</span>
          <button className="btn primary" disabled={busy} onClick={() => void saveShelves()}>{busy ? 'Saving…' : 'Save'}</button></div>}>
          <p className="muted small" style={{ marginBottom: 8 }}>Tick every shelf this counter uses. All items on a ticked shelf become available to it. Items you ticked one by one stay.</p>
          {shelves.map((sh) => { const h = have[`${open}:${sh.id}`] ?? 0, t = shelfCount[sh.id] ?? 0; return (
            <label key={sh.id} className="row" style={{ gap: 10, padding: '10px 4px', borderBottom: '1px solid var(--line)', cursor: 'pointer', flexWrap: 'nowrap' }}>
              <input type="checkbox" style={{ width: 18, height: 18 }} checked={draft.includes(sh.id)} onChange={(e) => setDraft((d) => (e.target.checked ? [...d, sh.id] : d.filter((x) => x !== sh.id)))} />
              <span style={{ fontSize: 18 }}>{sh.icon}</span>
              <span style={{ flex: 1 }}><b>{sh.name}</b><br /><span className="muted small">{t} items{h > 0 && h < t ? ` · ${h} ticked now, the rest will be added` : h >= t && t > 0 ? ' · all ticked' : ''}</span></span>
            </label>); })}
        </Sheet>)}
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';

// Admin: the list of counters. Hiding a counter keeps every old record and removes it from all lists and phones.
export function Counters() {
  const { allLocations, reload } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<Record<number, number>>({});
  const [people, setPeople] = useState<Record<number, number>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [il, pl] = await Promise.all([supabase.from('item_locations').select('location_id'), supabase.from('profile_locations').select('location_id')]);
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
  async function add() {
    const top = Math.max(0, ...allLocations.map((l) => l.sort)) + 1;
    if (await save(null, adding, top, true)) { setAdding(''); toast('Counter added'); }
  }

  return (
    <>
      <div className="pagehead"><div><p className="label">Masters</p><h1>Counters</h1>
        <p className="muted small" style={{ marginTop: 2 }}>The places that order from the store. Hide a counter you no longer use. Its old records stay safe.</p></div></div>
      <div className="tablewrap"><table style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup><col style={{ width: 90 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 190 }} /></colgroup>
        <thead><tr><th>Order</th><th>Name</th><th className="r">Items</th><th className="r">People</th><th /></tr></thead>
        <tbody>{allLocations.map((l, i) => (
          <tr key={l.id} style={{ opacity: l.active ? 1 : 0.55 }}>
            <td><span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="btn quiet" disabled={busy || i === 0} aria-label="Move up" onClick={() => void move(i, -1)}>↑</button>
              <button className="btn quiet" disabled={busy || i === allLocations.length - 1} aria-label="Move down" onClick={() => void move(i, 1)}>↓</button></span></td>
            <td><input value={names[l.id] ?? ''} onChange={(e) => setNames((p) => ({ ...p, [l.id]: e.target.value }))} onBlur={() => { if ((names[l.id] ?? '').trim() && names[l.id] !== l.name) void save(l.id, names[l.id], null, null); }} aria-label={`Name of ${l.name}`} />
              {l.kind === 'store' && <span className="muted small"> The store itself</span>}{!l.active && <span className="chip off" style={{ marginLeft: 8 }}>Hidden</span>}</td>
            <td className="r num">{items[l.id] ?? 0}</td><td className="r num">{people[l.id] ?? 0}</td>
            <td className="r">{l.kind !== 'store' && <button className="btn" disabled={busy} onClick={() => void save(l.id, l.name, null, !l.active)}>{l.active ? 'Hide' : 'Show again'}</button>}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="card stack">
        <b>Add a counter</b>
        <div className="row"><input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="For example: Juice Bar" style={{ maxWidth: 280 }} onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) void add(); }} />
          <button className="btn primary" disabled={busy || !adding.trim()} onClick={() => void add()}>Add</button></div>
        <p className="muted small">After adding, tick it on each item it uses (Items, then Used at) and assign people to it (People).</p>
      </div>
    </>
  );
}

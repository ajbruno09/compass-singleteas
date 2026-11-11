import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { useToast } from '../components/Toast';

interface Shelf { id: number; name: string; icon: string; sort: number; active: boolean }

// Admin: the shelves (item groups) used on Stock in hand, Closing counts and indents.
// Hiding a shelf moves its items to another shelf first. Nothing is ever deleted.
export function Shelves() {
  const toast = useToast();
  const [rows, setRows] = useState<Shelf[]>([]);
  const [count, setCount] = useState<Record<number, number>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const [icons, setIcons] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  const [addIcon, setAddIcon] = useState('📦');
  const [hiding, setHiding] = useState<number | null>(null);
  const [target, setTarget] = useState('');

  const load = useCallback(async () => {
    const [g, it] = await Promise.all([supabase.from('item_groups').select('id, name, icon, sort, active').order('sort').order('id'), supabase.from('items').select('group_id').not('group_id', 'is', null)]);
    const list = (g.data as Shelf[]) ?? [];
    setRows(list); setNames(Object.fromEntries(list.map((s) => [s.id, s.name]))); setIcons(Object.fromEntries(list.map((s) => [s.id, s.icon])));
    const m: Record<number, number> = {}; ((it.data as { group_id: number }[]) ?? []).forEach((r) => { m[r.group_id] = (m[r.group_id] ?? 0) + 1; }); setCount(m);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(id: number | null, name: string, icon: string, sort: number | null) {
    setBusy(true);
    const { error } = await supabase.rpc('save_shelf', { p_id: id, p_name: name, p_icon: icon, p_sort: sort });
    setBusy(false);
    if (error) { toast(errText(error)); await load(); return false; }
    await load(); return true;
  }
  async function move(i: number, dir: -1 | 1) {
    const a = rows[i]; const b = rows[i + dir];
    if (!a || !b) return;
    const sb = b.sort === a.sort ? a.sort + dir : b.sort;
    setBusy(true);
    const r1 = await supabase.rpc('save_shelf', { p_id: a.id, p_name: a.name, p_icon: a.icon, p_sort: sb });
    const r2 = await supabase.rpc('save_shelf', { p_id: b.id, p_name: b.name, p_icon: b.icon, p_sort: a.sort });
    setBusy(false);
    if (r1.error || r2.error) toast(errText((r1.error ?? r2.error)!));
    await load();
  }
  async function setActive(s: Shelf, active: boolean, moveTo: string | null) {
    setBusy(true);
    const { data, error } = await supabase.rpc('retire_shelf', { p_id: s.id, p_move_to: moveTo ? Number(moveTo) : null, p_active: active });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    setHiding(null); setTarget('');
    toast(active ? 'Shelf is back' : `Shelf hidden${Number(data) ? ` · ${data} items moved` : ''}`);
    await load();
  }
  async function add() {
    if (await save(null, adding, addIcon, null)) { setAdding(''); setAddIcon('📦'); toast('Shelf added'); }
  }

  const visible = rows.filter((s) => s.active);
  return (
    <>
      <div className="pagehead"><div><p className="label">Masters</p><h1>Shelves</h1>
        <p className="muted small" style={{ marginTop: 2 }}>The sections items sit under on Stock in hand, Closing counts and indents. Rename, reorder, add or hide. Nothing is ever deleted.</p></div></div>
      <div className="tablewrap"><table style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 130 }} /></colgroup>
        <thead><tr><th>Order</th><th>Icon</th><th>Name</th><th className="r">Items</th><th /></tr></thead>
        <tbody>{rows.map((s, i) => (
          <tr key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
            <td><span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="btn quiet" disabled={busy || !s.active || i === 0} aria-label="Move up" onClick={() => void move(i, -1)}>↑</button>
              <button className="btn quiet" disabled={busy || !s.active || i === rows.length - 1} aria-label="Move down" onClick={() => void move(i, 1)}>↓</button></span></td>
            <td><input value={icons[s.id] ?? ''} onChange={(e) => setIcons((p) => ({ ...p, [s.id]: e.target.value }))} onBlur={() => { if ((icons[s.id] ?? '').trim() && icons[s.id] !== s.icon) void save(s.id, s.name, icons[s.id], null); }} aria-label={`Icon of ${s.name}`} style={{ width: 70 }} /></td>
            <td><input value={names[s.id] ?? ''} onChange={(e) => setNames((p) => ({ ...p, [s.id]: e.target.value }))} onBlur={() => { if ((names[s.id] ?? '').trim() && names[s.id] !== s.name) void save(s.id, names[s.id], s.icon, null); }} aria-label={`Name of ${s.name}`} />
              {!s.active && <span className="chip off" style={{ marginLeft: 8 }}>Hidden</span>}
              {hiding === s.id && (
                <span className="row" style={{ marginTop: 6, gap: 6 }}>
                  {(count[s.id] ?? 0) > 0 && <><span className="muted small">Move its {count[s.id]} items to</span>
                    <select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a shelf</option>{visible.filter((v) => v.id !== s.id).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></>}
                  <button className="btn primary" disabled={busy || ((count[s.id] ?? 0) > 0 && !target)} onClick={() => void setActive(s, false, target)}>Hide shelf</button>
                  <button className="btn quiet" onClick={() => { setHiding(null); setTarget(''); }}>Cancel</button>
                </span>)}</td>
            <td className="r num">{count[s.id] ?? 0}</td>
            <td className="r">{s.active ? <button className="btn" disabled={busy} onClick={() => { setHiding(s.id); setTarget(''); }}>Hide</button> : <button className="btn" disabled={busy} onClick={() => void setActive(s, true, null)}>Show again</button>}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="card stack">
        <b>Add a shelf</b>
        <div className="row"><input value={addIcon} onChange={(e) => setAddIcon(e.target.value)} style={{ width: 70 }} aria-label="Icon" />
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="For example: Tea & Coffee" style={{ maxWidth: 280 }} onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) void add(); }} />
          <button className="btn primary" disabled={busy || !adding.trim()} onClick={() => void add()}>Add</button></div>
        <p className="muted small">After adding, move items onto it from Items (Group) or Data check.</p>
      </div>
    </>
  );
}

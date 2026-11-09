import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, qty as fmtQty } from '../lib/format';
import { useToast } from '../components/Toast';
import type { Group } from '../lib/types';

interface Item { id: number; name: string; unit: string; group_id: number | null }
const FILTERS = [['all', 'All items'], ['na', 'Not set'], ['low', 'Low'], ['neg', 'Below zero'], ['ok', 'OK']] as const;
type F = typeof FILTERS[number][0];

export function StoreLevels() {
  const { profile } = useSession();
  const toast = useToast();
  const can = ['owner', 'manager', 'store'].includes(profile?.role ?? '');
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [hand, setHand] = useState<Map<number, number>>(new Map());
  const [par, setPar] = useState<Map<number, number>>(new Map());
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<F>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [i, g, s, p] = await Promise.all([
      supabase.from('items').select('id, name, unit, group_id').eq('active', true).order('name').limit(2000),
      supabase.from('item_groups').select('*').order('sort'),
      supabase.from('stock_on_hand').select('item_id, qty').eq('location_id', 1),
      supabase.from('item_locations').select('item_id, par_level').eq('location_id', 1),
    ]);
    setItems((i.data as Item[]) ?? []); setGroups((g.data as Group[]) ?? []);
    setHand(new Map(((s.data as { item_id: number; qty: number }[]) ?? []).map((r) => [r.item_id, Number(r.qty)])));
    setPar(new Map(((p.data as { item_id: number; par_level: number | null }[]) ?? []).filter((r) => r.par_level != null).map((r) => [r.item_id, Number(r.par_level)])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const level = (id: number): number | null => { const e = edits[id]; if (e !== undefined) return e === '' || isNaN(Number(e)) ? null : Number(e); return par.get(id) ?? null; };
  const status = (i: Item): F => { const h = hand.get(i.id) ?? 0; const l = level(i.id); if (h < -0.0004) return 'neg'; if (l == null) return 'na'; return h < l ? 'low' : 'ok'; };
  const counts = useMemo(() => { const c: Record<F, number> = { all: items.length, na: 0, low: 0, neg: 0, ok: 0 }; for (const i of items) c[status(i)]++; return c; }, [items, hand, par, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const setCount = items.filter((i) => level(i.id) != null).length;
  const rows = items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()) && (filter === 'all' || status(i) === filter));
  const changed = Object.keys(edits).length;

  const onEdit = (i: Item, raw: string) => {
    const v = raw.replace(/[^0-9.]/g, '');
    const same = v === (par.has(i.id) ? String(par.get(i.id)) : '');
    setEdits((e) => { const n = { ...e }; if (same) delete n[i.id]; else n[i.id] = v; return n; });
  };
  async function save() {
    setBusy(true);
    const out = Object.entries(edits).map(([id, v]) => ({ item_id: Number(id), par: v }));
    const { error } = await supabase.rpc('save_store_levels', { p_rows: out });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    setEdits({}); toast(`Saved ${out.length} ${out.length === 1 ? 'level' : 'levels'}`); void load();
  }
  const chip = (s: F) => s === 'ok' ? <span className="chip done">OK</span> : s === 'low' ? <span className="chip late">Low</span> : s === 'neg' ? <span className="chip flag">Below zero</span> : <span className="chip off">Not set</span>;

  return (
    <div className="page">
      <div className="pagehead"><div><p className="label">Items</p><h1>Store levels</h1><p className="muted small">How much of each item the Store should always keep. When the stock in hand falls below this, the item shows as Low. Counters keep their own usual levels on the item.</p></div></div>
      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><span><b>{setCount} of {items.length}</b> items have a level</span><span className="muted small">{items.length - setCount} still to set</span></div>
        <div style={{ height: 8, background: 'var(--sunken)', borderRadius: 99, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${items.length ? (setCount / items.length) * 100 : 0}%`, background: 'var(--brand)' }} /></div>
      </div>
      <div className="row" style={{ gap: 8, margin: '14px 0 10px', flexWrap: 'wrap' }}>
        <div className="seg">{FILTERS.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} ({counts[k]})</button>)}</div>
        <input placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: 'auto', width: 220 }} />
      </div>
      {[...groups, { id: null as unknown as number, name: 'No shelf group yet', icon: '📦' } as Group].map((g) => {
        const list = rows.filter((i) => (g.id == null ? !groups.some((x) => x.id === i.group_id) : i.group_id === g.id));
        if (!list.length) return null;
        return (
          <div key={g.id ?? 'none'} style={{ marginBottom: 14 }}><h2 style={{ marginBottom: 8 }}>{g.icon} {g.name}</h2>
            <div className="tablewrap"><table className="table"><thead><tr><th>Item</th><th className="r">In hand</th><th className="r">Level to keep</th><th>Status</th></tr></thead>
              <tbody>{list.map((i) => { const h = hand.get(i.id) ?? 0; const e = edits[i.id]; return (
                <tr key={i.id} style={e !== undefined ? { background: 'var(--warn-bg)' } : undefined}>
                  <td>{i.name}</td>
                  <td className="r num" style={{ color: h < -0.0004 ? 'var(--bad)' : undefined, fontWeight: h < -0.0004 ? 600 : 400 }}>{fmtQty(h, i.unit)}</td>
                  <td className="r">{can ? <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><input className="num" inputMode="decimal" placeholder="Not set" style={{ width: 90, textAlign: 'right' }} value={e !== undefined ? e : par.has(i.id) ? String(par.get(i.id)) : ''} onChange={(ev) => onEdit(i, ev.target.value)} /><span className="muted small" style={{ width: 40, textAlign: 'left' }}>{i.unit}</span></span> : <span className="num">{par.has(i.id) ? fmtQty(par.get(i.id), i.unit) : '—'}</span>}</td>
                  <td>{chip(status(i))}</td>
                </tr>); })}</tbody></table></div></div>);
      })}
      {rows.length === 0 && <p className="empty card">Nothing to show with these filters.</p>}
      {can && changed > 0 && (
        <div className="stickybar" style={{ position: 'sticky', bottom: 12, display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center', background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '10px 14px', width: 'fit-content', margin: '14px auto 0' }}>
          <span>{changed} {changed === 1 ? 'change' : 'changes'} not saved</span>
          <button className="btn secondary" onClick={() => setEdits({})}>Discard</button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}
    </div>
  );
}

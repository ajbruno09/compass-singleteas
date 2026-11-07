import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty, packFactor } from '../lib/format';
import type { Group } from '../lib/types';

interface Item { id: number; name: string; unit: string; group_id: number | null; show_as?: string | null; purchase_factor?: number | null }
interface OnHand { location_id: number; item_id: number; qty: number }

export function StockView() {
  const { locations } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [oh, setOh] = useState<OnHand[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loc, setLoc] = useState<number | 0>(1);
  const [links, setLinks] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [onlyStock, setOnlyStock] = useState(true);
  useEffect(() => {
    supabase.from('items').select('id, name, unit, group_id, show_as, purchase_factor').eq('active', true).order('name').then(({ data }) => setItems((data as Item[]) ?? []));
    supabase.from('stock_on_hand').select('*').then(({ data }) => setOh((data as OnHand[]) ?? []));
    supabase.from('item_locations').select('item_id, location_id').then(({ data }) => setLinks(new Set(((data as { item_id: number; location_id: number }[]) ?? []).map((r) => `${r.location_id}:${r.item_id}`))));
    supabase.from('item_groups').select('*').order('sort').then(({ data }) => setGroups((data as Group[]) ?? []));
  }, []);
  const qtyOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of oh) if (loc === 0 || r.location_id === loc) m.set(r.item_id, (m.get(r.item_id) ?? 0) + Number(r.qty));
    return m;
  }, [oh, loc]);
  // A counter lists only the items it uses (or anything it holds). The Store and All places list everything.
  const belongs = (i: Item) => loc === 0 || loc === 1 || links.has(`${loc}:${i.id}`) || Math.abs(qtyOf.get(i.id) ?? 0) > 0.0004;
  const rows = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) && belongs(i) && (!onlyStock || Math.abs(qtyOf.get(i.id) ?? 0) > 0.0004));
  return (
    <>
      <div className="pagehead"><div><p className="label">Store</p><h1>Stock in hand</h1><p className="muted small" style={{ marginTop: 2 }}>What the system believes is at each place right now.</p></div></div>
      <div className="seg" role="group" aria-label="Place"><button aria-pressed={loc === 0} onClick={() => setLoc(0)}>All places</button>{locations.filter((l) => l.active).map((l) => <button key={l.id} aria-pressed={loc === l.id} onClick={() => setLoc(l.id)}>{l.name}</button>)}</div>
      <div className="row"><input placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Only items with stock</label></div>
      {[...groups, { id: null as unknown as number, name: 'No shelf group yet', icon: '📦' } as Group].map((g) => { const list = rows.filter((i) => (g.id == null ? !groups.some((x) => x.id === i.group_id) : i.group_id === g.id)); if (!list.length) return null; return (
        <div key={g.id ?? 'none'}><h2 style={{ marginBottom: 8 }}>{g.icon} {g.name}</h2>
          <div className="tablewrap"><table><thead><tr><th>Item</th><th className="r">In hand</th></tr></thead>
            <tbody>{list.map((i) => { const v = qtyOf.get(i.id) ?? 0; return <tr key={i.id}><td>{i.name}</td><td className="r num" style={{ color: v < 0 ? '#B42335' : undefined, fontWeight: v < 0 ? 700 : 400 }}>{(loc === 0 || loc === 1) && packFactor(i) ? <>{Math.round((v / packFactor(i)) * 10) / 10} {i.show_as}<span className="muted small"> ({fmtQty(v, i.unit)})</span></> : fmtQty(v, i.unit)}</td></tr>; })}</tbody></table></div></div>); })}
      {rows.length === 0 && <p className="empty card">Nothing to show here. {onlyStock ? 'Untick “Only items with stock” to see every item for this place, or enter opening stock first.' : 'No items are set up for this place yet.'}</p>}
    </>
  );
}

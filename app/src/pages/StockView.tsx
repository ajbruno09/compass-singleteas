import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty, packFactor } from '../lib/format';
import type { Group } from '../lib/types';

interface Item { id: number; name: string; unit: string; group_id: number | null; show_as?: string | null; purchase_factor?: number | null }
interface OnHand { location_id: number; item_id: number; qty: number }
type V = 'in' | 'neg' | 'all';
const EPS = 0.0004;

export function StockView() {
  const { locations } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [oh, setOh] = useState<OnHand[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loc, setLoc] = useState<number | 0>(1);
  const [links, setLinks] = useState<Set<string>>(new Set());
  const [pars, setPars] = useState<Map<number, number>>(new Map());
  const [q, setQ] = useState('');
  const [view, setView] = useState<V>('in');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<number | null>(null);
  useEffect(() => {
    supabase.from('items').select('id, name, unit, group_id, show_as, purchase_factor').eq('active', true).order('name').limit(2000).then(({ data }) => setItems((data as Item[]) ?? []));
    supabase.from('stock_on_hand').select('*').then(({ data }) => setOh((data as OnHand[]) ?? []));
    supabase.from('item_locations').select('item_id, location_id, par_level').then(({ data }) => {
      const d = (data as { item_id: number; location_id: number; par_level: number | null }[]) ?? [];
      setLinks(new Set(d.map((r) => `${r.location_id}:${r.item_id}`)));
      setPars(new Map(d.filter((r) => r.location_id === 1 && r.par_level != null).map((r) => [r.item_id, Number(r.par_level)])));
    });
    supabase.from('item_groups').select('*').order('sort').then(({ data }) => setGroups((data as Group[]) ?? []));
  }, []);
  const qtyOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of oh) if (loc === 0 || r.location_id === loc) m.set(r.item_id, (m.get(r.item_id) ?? 0) + Number(r.qty));
    return m;
  }, [oh, loc]);
  const belongs = (i: Item) => loc === 0 || loc === 1 || links.has(`${loc}:${i.id}`) || Math.abs(qtyOf.get(i.id) ?? 0) > EPS;
  const scope = items.filter(belongs);
  const nNeg = scope.filter((i) => (qtyOf.get(i.id) ?? 0) < -EPS).length;
  const nIn = scope.filter((i) => Math.abs(qtyOf.get(i.id) ?? 0) > EPS).length;
  const placeCount = (id: number) => { const s = new Set<number>(); for (const r of oh) if (r.location_id === id && Math.abs(Number(r.qty)) > EPS) s.add(r.item_id); return s.size; };
  const placeNeg = (id: number) => oh.some((r) => r.location_id === id && Number(r.qty) < -EPS);
  const holding = new Set(oh.filter((r) => Math.abs(Number(r.qty)) > EPS).map((r) => r.location_id)).size;
  const rows = scope.filter((i) => {
    if (!i.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    const v = qtyOf.get(i.id) ?? 0;
    return view === 'all' || (view === 'neg' ? v < -EPS : Math.abs(v) > EPS);
  });
  const lowAt = (i: Item) => loc === 1 && pars.has(i.id) && (qtyOf.get(i.id) ?? 0) >= -EPS && (qtyOf.get(i.id) ?? 0) < (pars.get(i.id) ?? 0);
  const nLow = loc === 1 ? scope.filter(lowAt).length : 0;
  const tile = (n: number | string, l: string, on?: () => void, tone?: string) => (
    <button className="card" onClick={on} style={{ textAlign: 'left', cursor: on ? 'pointer' : 'default', padding: '10px 14px' }}>
      <div className="muted small">{l}</div><div className="num" style={{ fontSize: 22, fontWeight: 500, color: tone }}>{n}</div></button>);
  const fmt = (i: Item, v: number) => (loc === 0 || loc === 1) && packFactor(i) ? <>{Math.round((v / packFactor(i)) * 10) / 10} {i.show_as}<span className="muted small"> ({fmtQty(v, i.unit)})</span></> : fmtQty(v, i.unit);
  const shelves = [...groups, { id: null as unknown as number, name: 'No shelf group yet', icon: '📦' } as Group];

  return (
    <div className="page">
      <div className="pagehead"><div><p className="label">Store</p><h1>Stock in hand</h1><p className="muted small" style={{ marginTop: 2 }}>What the system believes is at each place right now.</p></div></div>
      <div className="seg" role="group" aria-label="Place">
        <button aria-pressed={loc === 0} onClick={() => setLoc(0)}>All places</button>
        {locations.filter((l) => l.active).map((l) => <button key={l.id} aria-pressed={loc === l.id} onClick={() => setLoc(l.id)}>{l.name} <span style={{ opacity: .65 }}>{placeCount(l.id)}</span>{placeNeg(l.id) && <i style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 9, background: 'var(--bad)', marginLeft: 5 }} />}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, margin: '12px 0' }}>
        {tile(nIn, 'Items in hand', () => setView('in'))}
        {tile(nNeg, 'Below zero', nNeg ? () => setView('neg') : undefined, nNeg ? 'var(--bad)' : undefined)}
        {loc === 1 ? tile(nLow, 'Low against Store levels') : tile(holding, 'Places holding stock')}
      </div>
      <div className="row" style={{ gap: 8, margin: '0 0 10px', flexWrap: 'wrap' }}>
        <div className="seg"><button aria-pressed={view === 'in'} onClick={() => setView('in')}>In stock ({nIn})</button><button aria-pressed={view === 'neg'} onClick={() => setView('neg')}>Below zero ({nNeg})</button><button aria-pressed={view === 'all'} onClick={() => setView('all')}>Everything ({scope.length})</button></div>
        <input placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: 'auto', width: 220 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12, alignItems: 'start' }}>
        {shelves.map((g) => {
          const list = rows.filter((i) => (g.id == null ? !groups.some((x) => x.id === i.group_id) : i.group_id === g.id));
          if (!list.length) return null;
          const key = String(g.id ?? 'none'); const closed = open.has(key); const gneg = list.filter((i) => (qtyOf.get(i.id) ?? 0) < -EPS).length;
          return (
            <div key={key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '10px 14px', border: 0, background: 'var(--sunken)', cursor: 'pointer', font: 'inherit' }}>
                <span>{g.icon}</span><span style={{ fontWeight: 500 }}>{g.name}</span><span className="muted small">{list.length}</span>
                {gneg > 0 && <span className="chip flag" style={{ marginLeft: 'auto' }}>{gneg} below zero</span>}<span className="muted" style={{ marginLeft: gneg ? 6 : 'auto' }}>{closed ? '▸' : '▾'}</span>
              </button>
              {!closed && <table className="table" style={{ margin: 0 }}><tbody>{list.map((i) => { const v = qtyOf.get(i.id) ?? 0; const neg = v < -EPS; const low = lowAt(i); return (
                <Fragment key={i.id}>
                  <tr onClick={() => neg && setOpenRow(openRow === i.id ? null : i.id)} style={{ cursor: neg ? 'pointer' : undefined }}>
                    <td>{i.name}{low && <span className="chip late" style={{ marginLeft: 8 }}>Low</span>}</td>
                    <td className="r num" style={{ color: neg ? 'var(--bad)' : undefined, fontWeight: neg ? 600 : 400 }}>{neg && <span className="chip flag" style={{ marginRight: 8 }}>needs a count</span>}{fmt(i, v)}</td>
                  </tr>
                  {neg && openRow === i.id && <tr><td colSpan={2} className="small" style={{ background: 'var(--bad-bg)' }}>Stock was issued before it was received or counted, so the record went below zero. A closing count at the Store sets it right. <Link to="/counts">Go to Closing counts</Link></td></tr>}
                </Fragment>); })}</tbody></table>}
            </div>);
        })}
      </div>
      {rows.length === 0 && <p className="empty card">Nothing to show here. {view === 'in' ? 'Choose Everything to see every item for this place, or enter opening stock first.' : view === 'neg' ? 'Nothing is below zero.' : 'No items are set up for this place yet.'}</p>}
    </div>
  );
}

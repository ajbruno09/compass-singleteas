import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty, packFactor } from '../lib/format';
import type { Group } from '../lib/types';
import '../mock-levels.css';

interface Item { id: number; name: string; unit: string; group_id: number | null; show_as?: string | null; purchase_factor?: number | null }
interface OnHand { location_id: number; item_id: number; qty: number }
type V = 'stock' | 'neg' | 'all';
const EPS = 0.0004;
const icon = (s: string) => { try { return [...new (Intl as unknown as { Segmenter: new () => { segment: (x: string) => Iterable<{ segment: string }> } }).Segmenter().segment(s)][0]?.segment ?? s; } catch { return Array.from(s)[0] ?? s; } };

export function StockView() {
  const { locations } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [oh, setOh] = useState<OnHand[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loc, setLoc] = useState<number | 0>(1);
  const [links, setLinks] = useState<Set<string>>(new Set());
  const [pars, setPars] = useState<Map<number, number>>(new Map());
  const [q, setQ] = useState('');
  const [view, setView] = useState<V>('stock');
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<Set<number>>(new Set());
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
  const placesHolding = new Set(oh.filter((r) => Math.abs(Number(r.qty)) > EPS).map((r) => r.location_id)).size;
  const active = locations.filter((l) => l.active);
  const ql = q.trim().toLowerCase();
  const fmt = (i: Item, v: number) => (loc === 0 || loc === 1) && packFactor(i) ? `${Math.round((v / packFactor(i)) * 10) / 10} ${i.show_as} (${fmtQty(v, i.unit)})` : fmtQty(v, i.unit);
  const shelves = [...groups, { id: null as unknown as number, name: 'No shelf group yet', icon: '📦' } as Group];
  const groupRows = shelves.map((g) => ({ g, rows: scope.filter((i) => (g.id == null ? !groups.some((x) => x.id === i.group_id) : i.group_id === g.id) && (!ql || i.name.toLowerCase().includes(ql)) && (view === 'neg' ? (qtyOf.get(i.id) ?? 0) < -EPS : view === 'stock' ? Math.abs(qtyOf.get(i.id) ?? 0) > EPS : true)) })).filter((x) => x.rows.length);
  const anyOpen = groupRows.some((x) => !shut.has(String(x.g.id ?? 'none')));
  const lowAt = (i: Item) => loc === 1 && pars.has(i.id) && (qtyOf.get(i.id) ?? 0) >= -EPS && (qtyOf.get(i.id) ?? 0) < (pars.get(i.id) ?? 0);
  const tog = <T,>(s: Set<T>, k: T) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  return (
    <div className="sx-root"><div className="sx-wrap">
      <div className="sx-top"><div><div className="sx-lab">Store</div><h1>Stock in hand</h1><div className="sx-sm sx-mut">What the system believes is at each place right now.</div></div></div>
      <div className="sx-places">
        <button className={`sx-pl ${loc === 0 ? 'sx-on' : ''}`} onClick={() => setLoc(0)}>All places</button>
        {active.map((l) => <button key={l.id} className={`sx-pl ${loc === l.id ? 'sx-on' : ''}`} onClick={() => setLoc(l.id)}>{l.name}<span className="sx-n">{placeCount(l.id)}</span>{placeNeg(l.id) && <span className="sx-dot" />}</button>)}
      </div>
      <div className="sx-tiles">
        <div className="sx-tile"><div className="sx-l">Items in hand</div><div className="sx-v sx-num">{nIn}</div><div className="sx-d">in {groupRows.length} groups</div></div>
        <button className="sx-tile sx-bad sx-btn" onClick={() => setView('neg')}><div className="sx-l">Below zero</div><div className="sx-v sx-num">{nNeg}</div><div className="sx-d">Tap to see them. These need a count.</div></button>
        <div className="sx-tile"><div className="sx-l">Places holding stock</div><div className="sx-v sx-num">{placesHolding}</div><div className="sx-d">Store and {Math.max(placesHolding - 1, 0)} counters</div></div>
      </div>
      <div className="sx-bar"><input type="search" placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="sx-seg">{([['stock', 'In stock'], ['neg', 'Below zero'], ['all', 'Everything']] as [V, string][]).map(([k, l]) => <button key={k} className={view === k ? 'sx-on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
        <span className="sx-sp" /><button className="sx-link" onClick={() => setShut(anyOpen ? new Set(groupRows.map((x) => String(x.g.id ?? 'none'))) : new Set())}>{anyOpen ? 'Collapse all' : 'Expand all'}</button></div>
      <div className="sx-cols">
        {groupRows.length === 0 ? <div className="sx-empty">Nothing to show with these filters.</div> : groupRows.map(({ g, rows }) => {
          const key = String(g.id ?? 'none'); const neg = rows.filter((i) => (qtyOf.get(i.id) ?? 0) < -EPS).length;
          return (
            <div key={key} className={`sx-g ${shut.has(key) ? 'sx-shut' : ''}`}>
              <button className="sx-gh" onClick={() => setShut((s) => tog(s, key))}><span className="sx-ic">{icon(g.icon ?? '📦')}</span><span><span className="sx-t">{g.name}</span> <span className="sx-c">{rows.length} {rows.length === 1 ? 'item' : 'items'}</span></span><span className="sx-sp" />{neg > 0 && <span className="sx-chip">{neg} below zero</span>}<span className="sx-chev">▾</span></button>
              <div className="sx-rows">{rows.map((i) => { const v = qtyOf.get(i.id) ?? 0; const isNeg = v < -EPS; return (
                <div key={i.id} className={`sx-row ${isNeg ? 'sx-neg' : ''} ${openRow.has(i.id) ? 'sx-open' : ''}`} onClick={(e) => { if (isNeg && !(e.target as HTMLElement).closest('.sx-btn')) setOpenRow((s) => tog(s, i.id)); }}>
                  <span className="sx-nm">{i.name}{lowAt(i) && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--warn)', background: 'var(--warns)', borderRadius: 99, padding: '1px 8px' }}>Low</span>}</span><span className="sx-q">{fmt(i, v)}</span>
                  {isNeg && <div className="sx-more"><span>More went out than came in. A closing count fixes it.</span><button className="sx-btn sx-p" onClick={() => nav('/counts')}>Recount</button></div>}
                </div>); })}</div>
            </div>);
        })}
      </div>
      <div className="sx-note">{view === 'stock' ? 'Items with nothing in hand are hidden. Choose Everything to see them.' : ''}</div>
    </div></div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText, qty as fmtQty } from '../lib/format';
import { useToast } from '../components/Toast';
import type { Group } from '../lib/types';
import '../mock-levels.css';

interface Item { id: number; name: string; unit: string; group_id: number | null }
type F = 'all' | 'na' | 'low' | 'neg' | 'ok';

export function StoreLevels() {
  const { profile } = useSession();
  const toast = useToast();
  const can = ['owner', 'manager', 'store'].includes(profile?.role ?? '');
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [hand, setHand] = useState<Map<number, number>>(new Map());
  const [par, setPar] = useState<Map<number, number>>(new Map());
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [flt, setFlt] = useState<F>('all');
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
  const cnt = useMemo(() => { const c: Record<F, number> = { all: items.length, na: 0, low: 0, neg: 0, ok: 0 }; for (const i of items) c[status(i)]++; return c; }, [items, hand, par, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const setN = items.filter((i) => level(i.id) != null).length;
  const ql = q.trim().toLowerCase();
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
  const F: [F, string][] = [['all', 'All items'], ['na', 'Not set'], ['low', 'Low'], ['neg', 'Below zero'], ['ok', 'OK']];
  const chip = (s: F) => s === 'ok' ? ['sl-c-ok', 'OK'] : s === 'low' ? ['sl-c-low', 'Low'] : s === 'neg' ? ['sl-c-bad', 'Below zero'] : ['sl-c-na', 'Not set'];
  const shelves = [...groups, { id: null as unknown as number, name: 'No shelf group yet', icon: '' } as Group];
  let any = false;
  const body = shelves.map((g) => {
    const rows = items.filter((i) => (g.id == null ? !groups.some((x) => x.id === i.group_id) : i.group_id === g.id) && (!ql || i.name.toLowerCase().includes(ql)) && (flt === 'all' || status(i) === flt));
    if (!rows.length) return null; any = true;
    return (<tbody key={g.id ?? 'none'}>
      <tr className="sl-grp"><td colSpan={4}>{g.name}</td></tr>
      {rows.map((i) => { const h = hand.get(i.id) ?? 0; const e = edits[i.id]; const c = chip(status(i)); return (
        <tr key={i.id}><td>{i.name}</td><td className={`sl-r sl-num ${h < -0.0004 ? 'sl-neg' : ''}`}>{fmtQty(h, i.unit)}</td>
          <td className="sl-r">{can ? <input className={e !== undefined ? 'sl-ch' : ''} inputMode="decimal" placeholder="Not set" value={e !== undefined ? e : par.has(i.id) ? String(par.get(i.id)) : ''} onChange={(ev) => onEdit(i, ev.target.value)} /> : <span>{par.has(i.id) ? par.get(i.id) : ''}</span>}<span className="sl-u">{i.unit}</span></td>
          <td className="sl-hide-s"><span className={`sl-chip ${c[0]}`}>{c[1]}</span></td></tr>); })}
    </tbody>);
  });
  return (
    <div className="sl-root"><div className="sl-wrap">
      <div><div className="sl-lab">Items</div><h1>Store levels</h1><div className="sl-sm sl-mut">How much of each item the Store should always keep. When the stock in hand falls below this, the item shows as Low. Counters keep their own usual levels on the item.</div></div>
      <div className="sl-prog"><div className="sl-t"><span><b style={{ fontWeight: 600 }}>{setN} of {items.length}</b> items have a level</span><span className="sl-sm sl-mut">{items.length - setN} still to set</span></div><div className="sl-pb"><i style={{ width: `${items.length ? (setN / items.length) * 100 : 0}%` }} /></div></div>
      <div className="sl-bar"><input type="search" placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} /><div className="sl-seg">{F.map(([k, l]) => <button key={k} className={k === flt ? 'sl-on' : ''} onClick={() => setFlt(k)}>{l}<span className="sl-n">{cnt[k]}</span></button>)}</div></div>
      <div className="sl-card">{any || items.length === 0 ? null : null}
        {(() => { const t = body.filter(Boolean); return t.length ? <table><thead><tr><th>Item</th><th className="sl-r">In hand</th><th className="sl-r">Level to keep</th><th className="sl-hide-s">Status</th></tr></thead>{body}</table> : <div className="sl-empty">Nothing to show with these filters.</div>; })()}
      </div>
    </div>
    {can && changed > 0 && <div className="sl-save sl-on"><span>{changed} {changed === 1 ? 'change' : 'changes'} not saved</span><button className="sl-btn" onClick={() => setEdits({})}>Discard</button><button className="sl-btn sl-p" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button></div>}
    </div>
  );
}

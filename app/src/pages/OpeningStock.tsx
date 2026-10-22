import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty, errText } from '../lib/format';
import type { Item } from '../lib/types';
import { useToast } from '../components/Toast';

interface OnHand { location_id: number; item_id: number; qty: number }

export function OpeningStock() {
  const { locations } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [onHand, setOnHand] = useState<OnHand[]>([]);
  const [loc, setLoc] = useState<number | null>(null);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [{ data: it }, { data: oh }] = await Promise.all([
      supabase.from('items').select('*').eq('active', true).order('name'),
      supabase.from('stock_on_hand').select('*')
    ]);
    setItems((it as Item[]) ?? []);
    setOnHand((oh as OnHand[]) ?? []);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (loc == null && locations.length) setLoc(locations[0].id); }, [locations, loc]);

  const have = useMemo(() => new Map(onHand.filter((o) => o.location_id === loc).map((o) => [o.item_id, Number(o.qty)])), [onHand, loc]);

  async function save() {
    setError('');
    const rows = Object.entries(vals).filter(([, v]) => v.trim() !== '');
    if (!rows.length) return setError('Enter at least one quantity.');
    setBusy(true);
    let done = 0;
    for (const [id, v] of rows) {
      const n = Number(v);
      if (!(n > 0)) continue;
      const { error } = await supabase.rpc('post_opening_stock', { p_location_id: loc, p_item_id: Number(id), p_qty: n, p_note: '' });
      if (error) { setError(`${items.find((i) => i.id === Number(id))?.name}: ${errText(error)}`); break; }
      done++;
    }
    setBusy(false);
    if (done) { toast(`Opening stock saved for ${done} items`); setVals({}); load(); }
  }

  return (
    <>
      <div className="pagehead"><div><p className="label">Starting Compass</p><h1>Opening stock</h1></div></div>
      <p className="muted">Count what is on the shelf today, once per place. This is the starting point for every stock figure after it, so it cannot be edited later, only corrected with an adjustment.</p>
      <div className="seg" role="group" aria-label="Place">
        {locations.map((l) => <button key={l.id} aria-pressed={loc === l.id} onClick={() => { setLoc(l.id); setVals({}); }}>{l.name}</button>)}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Item</th><th>Unit</th><th className="r">Already entered</th><th className="r">Count now</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td><strong>{i.name}</strong></td><td>{i.unit}</td>
                <td className="r num">{have.has(i.id) ? qty(have.get(i.id), i.unit) : '—'}</td>
                <td className="r" style={{ width: 160 }}>
                  {have.has(i.id) ? <span className="chip done">Done</span> :
                    <input aria-label={`Opening ${i.name}`} inputMode="decimal" className="num" style={{ textAlign: 'right' }}
                      value={vals[i.id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [i.id]: e.target.value }))} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="empty">Add items first, then enter their opening stock here.</p>}
      </div>
      {error && <p className="banner bad" role="alert">{error}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save opening stock'}</button></div>
    </>
  );
}

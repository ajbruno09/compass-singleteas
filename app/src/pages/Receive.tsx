import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { qty as fmtQty, errText, date as fdate, packFactor, round3 } from '../lib/format';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';

interface Item { id: number; name: string; unit: string; show_as?: string | null; purchase_factor?: number | null }
interface Vendor { id: string; name: string }
interface Po { id: string; po_number: string; vendor_id: string; status: string; order_date: string; required_date: string | null; po_lines: { item_id: number; qty: number }[] }
interface Grn { po_id: string; grn_lines: { item_id: number; qty_received: number }[] }

export function Receive() {
  const toast = useToast();
  const [pos, setPos] = useState<Po[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [items, setItems] = useState<Record<number, Item>>({});
  const [vendors, setVendors] = useState<Record<string, Vendor>>({});
  const [open, setOpen] = useState<Po | 'free' | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, i, v] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, vendor_id, status, order_date, required_date, po_lines(item_id, qty)').in('status', ['sent', 'partly_received']).order('order_date', { ascending: false }),
      supabase.from('items').select('id, name, unit, show_as, purchase_factor').eq('active', true).order('name'),
      supabase.from('vendors').select('id, name').eq('active', true).order('name')
    ]);
    const list = (p.data as Po[]) ?? [];
    setPos(list);
    setItems(Object.fromEntries(((i.data as Item[]) ?? []).map((x) => [x.id, x])));
    setVendors(Object.fromEntries(((v.data as Vendor[]) ?? []).map((x) => [x.id, x])));
    if (list.length) {
      const g = await supabase.from('goods_receipts').select('po_id, grn_lines(item_id, qty_received)').in('po_id', list.map((x) => x.id));
      setGrns((g.data as Grn[]) ?? []);
    } else setGrns([]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const got = (po: Po, item: number) => grns.filter((g) => g.po_id === po.id).flatMap((g) => g.grn_lines).filter((l) => l.item_id === item).reduce((s, l) => s + Number(l.qty_received), 0);

  async function closeOrder(po: Po) {
    const { error } = await supabase.rpc('close_po', { p_po_id: po.id });
    if (error) toast(errText(error)); else { toast('Order closed'); void load(); }
  }

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Store</p><h1>Receive goods</h1><p className="muted small" style={{ marginTop: 2 }}>Weigh or count what arrived first, then type it here. Stock updates the moment you save.</p></div>
        <button className="btn" onClick={() => setOpen('free')}>Received without an order</button>
      </div>
      {loading ? <p className="muted">Loading…</p> : pos.length === 0 ? <p className="empty card">No orders are waiting. Orders sent from Buying show up here.</p> : (
        <div className="stack">
          {pos.map((po) => (
            <div key={po.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div><b>{vendors[po.vendor_id]?.name ?? 'Vendor'}</b> <span className="muted small">· {po.po_number} · ordered {fdate(po.order_date)}{po.required_date ? ` · needed ${fdate(po.required_date)}` : ''}</span>
                  <div className="small muted">{po.po_lines.length} items{po.status === 'partly_received' ? ' · part received' : ''}</div></div>
                <div className="row"><button className="btn primary" onClick={() => setOpen(po)}>Receive</button>
                  {po.status === 'partly_received' && <button className="btn quiet" onClick={() => closeOrder(po)}>Close order</button>}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <ReceiveSheet po={open === 'free' ? null : open} items={items} vendors={vendors} got={got} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void load(); }} />}
    </>
  );
}

function ReceiveSheet({ po, items, vendors, got, onClose, onDone }: { po: Po | null; items: Record<number, Item>; vendors: Record<string, Vendor>; got: (po: Po, item: number) => number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [vals, setVals] = useState<Record<number, string>>({});
  const [vendor, setVendor] = useState('');
  const [extra, setExtra] = useState<number[]>([]);
  const [bill, setBill] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ids = po ? po.po_lines.map((l) => l.item_id).concat(extra.filter((e) => !po.po_lines.some((l) => l.item_id === e))) : extra;
  const matches = useMemo(() => find.trim().length < 2 ? [] : Object.values(items).filter((i) => i.name.toLowerCase().includes(find.toLowerCase()) && !ids.includes(i.id)).slice(0, 6), [find, items, ids]);

  async function save() {
    setErr('');
    const lines = Object.entries(vals).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ item_id: Number(id), qty: round3(Number(v) * (packFactor(items[Number(id)] ?? {}) || 1)) }));
    if (!lines.length) return setErr('Enter what arrived for at least one item.');
    if (!po && !vendor) return setErr('Choose the vendor.');
    setBusy(true);
    const { error } = await supabase.rpc('receive_goods', { p_po_id: po?.id ?? null, p_vendor_id: po ? null : vendor, p_bill_number: bill, p_bill_date: null, p_bill_amount: amount ? Number(amount) : null, p_note: note, p_lines: lines });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast('Goods received. Stock updated.'); onDone();
  }

  return (
    <Sheet title={po ? `Receive ${vendors[po.vendor_id]?.name ?? ''} · ${po.po_number}` : 'Received without an order'} onClose={onClose}
      footer={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save and add to stock'}</button>}>
      {!po && <label className="field"><span>Vendor</span><select value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">Choose…</option>{Object.values(vendors).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
      <div className="tablewrap"><table>
        <thead><tr><th>Item</th>{po && <th className="r">Ordered</th>}<th className="r" style={{ width: 130 }}>Arrived now</th></tr></thead>
        <tbody>{ids.map((id) => { const it = items[id]; if (!it) return null; const line = po?.po_lines.find((l) => l.item_id === id); const already = po && line ? got(po, id) : 0; const f = packFactor(it); const d = (n: number) => (f ? `${Math.round((n / f) * 10) / 10} ${it.show_as}` : fmtQty(n, it.unit));
          return <tr key={id}><td><b>{it.name}</b> <span className="muted small">{f ? it.show_as : it.unit}</span></td>
            {po && <td className="r num">{line ? <>{d(Number(line.qty))}{already > 0 && <div className="small muted">got {d(already)}</div>}</> : <span className="muted small">extra</span>}</td>}
            <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110 }} aria-label={`Arrived ${it.name}`} value={vals[id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [id]: e.target.value }))} /></td></tr>; })}</tbody>
      </table></div>
      <label className="field"><span>Add another item</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a few letters" /></label>
      {matches.length > 0 && <div className="row">{matches.map((m) => <button key={m.id} className="qchip" onClick={() => { setExtra((p) => [...p, m.id]); setFind(''); }}>{m.name}</button>)}</div>}
      <div className="row" style={{ gap: 12 }}>
        <label className="field" style={{ flex: 1 }}><span>Bill number (optional)</span><input value={bill} onChange={(e) => setBill(e.target.value)} /></label>
        <label className="field" style={{ flex: 1 }}><span>Bill amount (optional)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <p className="banner bad" role="alert">{err}</p>}
    </Sheet>
  );
}

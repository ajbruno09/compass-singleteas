import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { qty as fmtQty, errText, date as fdate, packFactor, round3 } from '../lib/format';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';

interface Item { id: number; name: string; unit: string; show_as?: string | null; purchase_factor?: number | null; pack_name?: string | null }
// Chicken portions are for counters. The store receives those in kg.
const rf = (i: Item) => (i.pack_name === 'portion' ? 0 : packFactor(i));
interface Vendor { id: string; name: string }
interface Po { id: string; po_number: string; vendor_id: string; status: string; order_date: string; required_date: string | null; po_lines: { item_id: number; qty: number }[] }
interface Pending { id: string; grn_number: string; vendor_id: string; received_at: string }
interface Grn { po_id: string; grn_lines: { item_id: number; qty_received: number }[] }

const MAX_BILLS = 3;
async function uploadBills(uid: string, files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${uid}/${Date.now()}-${i}.${ext}`;
    const up = await supabase.storage.from('bill-photos').upload(path, f, { upsert: false, contentType: f.type || undefined });
    if (up.error) throw up.error;
    out.push(path);
  }
  return out;
}

function BillPicker({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {files.map((f, i) => (
        <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small">{f.type === 'application/pdf' ? 'PDF' : 'Photo'} {i + 1}: {f.name}</span>
          <button type="button" className="btn quiet" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {files.length < MAX_BILLS && (
        <label className="btn" style={{ cursor: 'pointer', justifyContent: 'center' }}>
          {files.length === 0 ? 'Take a photo or choose the bill' : 'Add another page'}
          <input type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles([...files, f].slice(0, MAX_BILLS)); e.target.value = ''; }} />
        </label>
      )}
      <span className="small muted">Up to {MAX_BILLS} pages. Photo, image or PDF.</span>
    </div>
  );
}

function AddBillSheet({ grn, vendorName, onClose, onDone }: { grn: Pending; vendorName: string; onClose: () => void; onDone: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [no, setNo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setErr('');
    if (!files.length) return setErr('Add a photo of the bill.');
    setBusy(true);
    try {
      const paths = await uploadBills(profile?.id ?? 'x', files);
      const { error } = await supabase.rpc('add_bill_photos', { p_grn_id: grn.id, p_paths: paths, p_bill_number: no, p_bill_amount: amount ? Number(amount) : null });
      if (error) throw error;
      toast('Bill added'); onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={`Bill for ${vendorName} · ${grn.grn_number}`} onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save bill'}</button>}>
      <BillPicker files={files} setFiles={setFiles} />
      <div className="row" style={{ gap: 12 }}>
        <label className="field" style={{ flex: 1 }}><span>Bill number (optional)</span><input value={no} onChange={(e) => setNo(e.target.value)} /></label>
        <label className="field" style={{ flex: 1 }}><span>Bill amount (optional)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      {err && <p className="banner bad" role="alert">{err}</p>}
    </Sheet>
  );
}

export function Receive() {
  const toast = useToast();
  const [pos, setPos] = useState<Po[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [items, setItems] = useState<Record<number, Item>>({});
  const [vendors, setVendors] = useState<Record<string, Vendor>>({});
  const [open, setOpen] = useState<Po | 'free' | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending[]>([]);
  const [addFor, setAddFor] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    const [p, i, v] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, vendor_id, status, order_date, required_date, po_lines(item_id, qty)').in('status', ['sent', 'partly_received']).order('order_date', { ascending: false }),
      supabase.from('items').select('id, name, unit, show_as, purchase_factor, pack_name').eq('active', true).order('name'),
      supabase.from('vendors').select('id, name').eq('active', true).order('name')
    ]);
    const list = (p.data as Po[]) ?? [];
    setPos(list);
    const pb = await supabase.from('goods_receipts').select('id, grn_number, vendor_id, received_at').eq('bill_later', true).order('received_at', { ascending: false });
    setPending((pb.data as Pending[]) ?? []);
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
      {pending.length > 0 && (
        <div className="banner warn" style={{ display: 'grid', gap: 6 }}>
          <b>{pending.length} bill{pending.length === 1 ? '' : 's'} still to come</b>
          {pending.map((g) => (
            <div key={g.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{vendors[g.vendor_id]?.name ?? 'Vendor'} <span className="muted small">· {g.grn_number} · received {fdate(g.received_at)}</span></span>
              <button className="btn" onClick={() => setAddFor(g)}>Add bill</button>
            </div>
          ))}
        </div>
      )}
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
      {addFor && <AddBillSheet grn={addFor} vendorName={vendors[addFor.vendor_id]?.name ?? 'Vendor'} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); void load(); }} />}
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
  const [files, setFiles] = useState<File[]>([]);
  const [later, setLater] = useState(false);
  const { profile } = useSession();
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ids = po ? po.po_lines.map((l) => l.item_id).concat(extra.filter((e) => !po.po_lines.some((l) => l.item_id === e))) : extra;
  const matches = useMemo(() => find.trim().length < 2 ? [] : Object.values(items).filter((i) => i.name.toLowerCase().includes(find.toLowerCase()) && !ids.includes(i.id)).slice(0, 6), [find, items, ids]);

  async function save() {
    setErr('');
    const lines = Object.entries(vals).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ item_id: Number(id), qty: round3(Number(v) * (rf(items[Number(id)] ?? ({} as Item)) || 1)) }));
    if (!lines.length) return setErr('Enter what arrived for at least one item.');
    if (!po && !vendor) return setErr('Choose the vendor.');
    if (!files.length && !later) return setErr('Add a photo of the bill, or choose Bill will come later.');
    setBusy(true);
    let paths: string[] = [];
    try { paths = await uploadBills(profile?.id ?? 'x', files); } catch (e) { setBusy(false); return setErr(errText(e)); }
    const { error } = await supabase.rpc('receive_goods', { p_po_id: po?.id ?? null, p_vendor_id: po ? null : vendor, p_bill_number: bill, p_bill_date: null, p_bill_amount: amount ? Number(amount) : null, p_note: note, p_lines: lines, p_bill_paths: paths, p_bill_later: later && !paths.length });
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
        <tbody>{ids.map((id) => { const it = items[id]; if (!it) return null; const line = po?.po_lines.find((l) => l.item_id === id); const already = po && line ? got(po, id) : 0; const f = rf(it); const d = (n: number) => (f ? `${Math.round((n / f) * 10) / 10} ${it.show_as}` : fmtQty(n, it.unit));
          return <tr key={id}><td><b>{it.name}</b> <span className="muted small">{f ? it.show_as : it.unit}</span></td>
            {po && <td className="r num">{line ? <>{d(Number(line.qty))}{already > 0 && <div className="small muted">got {d(already)}</div>}</> : <span className="muted small">extra</span>}</td>}
            <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110 }} aria-label={`Arrived ${it.name}`} value={vals[id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [id]: e.target.value }))} /></td></tr>; })}</tbody>
      </table></div>
      <label className="field"><span>Add another item</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a few letters" /></label>
      {matches.length > 0 && <div className="row">{matches.map((m) => <button key={m.id} className="qchip" onClick={() => { setExtra((p) => [...p, m.id]); setFind(''); }}>{m.name}</button>)}</div>}
      <div className="field"><span>Bill</span>
        {!later && <BillPicker files={files} setFiles={setFiles} />}
        {files.length === 0 && <label className="row small" style={{ gap: 8, marginTop: 6 }}><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />Bill will come later. Remind us to add it.</label>}
      </div>
      <div className="row" style={{ gap: 12 }}>
        <label className="field" style={{ flex: 1 }}><span>Bill number (optional)</span><input value={bill} onChange={(e) => setBill(e.target.value)} /></label>
        <label className="field" style={{ flex: 1 }}><span>Bill amount (optional)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <p className="banner bad" role="alert">{err}</p>}
    </Sheet>
  );
}

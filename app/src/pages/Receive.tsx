import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { qty as fmtQty, errText, date as fdate, packFactor, round3 } from '../lib/format';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { readBill, type BillRead, type BillLine } from '../lib/readBill';

interface Item { id: number; name: string; unit: string; show_as?: string | null; purchase_factor?: number | null; pack_name?: string | null; count_unit?: string | null; pcs_per_portion?: number | null; last_cost?: number | null }
// Chicken portions are for counters. The store receives those in kg.
// People type "1 kg" or "500 g" in the arrived box. Read the number and the unit, and give back the number in the item's own unit.
function cleanQty(raw: string, unit: string): string | null {
  const t = raw.trim().toLowerCase().replace(/,/g, '');
  if (!t) return '';
  const m = t.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(kg|kgs|g|gm|gms|gram|grams|l|ltr|litre|litres|ml|pcs|pc|piece|pieces)?$/);
  if (!m) return null;
  let n = parseFloat(m[1]); const u = m[2] ?? '';
  const mass = ['kg', 'kgs'].includes(u) ? 1000 : ['g', 'gm', 'gms', 'gram', 'grams'].includes(u) ? 1 : 0;
  const vol = ['l', 'ltr', 'litre', 'litres'].includes(u) ? 1000 : u === 'ml' ? 1 : 0;
  const un = unit.toLowerCase();
  if (mass && ['kg'].includes(un)) n = (n * mass) / 1000;
  else if (mass && un === 'g') n = n * mass;
  else if (vol && ['l', 'ltr'].includes(un)) n = (n * vol) / 1000;
  else if (vol && un === 'ml') n = n * vol;
  return String(Math.round(n * 1000) / 1000);
}
const rf = (i: Item) => (i.pack_name === 'portion' ? 0 : packFactor(i));
interface Vendor { id: string; name: string }
interface Po { id: string; po_number: string; vendor_id: string; status: string; order_date: string; required_date: string | null; po_lines: { item_id: number; qty: number }[] }
interface Pending { id: string; grn_number: string; vendor_id: string; received_at: string }
interface Grn { po_id: string; grn_lines: { item_id: number; qty_received: number }[] }

// Price before and now, per the unit the item is bought in. Red up arrow when it went up, green down arrow when it came down.
function PriceMark({ prev, now }: { prev: number | null | undefined; now: number }) {
  if (!(now > 0)) return null;
  if (prev == null || !(prev > 0)) return <div className="small" style={{ color: 'var(--info, #1D4F91)' }}>New price</div>;
  const p = Math.round(prev * 100) / 100;
  if (Math.abs(now - p) < 0.005) return <div className="small muted">= ₹{p} same</div>;
  const up = now > p; const pc = Math.round(Math.abs(now - p) / p * 100);
  return <div className="small" style={{ color: up ? 'var(--bad, #B02A1E)' : 'var(--ok, #1B6A4D)', fontWeight: 600, whiteSpace: 'nowrap' }}>{up ? '▲' : '▼'} ₹{p} → ₹{now} <span style={{ fontWeight: 500 }}>{pc}% {up ? 'up' : 'down'}</span></div>;
}
const fam = (u: string | null | undefined) => { const t = (u ?? '').toLowerCase().replace(/[^a-z]/g, ''); if (['kg', 'kgs'].includes(t)) return ['m', 1000]; if (['g', 'gm', 'gms', 'gram', 'grams'].includes(t)) return ['m', 1]; if (['l', 'ltr', 'litre', 'litres'].includes(t)) return ['v', 1000]; if (['ml'].includes(t)) return ['v', 1]; return [t, 1]; };
// Bill rate is for one billed unit. Give back the rate for the item's own unit, or null when the units do not line up.
function rateFor(it: Item, l: BillLine, packed: boolean): number | null {
  if (l.rate == null || !(l.rate > 0)) return null;
  if (packed || !l.unit) return l.rate;
  const [bf, bs] = fam(l.unit), [if_, is] = fam(it.unit);
  if (bf === if_) return Math.round(l.rate * (is as number) / (bs as number) * 100) / 100;
  return null;
}

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

// Reads the bill photo in the background and hands the result back so the boxes fill themselves.
function useBillRead(files: File[], vendor: string, apply: (r: BillRead) => void, names: { id: number; name: string; unit: string }[] = []) {
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState('');
  const key = files.map((f) => f.name + f.size).join('|');
  useEffect(() => {
    if (!files.length) { setNote(''); return; }
    let live = true;
    setReading(true); setNote('');
    readBill(files, vendor, names).then((r) => {
      if (!live) return;
      apply(r);
      const bits = [r.vendor && `Vendor: ${r.vendor}`].filter(Boolean);
      setNote(`Read from the bill. Please check it.${bits.length ? ' ' + bits.join('. ') + '.' : ''}${r.unclear.length ? ' Could not read: ' + r.unclear.join(', ').replace(/_/g, ' ') + '.' : ''}`);
    }).catch((e) => { if (live) setNote((e as Error).message + ' Type the details yourself.'); })
      .finally(() => { if (live) setReading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { reading, note };
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
  const br = useBillRead(files, vendorName, (r) => { if (r.bill_number) setNo((v) => v || r.bill_number!); if (r.total != null) setAmount((v) => v || String(r.total)); });
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
      {(br.reading || br.note) && <p className="small muted" role="status">{br.reading ? 'Reading the bill…' : br.note}</p>}
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
  const [pcsOn, setPcsOn] = useState<Record<number, number>>({});
  const [costKg, setCostKg] = useState<Record<number, number>>({});

  const load = useCallback(async () => {
    const [p, i, v] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, vendor_id, status, order_date, required_date, po_lines(item_id, qty)').in('status', ['sent', 'partly_received']).order('order_date', { ascending: false }),
      supabase.from('items').select('id, name, unit, show_as, purchase_factor, pack_name, count_unit, pcs_per_portion, last_cost').eq('active', true).order('name'),
      supabase.from('vendors').select('id, name').eq('active', true).order('name')
    ]);
    const list = (p.data as Po[]) ?? [];
    setPos(list);
    const [po2, pc2] = await Promise.all([supabase.rpc('pieces_on_hand', { p_loc: 1 }), supabase.from('item_price_book').select('item_id, unit_cost').not('unit_cost', 'is', null)]);
    setPcsOn(Object.fromEntries(((po2.data as { item_id: number; pieces: number }[]) ?? []).map((r) => [r.item_id, Math.max(0, Number(r.pieces))])));
    setCostKg(Object.fromEntries(((pc2.data as { item_id: number; unit_cost: number }[]) ?? []).map((r) => [r.item_id, Number(r.unit_cost)])));
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
      {open && <ReceiveSheet pcsOn={pcsOn} costKg={costKg} po={open === 'free' ? null : open} items={items} vendors={vendors} got={got} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void load(); }} />}
    </>
  );
}

function ReceiveSheet({ po, items, vendors, got, onClose, onDone, pcsOn, costKg }: { pcsOn: Record<number, number>; costKg: Record<number, number>; po: Po | null; items: Record<number, Item>; vendors: Record<string, Vendor>; got: (po: Po, item: number) => number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [vals, setVals] = useState<Record<number, string>>({});
  const [cnt, setCnt] = useState<Record<number, string>>({});
  const [neck, setNeck] = useState('');
  const [vendor, setVendor] = useState('');
  const [extra, setExtra] = useState<number[]>([]);
  const [bill, setBill] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [later, setLater] = useState(false);
  const [billDate, setBillDate] = useState('');
  const [rates, setRates] = useState<Record<number, string>>({});
  const [needRate, setNeedRate] = useState<number[]>([]);
  const [offBill, setOffBill] = useState<BillLine[]>([]);
  const [noMatch, setNoMatch] = useState<BillLine[]>([]);
  const [vitemIds, setVitemIds] = useState<number[]>([]);
  const vId = po ? po.vendor_id : vendor;
  useEffect(() => { if (!vId) { setVitemIds([]); return; } supabase.from('vendor_items').select('item_id').eq('vendor_id', vId).then(({ data }) => setVitemIds(((data as { item_id: number }[]) ?? []).map((x) => x.item_id))); }, [vId]);
  const orderedIds = po ? po.po_lines.map((l) => l.item_id) : [];
  const nameList = [...new Set([...orderedIds, ...vitemIds])].filter((i) => items[i]).slice(0, 150).map((i) => ({ id: i, name: items[i].name, unit: items[i].count_unit ? 'kg' : (rf(items[i]) ? items[i].show_as ?? items[i].unit : items[i].unit) }));
  function takeLine(id: number, l: BillLine) {
    const it = items[id]; if (!it) return;
    const f = rf(it); const count = !!it.count_unit;
    if (!count && l.qty != null && l.qty > 0) {
      const q = f ? String(l.qty) : cleanQty(`${l.qty}${(l.unit ?? '').toLowerCase().replace(/[^a-z]/g, '')}`, it.unit);
      if (q) setVals((p) => (p[id] ? p : { ...p, [id]: q }));
    }
    const r = rateFor(it, l, !!f && !count);
    if (r != null) setRates((p) => (p[id] ? p : { ...p, [id]: String(r) }));
    else setNeedRate((p) => (p.includes(id) ? p : [...p, id]));
  }
  const br = useBillRead(files, po ? vendors[po.vendor_id]?.name ?? '' : vendors[vendor]?.name ?? '', (r) => {
    if (r.bill_number) setBill((v) => v || r.bill_number!); if (r.total != null) setAmount((v) => v || String(r.total)); if (r.bill_date) setBillDate((v) => v || r.bill_date!);
    const off: BillLine[] = [], none: BillLine[] = [];
    for (const l of r.lines ?? []) {
      if (l.item_id == null || !items[l.item_id]) { none.push(l); continue; }
      if (po && !orderedIds.includes(l.item_id)) { off.push(l); continue; }
      if (!po) setExtra((p) => (p.includes(l.item_id!) ? p : [...p, l.item_id!]));
      takeLine(l.item_id, l);
    }
    setOffBill(off); setNoMatch(none);
  }, nameList);
  const { profile } = useSession();
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ids = po ? po.po_lines.map((l) => l.item_id).concat(extra.filter((e) => !po.po_lines.some((l) => l.item_id === e))) : extra;
  const neckItem = Object.values(items).find((i) => i.name === 'Chicken Neck');
  const hasCount = ids.some((i) => items[i]?.count_unit);
  const isCount = (id: number) => !!items[id]?.count_unit;
  const portionText = (id: number) => {
    const it = items[id]; const kg = Number(vals[id]) || 0; const c = Number(cnt[id]) || 0;
    if (!it || !(kg > 0) || !(c > 0)) return null;
    const ppp = Number(it.pcs_per_portion) || 1; const total = c + (pcsOn[id] ?? 0);
    const per = costKg[id] ? Math.round((costKg[id] * kg / c) * ppp * 100) / 100 : null;
    if (it.count_unit === 'bird') return `${c} ${c === 1 ? 'bird' : 'birds'} · avg ${Math.round((kg / c) * 1000)} g each${per != null ? ` · ₹${Math.round(per)} per bird` : ''}`;
    const whole = Math.floor(total / ppp); const loose = Math.round(total - whole * ppp);
    return `In store after: ${whole} portions${loose ? ` + ${loose} loose pcs` : ''} · ${Math.round((kg / c) * 1000)} g per piece${per != null ? ` · ₹${Math.round(per)} per portion` : ''}`;
  };
  const matches = useMemo(() => find.trim().length < 2 ? [] : Object.values(items).filter((i) => i.name.toLowerCase().includes(find.toLowerCase()) && !ids.includes(i.id) && i.name !== 'Chicken Neck').slice(0, 6), [find, items, ids]);

  const rateOf = (id: number) => { const n = parseFloat(rates[id] ?? ''); return n > 0 ? n : 0; };
  const prevOf = (id: number) => { const it = items[id]; if (!it || it.last_cost == null) return null; return Number(it.last_cost) * (rf(it) && !it.count_unit ? rf(it) : 1); };
  const qtyOf = (id: number) => { const n = Number(vals[id]); return n > 0 ? n : 0; };
  const billed = ids.filter((id) => qtyOf(id) > 0 && rateOf(id) > 0);
  const calc = billed.reduce((a, id) => a + qtyOf(id) * rateOf(id), 0);
  const noRate = ids.filter((id) => qtyOf(id) > 0 && !(rateOf(id) > 0));
  const totalNum = Number(amount) || 0;

  async function save() {
    setErr('');
    for (const id of needRate) if (ids.includes(id) && qtyOf(id) > 0 && !(rateOf(id) > 0)) return setErr(`Type the rate for ${items[id]?.name} from the bill.`);
    for (const id of ids) { const v = vals[id]; if (v && !(Number(v) >= 0) && items[id]) { const c = cleanQty(v, items[id].unit); if (c === null) return setErr(`${items[id].name}: type just the number, like 1.5`); vals[id] = c; } }
    for (const id of ids) {
      if (!isCount(id)) continue;
      const kg = Number(vals[id]) > 0, c = Number(cnt[id]) > 0;
      if ((kg || c) && !(kg && c)) return setErr(`${items[id].name}: enter both the weight and the ${items[id].count_unit === 'bird' ? 'birds' : 'piece'} count.`);
    }
    const anyCount = ids.some((id) => isCount(id) && Number(vals[id]) > 0);
    if (anyCount && neckItem && neck.trim() === '') return setErr('Enter the neck weight. Type 0 if no neck came.');
    const lines: { item_id: number; qty: number; pieces?: number }[] = Object.entries(vals).filter(([, v]) => Number(v) > 0).map(([id, v]) => isCount(Number(id))
      ? { item_id: Number(id), qty: round3(Number(v)), pieces: Number(cnt[Number(id)]) }
      : { item_id: Number(id), qty: round3(Number(v) * (rf(items[Number(id)] ?? ({} as Item)) || 1)) });
    if (anyCount && neckItem && Number(neck) > 0) lines.push({ item_id: neckItem.id, qty: round3(Number(neck)) });
    if (!lines.length) return setErr('Enter what arrived for at least one item.');
    if (!po && !vendor) return setErr('Choose the vendor.');
    if (!files.length && !later) return setErr('Add a photo of the bill, or choose Bill will come later.');
    setBusy(true);
    let paths: string[] = [];
    try { paths = await uploadBills(profile?.id ?? 'x', files); } catch (e) { setBusy(false); return setErr(errText(e)); }
    const { data: rg, error } = await supabase.rpc('receive_goods', { p_po_id: po?.id ?? null, p_vendor_id: po ? null : vendor, p_bill_number: bill, p_bill_date: billDate || null, p_bill_amount: amount ? Number(amount) : null, p_note: note, p_lines: lines, p_bill_paths: paths, p_bill_later: later && !paths.length });
    if (error) { setBusy(false); return setErr(errText(error)); }
    // The rate on the bill (or typed here) becomes the current price. The old price stays in the price history.
    let priceFail = 0;
    const ref = (rg as { grn_number?: string } | null)?.grn_number ?? null;
    for (const id of ids) {
      const r = rateOf(id), it = items[id]; if (!(r > 0) || !it || !(qtyOf(id) > 0)) continue;
      const pk = rf(it) && !it.count_unit ? rf(it) : 1;
      const { error: pe } = await supabase.rpc('set_item_price', { p_item: id, p_price: r, p_label: pk > 1 ? (it.show_as ?? it.unit) : it.unit, p_qty: pk, p_vendor: po ? po.vendor_id : vendor, p_date: billDate || null, p_source: 'bill', p_ref: ref });
      if (pe) priceFail++;
    }
    setBusy(false);
    toast(priceFail ? 'Goods received. Stock updated. Some prices could not be saved.' : 'Goods received. Stock and prices updated.'); onDone();
  }

  const rateInput = (id: number) => {
    const it = items[id]; if (!it) return null;
    const per = rf(it) && !it.count_unit ? it.show_as ?? it.unit : it.count_unit ? 'kg' : it.unit;
    const need = needRate.includes(id) && qtyOf(id) > 0 && !(rateOf(id) > 0);
    return <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
      <input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 86, borderColor: need ? 'var(--bad, #B02A1E)' : undefined }} aria-label={`Rate for ${it.name}`} placeholder={`per ${per}`} value={rates[id] ?? ''} onChange={(e) => setRates((p) => ({ ...p, [id]: e.target.value.replace(/[^0-9.]/g, '') }))} />
      {need && <span className="small" style={{ color: 'var(--bad, #B02A1E)' }}>Could not read the rate. Please type it.</span>}
      <PriceMark prev={prevOf(id)} now={rateOf(id)} />
    </div>;
  };

  return (
    <Sheet title={po ? `Receive ${vendors[po.vendor_id]?.name ?? ''} · ${po.po_number}` : 'Received without an order'} onClose={onClose}
      footer={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save and add to stock'}</button>}>
      {!po && <label className="field"><span>Vendor</span><select value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">Choose…</option>{Object.values(vendors).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
      <div className="tablewrap"><table>
        <thead><tr><th>Item</th>{po && <th className="r">Ordered</th>}<th className="r" style={{ width: 130 }}>Arrived now</th><th className="r" style={{ width: 150 }}>Rate ₹</th></tr></thead>
        <tbody>{ids.map((id) => { const it = items[id]; if (!it) return null; const line = po?.po_lines.find((l) => l.item_id === id); const already = po && line ? got(po, id) : 0; const f = rf(it); const d = (n: number) => (f ? `${Math.round((n / f) * 10) / 10} ${it.show_as}` : fmtQty(n, it.unit));
          if (isCount(id)) { const bird = it.count_unit === 'bird'; const pt = portionText(id); const ordBirds = bird && line && it.purchase_factor ? Math.round((Number(line.qty) / Number(it.purchase_factor)) * 10) / 10 : null; return (
            <tr key={id}><td><b>{it.name}</b> <span className="muted small">weight and {bird ? 'birds' : 'count'}</span>{pt && <div className="small" style={{ color: 'var(--brand)', marginTop: 3 }}>{pt}</div>}</td>
              {po && <td className="r num">{line ? <>{fmtQty(Number(line.qty), 'kg')}{ordBirds != null && <div className="small muted">{ordBirds} birds</div>}{already > 0 && <div className="small muted">got {fmtQty(already, 'kg')}</div>}</> : <span className="muted small">extra</span>}</td>}
              <td className="r"><div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 74, borderColor: Number(cnt[id]) > 0 && !(Number(vals[id]) > 0) ? 'var(--bad)' : undefined }} aria-label={`${it.name} weight in kg`} placeholder="kg" value={vals[id] ?? ''}  onChange={(e) => setVals((p) => ({ ...p, [id]: e.target.value }))} onBlur={(e) => { const c = cleanQty(e.target.value, 'kg'); if (c !== null && c !== e.target.value) setVals((p) => ({ ...p, [id]: c })); }} /><span className="muted small" style={{ width: 38, textAlign: 'left' }}>kg</span></span>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input inputMode="numeric" className="num" style={{ textAlign: 'right', width: 74, borderColor: Number(vals[id]) > 0 && !(Number(cnt[id]) > 0) ? 'var(--bad)' : undefined }} aria-label={`${it.name} ${bird ? 'birds' : 'pieces'}`} placeholder={bird ? 'birds' : 'pcs'} value={cnt[id] ?? ''} onChange={(e) => setCnt((p) => ({ ...p, [id]: e.target.value.replace(/[^0-9]/g, '') }))} /><span className="muted small" style={{ width: 38, textAlign: 'left' }}>{bird ? 'birds' : 'pcs'}</span></span>
              </div></td><td className="r">{rateInput(id)}</td></tr>); }
          return <tr key={id}><td><b>{it.name}</b> <span className="muted small">{f ? it.show_as : it.unit}</span></td>
            {po && <td className="r num">{line ? <>{d(Number(line.qty))}{already > 0 && <div className="small muted">got {d(already)}</div>}</> : <span className="muted small">extra</span>}</td>}
            <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110 }} aria-label={`Arrived ${it.name}`} placeholder={f ? it.show_as ?? '' : it.unit} value={vals[id] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [id]: e.target.value }))} onBlur={(e) => { const c = cleanQty(e.target.value, f ? '' : it.unit); if (c !== null && c !== e.target.value) setVals((p) => ({ ...p, [id]: c })); }} /></td><td className="r">{rateInput(id)}</td></tr>; })}
          {hasCount && neckItem && (
            <tr style={{ background: 'var(--warn-soft, #FBF0D5)' }}><td><b>Chicken neck</b> <span className="muted small">kg only. Not on the order. Type 0 if none came.</span></td>{po && <td className="r muted small">extra</td>}
              <td className="r"><input inputMode="decimal" className="num" style={{ textAlign: 'right', width: 110, borderColor: neck.trim() === '' ? 'var(--bad)' : undefined }} aria-label="Chicken neck weight in kg" placeholder="kg" value={neck} onChange={(e) => setNeck(e.target.value)} /></td><td /></tr>)}</tbody>
      </table></div>
      {offBill.length > 0 && (
        <div className="banner warn" style={{ display: 'grid', gap: 6 }}>
          <b>On the bill, but not on the order</b>
          {offBill.map((l, i) => (
            <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{items[l.item_id!]?.name} <span className="muted small">{l.qty != null ? `${l.qty} ${l.unit ?? ''}` : ''}{l.rate != null ? ` at ₹${l.rate}` : ''}</span></span>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => { setExtra((p) => (p.includes(l.item_id!) ? p : [...p, l.item_id!])); takeLine(l.item_id!, l); setOffBill((p) => p.filter((x) => x !== l)); }}>Take it in</button>
                <button className="btn quiet" onClick={() => setOffBill((p) => p.filter((x) => x !== l))}>Leave it out</button></span>
            </div>))}
        </div>
      )}
      {noMatch.length > 0 && <p className="small muted">Not matched to an item: {noMatch.map((l) => `${l.name}${l.qty != null ? ` ${l.qty}${l.unit ? ' ' + l.unit : ''}` : ''}`).join(', ')}. Add them with the box below if they arrived.</p>}
      {billed.length > 0 && totalNum > 0 && (Math.abs(calc - totalNum) < 1
        ? <p className="banner ok">Lines add up to ₹{Math.round(calc).toLocaleString('en-IN')}. The bill total is ₹{Math.round(totalNum).toLocaleString('en-IN')}.</p>
        : <p className="banner warn">What arrived adds up to ₹{Math.round(calc).toLocaleString('en-IN')}. The bill says ₹{Math.round(totalNum).toLocaleString('en-IN')}.{calc < totalNum ? ` You may be paying ₹${Math.round(totalNum - calc).toLocaleString('en-IN')} for things that did not arrive or have no rate${noRate.length ? ` (no rate for ${noRate.length} ${noRate.length === 1 ? 'item' : 'items'})` : ''}. Ask the vendor for a credit note.` : ' Check the quantities and rates above.'}</p>)}
      <label className="field"><span>Add another item</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a few letters" /></label>
      {matches.length > 0 && <div className="row">{matches.map((m) => <button key={m.id} className="qchip" onClick={() => { setExtra((p) => [...p, m.id]); setFind(''); }}>{m.name}</button>)}</div>}
      <div className="field"><span>Bill</span>
        {!later && <BillPicker files={files} setFiles={setFiles} />}
        {(br.reading || br.note) && <p className="small muted" role="status">{br.reading ? 'Reading the bill…' : br.note}</p>}
        {files.length === 0 && <label className="row small" style={{ gap: 8, marginTop: 6 }}><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />Bill will come later. Remind us to add it.</label>}
      </div>
      <div className="row" style={{ gap: 12 }}>
        <label className="field" style={{ flex: 1 }}><span>Bill number (optional)</span><input value={bill} onChange={(e) => setBill(e.target.value)} /></label>
        <label className="field" style={{ flex: 1 }}><span>Bill amount (optional)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <label className="field"><span>Bill date (optional)</span><input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></label>
      <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <p className="banner bad" role="alert">{err}</p>}
    </Sheet>
  );
}

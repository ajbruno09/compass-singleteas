import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { dayLabel, timeOf } from '../lib/ist';
import { money, errText } from '../lib/format';
import { DatePicker } from '../components/DatePicker';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface ItemRow { id: number; name: string; unit: string; group_id: number | null; default_vendor_id: string | null; last_cost: number | null; rate_varies: boolean; purchase_factor: number | null }
interface VendorRow { id: string; name: string; order_channel: string; whatsapp_group: string; phone: string | null }
interface VItem { vendor_id: string; item_id: number; agreed_rate: number | null }
interface IndentRow { id: string; location_id: number; status: string; indent_lines: { item_id: number; qty: number }[] }
interface PoLine { item_id: number; qty: number; unit_rate: number | null }
interface PoRow {
  id: string; po_number: string; vendor_id: string; status: string; notes: string; sent_at: string | null; order_date: string;
  required_date: string | null; required_time: string | null; delivery: boolean; channel: string; for_date: string | null; po_lines: PoLine[];
}
type Kind = 'wa' | 'phone' | 'app' | 'bought';
const kindOf = (v: VendorRow): Kind => (v.order_channel === 'whatsapp_group' ? 'wa' : v.order_channel === 'phone' ? 'phone' : v.order_channel === 'app' ? 'app' : 'bought');

const STORE_ID = 1;
const BASE_NAMES = ['Kerala Market', 'Hyperpure', 'Sri Manjunatha Traders'];
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const ddmmyy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
const n2 = (n: number) => String(Math.round(n * 100) / 100);
const stepOf = (unit: string) => (unit === 'kg' || unit === 'L' ? 0.5 : 1);
const roundUp = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;
const SLOTS = (() => { const a: string[] = []; for (let m = 5 * 60; m <= 22 * 60; m += 30) { const h = Math.floor(m / 60); a.push(`${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`); } return a; })();
const lsGet = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

interface MsgLine { name: string; qty: number; unit: string }
function buildMessage(o: { vendor: string; poNo: string; lines: MsgLine[]; notes: string; orderDate: string; reqDate: string; reqTime: string; delivery: boolean }) {
  return `Purchase Order - ${o.vendor}\nPO No - ${o.poNo}\nGreetings from Single Teas,\n\n${o.lines.map((l, i) => `${i + 1}. ${l.name} ${n2(l.qty)} ${l.unit}`).join('\n')}` +
    (o.notes.trim() ? `\n\nNote: ${o.notes.trim()}` : '') +
    `\n\nOrder date - ${ddmmyy(o.orderDate)}\nRequired date - ${ddmmyy(o.reqDate)}\nRequired time - ${o.reqTime}\nDelivery : ${o.delivery ? 'Yes' : 'No'}`;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function printText(title: string, text: string) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><title>${esc(title)}</title><body style="font:15px/1.6 system-ui,sans-serif;padding:32px;white-space:pre-wrap">${esc(text)}</body>`);
  w.document.close(); w.focus(); w.print();
  return true;
}
async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

interface Row { item: ItemRow; asked: number; by: { loc: string; qty: number }[]; inStore: number; ordered: number; sug: number; qty: number; rate: number | null; step: number }

export function Buying() {
  const { locations } = useSession();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [target, setTarget] = useState('');
  const [indents, setIndents] = useState<IndentRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vitems, setVitems] = useState<VItem[]>([]);
  const [onHand, setOnHand] = useState<Record<number, number>>({});
  const [pos, setPos] = useState<PoRow[]>([]);
  const [edit, setEdit] = useState<Record<number, number>>({});
  const [openV, setOpenV] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ vendorId: string; poId?: string } | null>(null);
  const [otherFor, setOtherFor] = useState<number | null>(null);
  const [otherText, setOtherText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { supabase.rpc('indent_for_date').then(({ data }) => { const d = String(data); setDate(d); setTarget(d); }); }, []);

  const loadStatic = useCallback(async () => {
    const [it, vd, vi] = await Promise.all([
      supabase.from('items').select('id, name, unit, group_id, default_vendor_id, last_cost, rate_varies, purchase_factor').eq('active', true),
      supabase.from('vendors').select('id, name, order_channel, whatsapp_group, phone').eq('active', true).order('name'),
      supabase.from('vendor_items').select('vendor_id, item_id, agreed_rate')
    ]);
    setItems((it.data as ItemRow[]) ?? []); setVendors((vd.data as VendorRow[]) ?? []); setVitems((vi.data as VItem[]) ?? []);
  }, []);
  useEffect(() => { void loadStatic(); }, [loadStatic]);

  const load = useCallback(async () => {
    if (!date) return;
    const [ind, oh, po] = await Promise.all([
      supabase.from('indents').select('id, location_id, status, indent_lines(item_id, qty)').eq('for_date', date),
      supabase.from('stock_on_hand').select('item_id, qty').eq('location_id', STORE_ID),
      supabase.from('purchase_orders').select('id, po_number, vendor_id, status, notes, sent_at, order_date, required_date, required_time, delivery, channel, for_date, po_lines(item_id, qty, unit_rate)').eq('for_date', date).neq('status', 'cancelled').order('created_at')
    ]);
    setIndents((ind.data as IndentRow[]) ?? []);
    setOnHand(Object.fromEntries(((oh.data as { item_id: number; qty: number }[]) ?? []).map((r) => [r.item_id, Number(r.qty)])));
    setPos((po.data as PoRow[]) ?? []);
    setLoading(false);
  }, [date]);
  useEffect(() => {
    void load();
    const ch = supabase.channel('buying').on('postgres_changes', { event: '*', schema: 'public', table: 'indents' }, () => { void load(); }).subscribe();
    const poll = window.setInterval(() => { void load(); }, 20000);
    return () => { void supabase.removeChannel(ch); window.clearInterval(poll); };
  }, [load]);

  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const sentInd = indents.filter((r) => r.status === 'submitted' || r.status === 'locked');
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const rateMap = useMemo(() => new Map(vitems.filter((v) => v.agreed_rate != null).map((v) => [`${v.vendor_id}:${v.item_id}`, Number(v.agreed_rate)])), [vitems]);

  const orderedBy = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pos) for (const l of p.po_lines) m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.qty));
    return m;
  }, [pos]);

  const rows: Row[] = useMemo(() => {
    const agg = new Map<number, { asked: number; by: Map<string, number> }>();
    for (const r of sentInd) {
      const loc = locations.find((l) => l.id === r.location_id)?.name ?? '';
      for (const l of r.indent_lines) {
        const e = agg.get(l.item_id) ?? { asked: 0, by: new Map() };
        e.asked += Number(l.qty); e.by.set(loc, (e.by.get(loc) ?? 0) + Number(l.qty)); agg.set(l.item_id, e);
      }
    }
    const out: Row[] = [];
    for (const [id, e] of agg) {
      const item = itemMap.get(id); if (!item) continue;
      const inStore = Math.max(0, onHand[id] ?? 0);
      const ordered = orderedBy.get(id) ?? 0;
      const step = item.purchase_factor ? Number(item.purchase_factor) : stepOf(item.unit);
      const sug = roundUp(Math.max(0, e.asked - inStore - ordered), step);
      const qty = edit[id] ?? sug;
      const rate = (item.default_vendor_id && rateMap.get(`${item.default_vendor_id}:${id}`)) || (item.last_cost != null ? Number(item.last_cost) : null);
      out.push({ item, asked: e.asked, by: [...e.by.entries()].map(([loc, qty]) => ({ loc, qty })), inStore, ordered, sug, qty, rate, step });
    }
    return out.sort((a, b) => (a.item.group_id ?? 99) - (b.item.group_id ?? 99) || a.item.name.localeCompare(b.item.name));
  }, [sentInd, itemMap, onHand, orderedBy, edit, rateMap, locations]);

  const toBuy = rows.filter((r) => r.qty > 0);
  const loose = toBuy.filter((r) => !r.item.default_vendor_id);
  const byVendor = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of toBuy) if (r.item.default_vendor_id) m.set(r.item.default_vendor_id, [...(m.get(r.item.default_vendor_id) ?? []), r]);
    return m;
  }, [toBuy]);
  const vendorIds = useMemo(() => {
    const ids = new Set<string>([...byVendor.keys(), ...pos.map((p) => p.vendor_id)]);
    return [...ids].filter((id) => vendorMap.has(id)).sort((a, b) => vendorMap.get(a)!.name.localeCompare(vendorMap.get(b)!.name));
  }, [byVendor, pos, vendorMap]);

  const estimate = (list: Row[]) => list.reduce((t, r) => t + (r.rate != null ? r.qty * r.rate : 0), 0);
  const grand = vendorIds.reduce((t, id) => t + estimate(byVendor.get(id) ?? []), 0);
  const itemCount = toBuy.length;
  const ordersSent = pos.length;

  async function usual(itemId: number, vendorId: string, label: string) {
    const { error } = await supabase.rpc('set_usual_vendor', { p_item_id: itemId, p_vendor_id: vendorId });
    if (error) return toast(errText(error));
    toast(`${itemMap.get(itemId)?.name} will be bought from ${label} from now on`);
    await loadStatic(); setOtherFor(null); setOtherText('');
  }
  async function addOther(itemId: number) {
    const name = otherText.trim(); if (!name) return;
    const { data, error } = await supabase.rpc('add_shop', { p_name: name });
    if (error) return toast(errText(error));
    await usual(itemId, String(data), name);
  }

  const baseVendors = BASE_NAMES.map((n) => vendors.find((v) => v.name === n)).filter(Boolean) as VendorRow[];
  const shops = vendors.filter((v) => (v.order_channel === 'walk_in' || v.order_channel === 'app') && !BASE_NAMES.includes(v.name));

  const dv = dlg ? vendorMap.get(dlg.vendorId) : undefined;
  const dpo = dlg?.poId ? pos.find((p) => p.id === dlg.poId) : undefined;

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Store view</p><h1>What to buy for {date ? dayLabel(date) : '…'}</h1>
          <p className="muted small" style={{ marginTop: 2 }}>Built from what the counters asked for, less what is already in the store.</p></div>
        <div className="row"><DatePicker value={date} onChange={setDate} tomorrow={target} label="Buying date" /></div>
      </div>

      <div className="kpis">
        <div className="card kp"><div className="label">Counters sent</div><div className="num kpn">{sentInd.length} of {counters.length}</div></div>
        <div className="card kp"><div className="label">Items to buy</div><div className="num kpn">{itemCount}</div></div>
        <div className="card kp"><div className="label">Estimated value</div><div className="num kpn">{money(grand)}</div><div className="muted small">at last available rates, to plan cash</div></div>
        <div className="card kp"><div className="label">Orders sent</div><div className="num kpn">{ordersSent}</div></div>
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          {loose.length > 0 && (
            <div className="banner warn buy-loose">
              <div><b>{loose.length} {loose.length === 1 ? 'item has' : 'items have'} no usual vendor yet.</b> Pick where each comes from. Compass remembers it for next time.</div>
              {loose.map((r) => (
                <div key={r.item.id} className="loose-row">
                  <div className="loose-name"><b>{r.item.name}</b> <span className="num">{n2(r.qty)} {r.item.unit}</span></div>
                  <div className="row" style={{ gap: 6 }}>
                    {baseVendors.map((v) => <button key={v.id} className="chip due pickchip" onClick={() => usual(r.item.id, v.id, v.name)}>{v.name}</button>)}
                    {shops.slice(0, 8).map((v) => <button key={v.id} className="chip done pickchip" onClick={() => usual(r.item.id, v.id, v.name)}>{v.name}</button>)}
                    <button className="chip off pickchip" onClick={() => { setOtherFor(otherFor === r.item.id ? null : r.item.id); setOtherText(''); }}>Other…</button>
                  </div>
                  {otherFor === r.item.id && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <input list="knownv" placeholder="Shop or vendor name" value={otherText} onChange={(e) => setOtherText(e.target.value)} style={{ maxWidth: 260 }} />
                      <datalist id="knownv">{vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist>
                      <button className="btn primary" onClick={() => addOther(r.item.id)}>Add</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {vendorIds.length === 0 && loose.length === 0 && <p className="empty card">Nothing to buy yet. Orders appear here as counters send their indents.</p>}

          <div className="stack">
            {vendorIds.map((vid) => {
              const v = vendorMap.get(vid)!; const kind = kindOf(v);
              const list = byVendor.get(vid) ?? [];
              const vpos = pos.filter((p) => p.vendor_id === vid);
              const open = openV === vid;
              const allDone = list.length === 0;
              const chip = allDone ? <span className="chip done">{kind === 'bought' ? 'Bought' : 'Sent'}</span> : vpos.length ? <span className="chip late">New items to order</span> : <span className="chip late">{kind === 'bought' ? 'To buy' : 'Not sent'}</span>;
              const channel = kind === 'wa' ? `WhatsApp group: ${v.whatsapp_group}` : kind === 'phone' ? `Phone call${v.phone ? ': ' + v.phone : ''}` : kind === 'app' ? `Order in the ${v.name} app` : 'Bought by the store, not ordered';
              return (
                <div key={vid} className="card" style={{ padding: 0 }}>
                  <button className="vhead" onClick={() => setOpenV(open ? null : vid)} aria-expanded={open}>
                    <span style={{ transform: open ? 'none' : 'rotate(-90deg)', display: 'inline-flex', transition: 'transform .12s' }}><Icon name="chev" /></span>
                    <span style={{ flex: 1, textAlign: 'left' }}><b>{v.name}</b><span className="muted small" style={{ display: 'block' }}>{channel}</span></span>
                    <span className="muted small">{list.length} {list.length === 1 ? 'item' : 'items'}</span>
                    <span className="num" style={{ minWidth: 80, textAlign: 'right' }}>{money(estimate(list))}</span>
                    {chip}
                  </button>
                  {open && (
                    <div style={{ padding: '0 0 14px' }}>
                      {list.length > 0 && (
                        <div className="tablewrap" style={{ border: 0, borderRadius: 0, boxShadow: 'none' }}>
                          <table>
                            <thead><tr><th>Item</th><th>Asked by counters</th><th className="r">Asked</th><th className="r">In store</th><th className="r">Suggested</th><th>Order</th><th className="r">Estimate</th></tr></thead>
                            <tbody>{list.map((r) => (
                              <tr key={r.item.id}>
                                <td><b>{r.item.name}</b>{r.item.rate_varies && <span className="chip late ratetag">Rate varies</span>}{r.ordered > 0 && <div className="muted small">{n2(r.ordered)} {r.item.unit} already ordered</div>}</td>
                                <td className="small">{r.by.map((b) => `${b.loc} ${n2(b.qty)}`).join(' · ')}</td>
                                <td className="r num">{n2(r.asked)}</td>
                                <td className="r num muted">{n2(r.inStore)} {r.item.unit}</td>
                                <td className="r num muted">{n2(r.sug)} {r.item.unit}</td>
                                <td><div className="stepper">
                                  <button aria-label="Less" onClick={() => setEdit((p) => ({ ...p, [r.item.id]: Math.max(0, r.qty - r.step) }))}>−</button>
                                  <span className="num">{n2(r.qty)} {r.item.unit}</span>
                                  <button aria-label="More" onClick={() => setEdit((p) => ({ ...p, [r.item.id]: r.qty + r.step }))}>+</button>
                                </div></td>
                                <td className="r num">{r.rate != null ? money(r.qty * r.rate) : '—'}</td>
                              </tr>))}</tbody>
                          </table>
                        </div>
                      )}
                      {vpos.length > 0 && (
                        <div className="row" style={{ padding: '10px 16px 0', gap: 8 }}>
                          <span className="muted small">Placed:</span>
                          {vpos.map((p) => <button key={p.id} className="chip done pickchip" onClick={() => setDlg({ vendorId: vid, poId: p.id })}>{p.po_number} · {timeOf(p.sent_at)}</button>)}
                        </div>
                      )}
                      <div className="row" style={{ padding: '10px 16px 0', justifyContent: 'space-between' }}>
                        <span className="muted small">Change any quantity, then review. Values are estimates to plan cash, at the last rate available until the exact rate is entered. The order message never carries a price. Nothing is sent until you tap the button.</span>
                        {list.length > 0 && <button className="btn primary" onClick={() => setDlg({ vendorId: vid })}>{kind === 'bought' ? 'Open shopping list' : 'Review order'}</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {dlg && dv && (
        <OrderSheet
          key={dlg.poId ?? dlg.vendorId}
          vendor={dv} kind={kindOf(dv)} po={dpo} rows={byVendor.get(dv.id) ?? []} itemMap={itemMap} forDate={date}
          onClose={() => setDlg(null)}
          onDone={async (keep) => { setEdit({}); await load(); if (!keep) setDlg(null); }}
        />
      )}
    </>
  );
}

function OrderSheet({ vendor, kind, po, rows, itemMap, forDate, onClose, onDone }: {
  vendor: VendorRow; kind: Kind; po?: PoRow; rows: Row[]; itemMap: Map<number, ItemRow>; forDate: string; onClose: () => void; onDone: (keepOpen: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const today = istToday();
  const timeKey = `compass-po-time-${vendor.id}`;
  const [reqDate, setReqDate] = useState(forDate < today ? today : forDate);
  const [reqTime, setReqTime] = useState(lsGet(timeKey));
  const [delivery, setDelivery] = useState(true);
  const [notes, setNotes] = useState('');
  const [pickTime, setPickTime] = useState(false);
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ poNo: string; text: string } | null>(null);
  const isMsg = kind === 'wa' || kind === 'phone';

  // Viewing a PO that was already placed.
  const viewText = po ? buildMessage({
    vendor: vendor.name, poNo: po.po_number, notes: po.notes, orderDate: po.order_date, reqDate: po.required_date ?? po.for_date ?? today, reqTime: po.required_time ?? '', delivery: po.delivery,
    lines: po.po_lines.map((l) => ({ name: itemMap.get(l.item_id)?.name ?? '', qty: Number(l.qty), unit: itemMap.get(l.item_id)?.unit ?? '' }))
  }) : '';
  const viewList = po ? po.po_lines.map((l) => `${itemMap.get(l.item_id)?.name ?? ''}  ${n2(Number(l.qty))} ${itemMap.get(l.item_id)?.unit ?? ''}`).join('\n') : '';

  const previewLines = rows.map((r) => ({ name: r.item.name, qty: r.qty, unit: r.item.unit }));
  const preview = buildMessage({ vendor: vendor.name, poNo: 'ST-PO-xxxx (added when you copy)', notes, orderDate: today, reqDate, reqTime: reqTime || 'Pick a time', delivery, lines: previewLines });
  const needTime = isMsg && !reqTime;

  const action = kind === 'wa' ? 'Copy to WhatsApp Group' : kind === 'phone' ? 'Mark as ordered by phone' : kind === 'app' ? `Mark as ordered in ${vendor.name}` : 'Mark as bought';

  async function place() {
    setBusy(true);
    const lines = rows.map((r) => ({ item_id: r.item.id, qty: r.qty, unit_rate: r.rate ?? '', asked: r.asked, in_store: r.inStore }));
    const { data, error } = await supabase.rpc('create_po', {
      p_vendor_id: vendor.id, p_for_date: forDate, p_required_date: isMsg ? reqDate : forDate, p_required_time: isMsg ? reqTime : null,
      p_delivery: delivery, p_notes: notes, p_channel: vendor.order_channel, p_lines: lines
    });
    setBusy(false);
    if (error) return toast(errText(error));
    const poNo = String((data as { po_number: string }).po_number);
    if (isMsg) {
      lsSet(timeKey, reqTime);
      const text = buildMessage({ vendor: vendor.name, poNo, notes, orderDate: today, reqDate, reqTime, delivery, lines: previewLines });
      const ok = kind === 'wa' ? await copyText(text) : false;
      setSaved({ poNo, text });
      toast(kind === 'wa' ? (ok ? `${poNo} copied. Open the WhatsApp group, paste and send.` : `${poNo} saved. Copy the text below.`) : `${poNo} marked as ordered`);
      await onDone(true);
    } else {
      toast(`${poNo} saved`);
      await onDone(false);
    }
  }

  const title = po ? `Order ${po.po_number}: ${vendor.name}` : saved ? `${saved.poNo}: ${vendor.name}` : `${kind === 'bought' ? 'Shopping list' : 'Purchase Order'}: ${vendor.name}`;
  const shown = saved ? saved.text : po ? (isMsg ? viewText : viewList) : '';

  return (
    <Sheet title={title} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Close</button>
        {(po || saved) ? (
          <>
            <button className="btn" onClick={() => { if (!printText(title, shown)) toast('Allow pop-ups to print'); }}>Print</button>
            {isMsg && kind === 'wa' && <button className="btn primary" onClick={async () => toast((await copyText(shown)) ? 'Copied' : 'Could not copy. Select the text and copy it.')}>Copy again</button>}
          </>
        ) : (
          <>
            <button className="btn" onClick={() => { if (!printText(title, isMsg ? preview : rows.map((r) => `${r.item.name}  ${n2(r.qty)} ${r.item.unit}`).join('\n'))) toast('Allow pop-ups to print'); }}>Print</button>
            <button className="btn primary" disabled={busy || needTime || rows.length === 0} onClick={place}>{busy ? 'Saving…' : action}</button>
          </>
        )}
      </>}>
      {!po && !saved && isMsg && (
        <>
          <p className="muted small">Order date is today ({ddmmyy(today)}). Choose when you need it.</p>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="field"><span>Required date</span><DatePicker value={reqDate} onChange={setReqDate} tomorrow={forDate >= today ? forDate : undefined} tomorrowLabel="Indent day" min={today} label="Required date" /></div>
            <div className="field" style={{ position: 'relative' }}><span>Required time</span>
              <button type="button" className="btn" onClick={() => setPickTime((o) => !o)}><Icon name="clock" /><span className="num">{reqTime || 'Pick a time'}</span><Icon name="chev" /></button>
              {pickTime && (
                <div className="dp-pop timepop" role="dialog" aria-label="Choose a time">
                  {SLOTS.map((s) => <button key={s} type="button" className={'slot' + (s === reqTime ? ' on' : '')} onClick={() => { setReqTime(s); setPickTime(false); }}>{s}</button>)}
                </div>
              )}
            </div>
            <div className="field"><span>Delivery</span>
              <div className="seg"><button aria-pressed={delivery} onClick={() => setDelivery(true)}>Yes</button><button aria-pressed={!delivery} onClick={() => setDelivery(false)}>No</button></div>
            </div>
          </div>
          {needTime && <p className="banner warn">Pick the required time to continue. Compass remembers it for {vendor.name}.</p>}
          <label className="field"><span>Notes for the vendor (optional)</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything extra to add to this order" /></label>
          <div className="field"><span>Message preview</span><pre className="wa">{preview}</pre></div>
        </>
      )}
      {!po && !saved && !isMsg && (
        <>
          <p className="muted small">{kind === 'app' ? `${vendor.name} takes orders only in its own app. Type these in one by one and tick each when done.` : 'Tick each item as you pick it up.'}</p>
          <div className="stack" style={{ gap: 6 }}>
            {rows.map((r) => {
              const on = !!ticks[r.item.id];
              return (
                <button key={r.item.id} className="tickrow" onClick={() => setTicks((p) => ({ ...p, [r.item.id]: !on }))}>
                  <span className={'bx' + (on ? ' on' : '')}>{on && <Icon name="check" />}</span>
                  <span style={{ flex: 1, textAlign: 'left', textDecoration: on ? 'line-through' : 'none', color: on ? 'var(--ink-3)' : 'inherit' }}>{r.item.name}</span>
                  <b className="num">{n2(r.qty)} {r.item.unit}</b>
                </button>
              );
            })}
          </div>
        </>
      )}
      {(po || saved) && (
        <>
          {saved && <p className="banner ok">{kind === 'wa' ? 'Copied. Open the WhatsApp group, paste and send.' : 'Saved.'}</p>}
          <pre className="wa">{shown}</pre>
        </>
      )}
    </Sheet>
  );
}

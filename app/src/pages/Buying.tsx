import { PoCancelBox, PoCancelInbox } from '../components/PoCancel';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { dayLabel, timeOf } from '../lib/ist';
import { money, errText } from '../lib/format';
import { DatePicker } from '../components/DatePicker';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface ItemRow { id: number; name: string; unit: string; group_id: number | null; default_vendor_id: string | null; last_cost: number | null; rate_varies: boolean; purchase_factor: number | null; purchase_unit: string | null }
interface VendorRow { id: string; name: string; order_channel: string; whatsapp_group: string; phone: string | null; is_store?: boolean }
interface VItem { vendor_id: string; item_id: number; agreed_rate: number | null }
interface IndentRow { id: string; location_id: number; status: string; indent_lines: { item_id: number; qty: number }[] }
interface PoLine { item_id: number; qty: number; unit_rate: number | null }
interface PoRow {
  id: string; po_number: string; vendor_id: string; status: string; notes: string; sent_at: string | null; order_date: string;
  required_date: string | null; required_time: string | null; delivery: boolean; channel: string; for_date: string | null; po_lines: PoLine[]; party?: boolean;
}
interface PS { item_id: number; vendor_id: string | null; approved_asked: number; buy_qty: number; ordered_qty: number }
type Kind = 'wa' | 'phone' | 'app' | 'bought' | 'store';
const kindOf = (v: VendorRow): Kind => (v.is_store ? 'store' : v.order_channel === 'whatsapp_group' ? 'wa' : v.order_channel === 'phone' ? 'phone' : v.order_channel === 'app' ? 'app' : 'bought');

const STORE_ID = 1;
const BASE_NAMES = ['Kerala Market', 'Hyperpure', 'Sri Manjunatha Traders'];
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const ddmmyy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
const n2 = (n: number) => String(Math.round(n * 100) / 100);
const stepOf = (unit: string) => (unit === 'kg' || unit === 'L' ? 0.5 : 1);
// Quantities are kept in the counted unit (pcs). Vendors sell in packs (trays), so show and send packs.
type PackItem = { unit: string; purchase_factor: number | null; purchase_unit: string | null };
const packed = (i: PackItem, qty: number) => (i.purchase_factor && (Number(i.purchase_factor) > 1 || i.purchase_unit === 'bird') && i.purchase_unit && i.purchase_unit !== i.unit ? { qty: qty / Number(i.purchase_factor), unit: i.purchase_unit } : { qty, unit: i.unit });
const packText = (i: PackItem, qty: number) => { const p = packed(i, qty); return p.unit === i.unit ? `${n2(qty)} ${i.unit}` : `${n2(p.qty)} ${p.unit}${Math.abs(p.qty - 1) < 1e-9 ? '' : 's'} (${n2(qty)} ${i.unit})`; };
const packLine = (i: PackItem, qty: number) => { const p = packed(i, qty); return { qty: p.qty, unit: p.unit + (p.unit !== i.unit && Math.abs(p.qty - 1) >= 1e-9 ? 's' : '') }; };
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

interface Hold { status: string; drop_pending: boolean; id: string; item_id: number; qty: number; from_date: string; due_date: string; reason: string; counters: string | null; push_count: number }
interface Drop { id: string; item_id: number; item_name: string; unit: string; for_date: string; qty: number; reason: string; note: string | null; status: string; owner_question: string | null; store_reply: string | null; requested_at: string; decided_at: string | null; requested_by_name: string | null; kind?: string }
const DROP_WHY = ['Same item asked again, they only need the new quantity', 'Counter got it another way', 'No longer needed', 'Other'];
interface Approval { for_date: string; over_amount: number; status: string }
const REASONS = ['Over the daily limit', 'Cash is tight', 'Vendor closed', 'Not available today', 'Other'];
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
interface Row { near?: number; carried: number; carriedAge: number; carriedWhy: string; item: ItemRow; asked: number; by: { loc: string; qty: number }[]; inStore: number; ordered: number; sug: number; qty: number; rate: number | null; step: number }

export function Buying() {
  const { locations, profile } = useSession();
  const isOwner = profile?.role === 'owner';
  const canDecide = profile?.role === 'owner' || profile?.role === 'manager';
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
  const [dlg, setDlg] = useState<{ vendorId: string; poId?: string; party?: boolean } | null>(null);
  const [partyLoc, setPartyLoc] = useState<number | null>(null);
  const [partyLabel, setPartyLabel] = useState('');
  const [ps, setPs] = useState<PS[]>([]);
  const [pdraft, setPdraft] = useState<Record<number, { vendor?: string; qty?: number }>>({});
  const [pbusy, setPbusy] = useState(false);
  const [moved, setMoved] = useState<Record<number, string>>({});
  const [moveFor, setMoveFor] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [movePos, setMovePos] = useState({ x: 0, y: 0 });
  const [otherFor, setOtherFor] = useState<number | null>(null);
  const [otherText, setOtherText] = useState('');
  const [loading, setLoading] = useState(true);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [limit, setLimit] = useState(0);
  const [placed, setPlaced] = useState(0);
  const [appr, setAppr] = useState<Approval | null>(null);
  const [pushFor, setPushFor] = useState<number | null>(null);
  const [pushQty, setPushQty] = useState('');
  const [pushWhy, setPushWhy] = useState('');
  const [pushPos, setPushPos] = useState({ x: 0, y: 0 });
  const [drops, setDrops] = useState<Drop[]>([]);
  const [keeps, setKeeps] = useState<number[]>([]);
  const [dropFor, setDropFor] = useState<number | null>(null);
  const [dropWhy, setDropWhy] = useState('');
  const [dropNote, setDropNote] = useState('');
  const [talk, setTalk] = useState<Record<string, string>>({});
  const [askOpen, setAskOpen] = useState<string | null>(null);
  const [shortFor, setShortFor] = useState<number | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [limEdit, setLimEdit] = useState<string | null>(null);

  useEffect(() => { supabase.rpc('indent_for_date').then(({ data }) => { const d = String(data); setDate(d); setTarget(d); }); }, []);

  const loadStatic = useCallback(async () => {
    const [it, vd, vi] = await Promise.all([
      supabase.from('items').select('id, name, unit, group_id, default_vendor_id, last_cost, rate_varies, purchase_factor, purchase_unit').eq('active', true),
      supabase.from('vendors').select('id, name, order_channel, whatsapp_group, phone, is_store').eq('active', true).order('name'),
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
      supabase.from('purchase_orders').select('id, po_number, vendor_id, status, notes, sent_at, order_date, required_date, required_time, delivery, channel, for_date, party, po_lines(item_id, qty, unit_rate)').eq('for_date', date).neq('status', 'cancelled').order('created_at')
    ]);
    const dl = await supabase.rpc('buy_drop_list', { p_date: date });
    const dj = (dl.data as { drops?: Drop[]; keeps?: number[] } | null) ?? {};
    setDrops((dj.drops ?? []).map((d) => ({ ...d, qty: Number(d.qty) }))); setKeeps(dj.keeps ?? []);
    const [hd, lm, pt, ap] = await Promise.all([
      supabase.from('buy_holds').select('id, item_id, qty, from_date, due_date, reason, counters, push_count, status, drop_pending').or(`status.eq.open,and(status.eq.dropped,from_date.eq.${date})`),
      supabase.rpc('buy_limit'), supabase.rpc('buy_placed_total', { p_date: date }),
      supabase.from('buy_approvals').select('for_date, over_amount, status').eq('for_date', date).maybeSingle()
    ]);
    setHolds(((hd.data as Hold[]) ?? []).map((h) => ({ ...h, qty: Number(h.qty) })));
    setLimit(Number(lm.data ?? 0)); setPlaced(Number(pt.data ?? 0)); setAppr((ap.data as Approval | null) ?? null);
    const [pl, pst, psr] = await Promise.all([supabase.rpc('party_loc'), supabase.rpc('party_status'), supabase.from('party_sourcing').select('item_id, vendor_id, approved_asked, buy_qty, ordered_qty').eq('for_date', date)]);
    setPartyLoc(pl.data == null ? null : Number(pl.data)); setPartyLabel(String((pst.data as { label?: string } | null)?.label ?? '')); setPs((psr.data as PS[]) ?? []);
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
  const sentAll = indents.filter((r) => r.status === 'submitted' || r.status === 'locked');
  const sentInd = sentAll.filter((r) => r.location_id !== partyLoc);
  const partyInd = sentAll.filter((r) => r.location_id === partyLoc);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const rateMap = useMemo(() => new Map(vitems.filter((v) => v.agreed_rate != null).map((v) => [`${v.vendor_id}:${v.item_id}`, Number(v.agreed_rate)])), [vitems]);

  const orderedBy = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pos) if (!p.party) for (const l of p.po_lines) m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.qty));
    return m;
  }, [pos]);

  const rows: Row[] = useMemo(() => {
    const agg = new Map<number, { asked: number; by: Map<string, number>; carried: number; age: number; why: string }>();
    const emptyE = () => ({ asked: 0, by: new Map<string, number>(), carried: 0, age: 0, why: '' });
    for (const r of sentInd) {
      const loc = locations.find((l) => l.id === r.location_id)?.name ?? '';
      for (const l of r.indent_lines) {
        const e = agg.get(l.item_id) ?? emptyE();
        e.asked += Number(l.qty); e.by.set(loc, (e.by.get(loc) ?? 0) + Number(l.qty)); agg.set(l.item_id, e);
      }
    }
    // Pushed asks: out of today's list while pushed, back in from their due date.
    for (const h of holds) {
      if (h.drop_pending) continue;
      if (h.status === 'open' && h.due_date <= date && h.from_date < date) {
        const e = agg.get(h.item_id) ?? emptyE();
        e.asked += h.qty; e.carried += h.qty; e.age = Math.max(e.age, daysBetween(h.from_date, date)); e.why = h.reason;
        e.by.set('Earlier orders', (e.by.get('Earlier orders') ?? 0) + h.qty); agg.set(h.item_id, e);
      } else if (h.from_date === date && (h.due_date > date || h.status === 'dropped')) {
        const e = agg.get(h.item_id); if (e) { e.asked -= h.qty; const k = [...e.by.keys()][0]; if (k) e.by.set(k, Math.max(0, (e.by.get(k) ?? 0) - h.qty)); }
      }
    }
    const out: Row[] = [];
    for (const [id, e] of agg) {
      const item = itemMap.get(id); if (!item) continue;
      const inStore = Math.max(0, onHand[id] ?? 0);
      const ordered = orderedBy.get(id) ?? 0;
      const step = item.purchase_factor ? Number(item.purchase_factor) : stepOf(item.unit);
      const gap = e.asked - inStore - ordered;
      const near = gap > 1e-9 && e.asked > 0 && gap <= 0.2 * e.asked + 1e-9;
      const sug = near ? 0 : roundUp(Math.max(0, gap), step);
      const qty = edit[id] ?? sug;
      const rate = (item.default_vendor_id && rateMap.get(`${item.default_vendor_id}:${id}`)) || (item.last_cost != null ? Number(item.last_cost) : null);
      if (e.asked <= 1e-9 && e.carried <= 1e-9) continue;
      out.push({ near: near ? gap : 0, carried: e.carried, carriedAge: e.age, carriedWhy: e.why, item, asked: e.asked, by: [...e.by.entries()].map(([loc, qty]) => ({ loc, qty })), inStore, ordered, sug, qty, rate, step });
    }
    return out.sort((a, b) => (a.item.group_id ?? 99) - (b.item.group_id ?? 99) || a.item.name.localeCompare(b.item.name));
  }, [sentInd, itemMap, onHand, orderedBy, edit, rateMap, locations, holds, date]);

  const toBuy = rows.filter((r) => r.qty > 0);
  const vOf = (r: Row) => moved[r.item.id] ?? r.item.default_vendor_id;
  const loose = toBuy.filter((r) => !vOf(r));
  const byVendor = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) { const v = moved[r.item.id] ?? r.item.default_vendor_id; if (v && (r.qty > 0 || vendorMap.get(v)?.is_store)) m.set(v, [...(m.get(v) ?? []), r]); }
    return m;
  }, [rows, moved, vendorMap]);
  const vendorIds = useMemo(() => {
    const ids = new Set<string>([...byVendor.keys(), ...pos.filter((p) => !p.party).map((p) => p.vendor_id)]);
    return [...ids].filter((id) => vendorMap.has(id)).sort((a, b) => vendorMap.get(a)!.name.localeCompare(vendorMap.get(b)!.name));
  }, [byVendor, pos, vendorMap]);

  // ----- Party order track: kept apart from the day's normal buying and from store stock -----
  const psMap = useMemo(() => new Map(ps.map((x) => [x.item_id, x])), [ps]);
  const partyAsked = useMemo(() => { const m = new Map<number, number>(); for (const r of partyInd) for (const l of r.indent_lines) m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.qty)); return m; }, [partyInd]);
  const partyNew = useMemo(() => [...partyAsked].map(([id, asked]) => { const item = itemMap.get(id); if (!item) return null; const p = psMap.get(id); const pend = Math.max(0, asked - Number(p?.approved_asked ?? 0)); return pend > 0 ? { item, asked, pend, p } : null; }).filter(Boolean).sort((a, b) => a!.item.name.localeCompare(b!.item.name)) as { item: ItemRow; asked: number; pend: number; p?: PS }[], [partyAsked, psMap, itemMap]);
  const pVendor = (r: { item: ItemRow; p?: PS }) => pdraft[r.item.id]?.vendor ?? r.p?.vendor_id ?? r.item.default_vendor_id ?? '';
  const pQty = (r: { pend: number; item: ItemRow }) => pdraft[r.item.id]?.qty ?? r.pend;
  const partyToPlace = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const x of ps) {
      const rem = Number(x.buy_qty) - Number(x.ordered_qty); const item = itemMap.get(x.item_id);
      if (rem <= 1e-9 || !x.vendor_id || !item || vendorMap.get(x.vendor_id)?.is_store) continue;
      const rate = rateMap.get(`${x.vendor_id}:${x.item_id}`) ?? (item.last_cost != null ? Number(item.last_cost) : null);
      const step = item.purchase_factor ? Number(item.purchase_factor) : stepOf(item.unit);
      m.set(x.vendor_id, [...(m.get(x.vendor_id) ?? []), { carried: 0, carriedAge: 0, carriedWhy: '', item, asked: partyAsked.get(x.item_id) ?? rem, by: [{ loc: 'Party', qty: rem }], inStore: 0, ordered: 0, sug: rem, qty: rem, rate, step }]);
    }
    return m;
  }, [ps, itemMap, rateMap, partyAsked, vendorMap]);
  const partyFromStore = ps.filter((x) => Number(x.buy_qty) > 0 && x.vendor_id && vendorMap.get(x.vendor_id)?.is_store).map((x) => itemMap.get(x.item_id)?.name).filter(Boolean) as string[];
  const partyPos = pos.filter((p) => p.party);
  const partyBlocked = partyNew.some((r) => pQty(r) > 0 && !pVendor(r));
  async function partyOk() {
    setPbusy(true);
    const lines = partyNew.map((r) => ({ item_id: r.item.id, qty: pQty(r), vendor_id: pVendor(r) || null }));
    const { error } = await supabase.rpc('party_approve', { p_date: date, p_lines: lines });
    setPbusy(false);
    if (error) return toast(errText(error));
    setPdraft({}); toast('Sent to buying. Place the party orders below.'); await load();
  }
  function setAllEmpty(v: string) { if (!v) return; setPdraft((d) => { const n = { ...d }; for (const r of partyNew) if (!pVendor(r)) n[r.item.id] = { ...n[r.item.id], vendor: v }; return n; }); }

  const estimate = (list: Row[]) => list.reduce((t, r) => t + (r.rate != null ? r.qty * r.rate : 0), 0);
  const shortRows = rows.filter((r) => !vendorMap.get(vOf(r) ?? '')?.is_store && r.qty < r.sug - 1e-9);
  const isDouble = (r: Row) => r.carried > 1e-9 && r.asked - r.carried > 1e-9;
  const dropOf = (id: number) => drops.find((d) => d.item_id === id && d.for_date === date && (d.status === 'asked' || d.status === 'question'));
  const needsDecision = (r: Row) => isDouble(r) && !keeps.includes(r.item.id);
  const doubleRows = rows.filter((r) => needsDecision(r) && !vendorMap.get(vOf(r) ?? '')?.is_store);
  const pendingDrops = drops.filter((d) => d.status === 'asked' || d.status === 'question');
  const doneDrops = drops.filter((d) => d.status === 'approved');
  const dayTotal = placed + vendorIds.reduce((t, id) => t + (vendorMap.get(id)?.is_store ? 0 : estimate(byVendor.get(id) ?? [])), 0);
  const over = limit > 0 ? Math.max(0, Math.round(dayTotal - limit)) : 0;
  const approved = appr?.status === 'approved';
  const overBlocked = over > 0 && !approved && !isOwner;
  const blocked = shortRows.length > 0 || overBlocked || doubleRows.length > 0;
  function openPush(r: Row, amount: number, el: HTMLElement) {
    const bb = el.getBoundingClientRect(); setPushPos({ x: bb.right, y: bb.bottom });
    setPushFor(pushFor === r.item.id ? null : r.item.id); setPushQty(String(n2(amount))); setPushWhy(over > 0 ? 'Over the daily limit' : '');
  }
  async function doPush() {
    const r = rows.find((x) => x.item.id === pushFor); const amt = Number(pushQty);
    if (!r || !pushWhy || !(amt > 0)) return;
    const own = Math.max(0, r.asked - r.carried); const pn = Math.min(amt, own); const po = amt - pn;
    const names = r.by.filter((b) => b.loc !== 'Earlier orders').map((b) => b.loc).join(', ');
    const { error } = await supabase.rpc('buy_push', { p_item: r.item.id, p_date: date, p_new: pn, p_old: po, p_reason: pushWhy, p_counters: names || null });
    if (error) return toast(errText(error));
    setEdit((e) => { const n = { ...e }; if (n[r.item.id] != null) n[r.item.id] = Math.max(0, r.qty - amt); return n; });
    toast(`${r.item.name} pushed to tomorrow`); setPushFor(null); await load();
  }
  async function askOwner() {
    const { error } = await supabase.rpc('buy_ask_approval', { p_date: date, p_over: over });
    if (error) return toast(errText(error)); toast('Asked the owner'); await load();
  }
  async function decide(ok: boolean) {
    const { error } = await supabase.rpc('buy_decide', { p_date: date, p_ok: ok });
    if (error) return toast(errText(error)); toast(ok ? 'Approved' : 'Sent back to the store'); await load();
  }
  async function saveLimit() {
    const { error } = await supabase.rpc('set_buy_limit', { p_amount: Number(limEdit || 0) });
    if (error) return toast(errText(error)); setLimEdit(null); toast('Daily limit saved'); await load();
  }
  async function dropRequest(r: Row) {
    if (!dropWhy) return;
    const { error } = await supabase.rpc('buy_drop_request', { p_item: r.item.id, p_date: date, p_reason: dropWhy, p_note: dropNote });
    if (error) return toast(errText(error));
    toast('Sent to the owner'); setDropFor(null); setDropWhy(''); setDropNote(''); await load();
  }
  async function dropShort(r: Row) {
    if (!dropWhy) return;
    const own = Math.max(0, r.asked - r.carried);
    const amt = Math.min(r.sug - r.qty, own);
    if (!(amt > 0)) return toast('Push the rest instead. Part of it is from an earlier ask.');
    const { error } = await supabase.rpc('buy_drop_short', { p_item: r.item.id, p_date: date, p_qty: amt, p_reason: dropWhy, p_note: dropNote });
    if (error) return toast(errText(error));
    toast('Sent to the owner'); setShortFor(null); setDropWhy(''); setDropNote(''); await load();
  }
  async function keepAll(r: Row) {
    const { error } = await supabase.rpc('buy_keep_all', { p_item: r.item.id, p_date: date });
    if (error) return toast(errText(error)); await load();
  }
  async function dropAct(fn: string, args: Record<string, unknown>, msg: string) {
    const { error } = await supabase.rpc(fn, args);
    if (error) return toast(errText(error)); toast(msg); setAskOpen(null); await load();
  }
  async function cancelHold(id: string) {
    const { error } = await supabase.rpc('buy_cancel_hold', { p_id: id });
    if (error) return toast(errText(error)); toast('Ask cancelled'); await load();
  }
  const pushedOut = holds.filter((h) => h.status === 'open' && !h.drop_pending && h.from_date === date && h.due_date > date);
  const grand = vendorIds.reduce((t, id) => t + (vendorMap.get(id)?.is_store ? 0 : estimate(byVendor.get(id) ?? [])), 0);
  const isStoreV = (r: Row) => !!vendorMap.get(vOf(r) ?? '')?.is_store;
  const itemCount = toBuy.filter((r) => !isStoreV(r)).length;
  const ordersSent = pos.length;

  async function usual(itemId: number, vendorId: string, label: string) {
    const { error } = await supabase.rpc('set_usual_vendor', { p_item_id: itemId, p_vendor_id: vendorId });
    if (error) return toast(errText(error));
    toast(`${itemMap.get(itemId)?.name} will be bought from ${label} from now on`);
    await loadStatic(); setOtherFor(null); setOtherText('');
  }
  function moveToday(itemId: number) {
    if (!moveTo) return;
    setMoved((p) => ({ ...p, [itemId]: moveTo }));
    toast(`${itemMap.get(itemId)?.name} moved to ${vendorMap.get(moveTo)?.name} for today`);
    setMoveFor(null); setMoveTo('');
  }
  async function moveUsual(itemId: number) {
    if (!moveTo) return;
    await usual(itemId, moveTo, vendorMap.get(moveTo)?.name ?? '');
    setMoved((p) => { const n = { ...p }; delete n[itemId]; return n; });
    setMoveFor(null); setMoveTo('');
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

      <PoCancelInbox onChanged={() => { void load(); }} />

      <div className="kpis">
        <div className="card kp"><div className="label">Counters sent</div><div className="num kpn">{sentInd.length} of {counters.filter((c) => c.id !== partyLoc).length}</div></div>
        <div className="card kp"><div className="label">Items to buy</div><div className="num kpn">{itemCount}</div></div>
        <div className="card kp"><div className="label">Estimated value</div><div className="num kpn">{money(grand)}</div><div className="muted small">at last available rates, to plan cash</div></div>
        <div className="card kp"><div className="label">Orders sent</div><div className="num kpn">{ordersSent}</div></div>
      </div>

      {!loading && (limit > 0 || isOwner) && (
        <div className="card" style={{ padding: '12px 16px', borderColor: over > 0 && !approved ? 'var(--warn, #B77A00)' : undefined }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <div>
              {limit > 0 ? <><b>Today {money(dayTotal)} · daily limit {money(limit)}</b>
                <div className="muted small">{over > 0 ? (approved ? `${money(over)} over, approved by the owner.` : appr?.status === 'asked' ? `${money(over)} over. Waiting for the owner.` : appr?.status === 'declined' ? `${money(over)} over. The owner said not today. Push some items to tomorrow.` : `${money(over)} over. Push some items to tomorrow, or ask the owner to approve the extra.`) : 'Within the limit.'}</div></>
                : <><b>No daily buying limit set</b><div className="muted small">Set one and the store has to stay within it, or ask you.</div></>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {over > 0 && !approved && !canDecide && appr?.status !== 'asked' && <button className="btn" onClick={askOwner}>Ask owner to approve</button>}
              {isOwner && limEdit === null && <button className="btn quiet" onClick={() => setLimEdit(String(limit || ''))}>{limit > 0 ? 'Change limit' : 'Set limit'}</button>}
              {isOwner && limEdit !== null && (<>
                <input inputMode="numeric" aria-label="Daily limit in rupees" placeholder="₹ per day, 0 for none" value={limEdit} onChange={(e) => setLimEdit(e.target.value.replace(/[^0-9]/g, ''))} style={{ width: 150 }} />
                <button className="btn primary" onClick={saveLimit}>Save</button><button className="btn quiet" onClick={() => setLimEdit(null)}>Cancel</button></>)}
            </div>
          </div>
          {canDecide && appr?.status === 'asked' && (
            <div className="banner warn" style={{ marginTop: 10 }}>
              <div><b>The store asks to go {money(Number(appr.over_amount))} over today's limit.</b></div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}><button className="btn primary" onClick={() => decide(true)}>Approve</button><button className="btn" onClick={() => decide(false)}>Send back, push items</button></div>
            </div>
          )}
        </div>
      )}

      {!loading && shortRows.length > 0 && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          <div><b>Decide every item before sending.</b> {shortRows.length === 1 ? 'This item is' : 'These items are'} short of what the counters asked. The store can buy extra, but not less without a reason. Buy the full quantity, push the rest to tomorrow, or ask the owner to drop it.</div>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {shortRows.map((r) => { const dp = dropOf(r.item.id); return (
              <div key={'sh' + r.item.id}>
                <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <span><b>{r.item.name}</b> <span className="muted small">buying {packText(r.item, r.qty)} of {packText(r.item, r.sug)}</span></span>
                  {dp ? <span className="chip due">Waiting for the owner to approve dropping {packText(r.item, dp.qty)}</span> : (
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn quiet" onClick={() => setEdit((e) => { const n = { ...e }; delete n[r.item.id]; return n; })}>Buy all</button>
                      <button className="btn" onClick={(e) => openPush(r, r.sug - r.qty, e.currentTarget)}>Push the rest</button>
                      <button className="btn" onClick={() => { setShortFor(shortFor === r.item.id ? null : r.item.id); setDropWhy(''); setDropNote(''); }}>Ask owner to drop the rest</button>
                    </span>)}
                </div>
                {!dp && shortFor === r.item.id && (
                  <div className="stack" style={{ gap: 6, marginTop: 6, maxWidth: 420 }}>
                    <div className="muted small">Ordering less than asked needs the owner's yes. The counter is not told.</div>
                    <select aria-label="Why drop" value={dropWhy} onChange={(e) => setDropWhy(e.target.value)}><option value="">Why do you want to drop it? (required)</option>{DROP_WHY.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                    <textarea rows={2} aria-label="Note for the owner" placeholder="Short note for the owner (optional)" value={dropNote} onChange={(e) => setDropNote(e.target.value)} />
                    <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={!dropWhy} onClick={() => void dropShort(r)}>Send to owner</button><button className="btn quiet" onClick={() => setShortFor(null)}>Cancel</button></div>
                  </div>)}
              </div>); })}
          </div>
        </div>
      )}
      {!loading && doubleRows.length > 0 && <div className="banner warn" style={{ marginBottom: 12 }}><b>{doubleRows.length === 1 ? 'One item may be ordered twice.' : `${doubleRows.length} items may be ordered twice.`}</b> Open {doubleRows.length === 1 ? 'it' : 'them'} below and decide: ask the owner to drop the earlier ask, or confirm the full quantity. Orders can be sent after that.</div>}
      {!loading && rows.some((r) => (r.near ?? 0) > 0) && <p className="muted small" style={{ marginBottom: 10 }}>Nearly covered by stock, not listed: {rows.filter((r) => (r.near ?? 0) > 0).map((r) => `${r.item.name} (needs ${n2(r.near ?? 0)} ${r.item.unit} more)`).join(', ')}.</p>}
      {!loading && overBlocked && shortRows.length === 0 && <div className="banner warn" style={{ marginBottom: 12 }}>Today is over the daily limit. Push some items to tomorrow, or ask the owner to approve. Orders can be sent once it fits.</div>}

      {loading ? <p className="muted">Loading…</p> : (
        <>
          {(partyNew.length > 0 || partyToPlace.size > 0 || partyPos.length > 0) && (
            <div className="card" style={{ borderColor: 'var(--brand)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div><b>Party order{partyLabel ? `: ${partyLabel}` : ''}</b><div className="muted small">Bought separately from the daily buying. Nothing here uses store stock.</div></div>
                <span className="chip due">Separate track</span>
              </div>
              {partyNew.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p className="small"><b>Step 1.</b> Choose for each item: give it from your store or buy it outside, then tap OK. Usual vendors are filled in for planned items.</p>
                  <div className="tablewrap" style={{ border: 0, boxShadow: 'none' }}>
                    <table>
                      <thead><tr><th>Item</th><th className="r">Asked</th><th className="r">In store</th><th>Source</th><th>Quantity</th></tr></thead>
                      <tbody>{partyNew.map((r) => { const q = pQty(r); const step = r.item.purchase_factor ? Number(r.item.purchase_factor) : stepOf(r.item.unit); const v = pVendor(r); return (
                        <tr key={r.item.id}>
                          <td><b>{r.item.name}</b>{r.p && r.p.approved_asked > 0 && <div className="muted small">Added after the first OK</div>}</td>
                          <td className="r num">{packText(r.item, r.pend)}</td>
                          <td className="r num muted">{n2(Math.max(0, onHand[r.item.id] ?? 0))} {r.item.unit}</td>
                          <td><select aria-label={`Source for ${r.item.name}`} value={v} onChange={(e) => setPdraft((d) => ({ ...d, [r.item.id]: { ...d[r.item.id], vendor: e.target.value } }))} style={{ minWidth: 180, borderColor: !v && q > 0 ? 'var(--bad)' : undefined }}>
                            <option value="">Choose</option>
                            {vendors.map((x) => <option key={x.id} value={x.id}>{x.is_store ? 'From our store (In House)' : x.name}{x.id === r.item.default_vendor_id ? ' (usual)' : ''}</option>)}
                          </select>{vendorMap.get(v)?.is_store && q > (onHand[r.item.id] ?? 0) && <div className="small" style={{ color: 'var(--bad)', marginTop: 3 }}>Store has only {n2(Math.max(0, onHand[r.item.id] ?? 0))} {r.item.unit}. Lower the quantity or buy the rest outside.</div>}</td>
                          <td><div className="stepper">
                            <button aria-label="Less" onClick={() => setPdraft((d) => ({ ...d, [r.item.id]: { ...d[r.item.id], qty: Math.max(0, q - step) } }))}>−</button>
                            <span className="num">{packText(r.item, q)}</span>
                            <button aria-label="More" onClick={() => setPdraft((d) => ({ ...d, [r.item.id]: { ...d[r.item.id], qty: q + step } }))}>+</button>
                          </div></td>
                        </tr>); })}</tbody>
                    </table>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                    <div className="row" style={{ gap: 6 }}><span className="muted small">Set all empty to</span>
                      <select aria-label="Set all empty to" value="" onChange={(e) => setAllEmpty(e.target.value)}><option value="">Choose</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.is_store ? 'From our store (In House)' : x.name}</option>)}</select></div>
                    <button className="btn primary" disabled={pbusy || partyBlocked} onClick={partyOk}>{pbusy ? 'Saving…' : 'OK, send to buying'}</button>
                  </div>
                  {partyBlocked && <p className="small muted" style={{ marginTop: 6 }}>Choose a source for every item you are buying. Set an item to 0 if it is not needed.</p>}
                </div>
              )}
              {partyToPlace.size > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p className="small"><b>{partyNew.length > 0 ? 'Step 2.' : 'Ready to order.'}</b> Place the party orders.</p>
                  <div className="stack" style={{ gap: 6 }}>
                    {[...partyToPlace.entries()].map(([vid, list]) => { const v = vendorMap.get(vid); if (!v) return null; return (
                      <div key={vid} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
                        <div><b>{v.name}</b> <span className="muted small">{list.length} {list.length === 1 ? 'item' : 'items'}: {list.map((r) => r.item.name).slice(0, 4).join(', ')}{list.length > 4 ? '…' : ''}</span></div>
                        <button className="btn primary" onClick={() => setDlg({ vendorId: vid, party: true })}>{kindOf(v) === 'bought' ? 'Open shopping list' : 'Review order'}</button>
                      </div>); })}
                  </div>
                </div>
              )}
              {partyFromStore.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>From the store (no order): {partyFromStore.join(', ')}. Issue these from the store on the Issue screen.</p>}
              {partyPos.length > 0 && (
                <div className="row" style={{ marginTop: 10, gap: 8 }}>
                  <span className="muted small">Placed:</span>
                  {partyPos.map((po) => <button key={po.id} className="chip done pickchip" onClick={() => setDlg({ vendorId: po.vendor_id, poId: po.id, party: true })}>{vendorMap.get(po.vendor_id)?.name} · {po.po_number}</button>)}
                </div>
              )}
            </div>
          )}

          {loose.length > 0 && (
            <div className="banner warn buy-loose">
              <div><b>{loose.length} {loose.length === 1 ? 'item has' : 'items have'} no usual vendor yet.</b> Pick where each comes from. Compass remembers it for next time.</div>
              {loose.map((r) => (
                <div key={r.item.id} className="loose-row">
                  <div className="loose-name"><b>{r.item.name}</b> <span className="num">{packText(r.item, r.qty)}</span></div>
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
              const vpos = pos.filter((p) => p.vendor_id === vid && !p.party);
              const open = openV === vid;
              const allDone = list.length === 0;
              const chip = kind === 'store' ? <span className="chip due">From store</span> : allDone ? <span className="chip done">{kind === 'bought' ? 'Bought' : 'Sent'}</span> : vpos.length ? <span className="chip late">New items to order</span> : <span className="chip late">{kind === 'bought' ? 'To buy' : 'Not sent'}</span>;
              const channel = kind === 'store' ? 'Supplied from your store. No order needed.' : kind === 'wa' ? `WhatsApp group: ${v.whatsapp_group}` : kind === 'phone' ? `Phone call${v.phone ? ': ' + v.phone : ''}` : kind === 'app' ? `Order in the ${v.name} app` : 'Bought by the store, not ordered';
              return (
                <div key={vid} className="card" style={{ padding: 0 }}>
                  <button className="vhead" onClick={() => setOpenV(open ? null : vid)} aria-expanded={open}>
                    <span style={{ transform: open ? 'none' : 'rotate(-90deg)', display: 'inline-flex', transition: 'transform .12s' }}><Icon name="chev" /></span>
                    <span style={{ flex: 1, textAlign: 'left' }}><b>{v.name}</b><span className="muted small" style={{ display: 'block' }}>{channel}</span></span>
                    <span className="muted small">{list.length} {list.length === 1 ? 'item' : 'items'}</span>
                    <span className="num" style={{ minWidth: 80, textAlign: 'right' }}>{kind === 'store' ? '' : money(estimate(list))}</span>
                    {chip}
                  </button>
                  {open && (
                    <div style={{ padding: '0 0 14px' }}>
                      {kind === 'store' && (
                        <div style={{ padding: '4px 16px' }}>
                          <p className="small muted">These come from your own store, so no purchase order is made. Issue them on the Issue to counters screen and the store stock goes down then.</p>
                          {list.length > 0 && (
                            <table>
                              <thead><tr><th>Item</th><th className="r">Counters asked</th><th className="r">In store now</th><th className="r">Short by</th></tr></thead>
                              <tbody>{rows.filter((r) => vOf(r) === vid).map((r) => { const short = Math.max(0, r.asked - r.inStore); return (
                                <tr key={r.item.id}><td><b>{r.item.name}</b></td><td className="r num">{n2(r.asked)} {r.item.unit}</td><td className="r num muted">{n2(r.inStore)} {r.item.unit}</td>
                                  <td className="r num" style={{ color: short > 0 ? 'var(--bad)' : undefined }}>{short > 0 ? `${n2(short)} ${r.item.unit}` : 'None'}</td></tr>); })}</tbody>
                            </table>
                          )}
                          {list.some((r) => r.asked > r.inStore) && <p className="banner warn" style={{ marginTop: 8 }}>The store is short on some In House items. Move those items to a vendor to buy them, or restock the store.</p>}
                        </div>
                      )}
                      {kind !== 'store' && list.length > 0 && (
                        <div className="tablewrap" style={{ border: 0, borderRadius: 0, boxShadow: 'none' }}>
                          <table>
                            <thead><tr><th>Item</th><th>Asked by counters</th><th className="r">Asked</th><th className="r">In store</th><th className="r">Suggested</th><th>Order</th><th className="r">Estimate</th><th /></tr></thead>
                            <tbody>{list.map((r) => (
                              <Fragment key={r.item.id}>
                              <tr style={r.carried > 0 ? { background: 'var(--warn-soft, #FBF0D5)' } : undefined}>
                                <td>{r.carried > 0 ? <button className="btn quiet" style={{ padding: 0, fontWeight: 600 }} aria-expanded={openRow === r.item.id} onClick={() => setOpenRow(openRow === r.item.id ? null : r.item.id)}><span style={{ display: 'inline-block', transform: openRow === r.item.id ? 'none' : 'rotate(-90deg)', transition: 'transform .12s', marginRight: 4 }}><Icon name="chev" /></span>{r.item.name}</button> : <b>{r.item.name}</b>}{r.carried > 0 && <div style={{ marginTop: 3 }}><span className={r.carriedAge >= 3 ? 'chip late' : 'chip due'}>{r.carriedAge >= 3 ? '⚠ ' : ''}From {r.carriedAge === 1 ? 'yesterday' : `${r.carriedAge} days ago`}: {n2(r.carried)} {r.item.unit}</span><div className="muted small">{r.carriedWhy}</div></div>}{needsDecision(r) && <div style={{ marginTop: 3 }}><span className="chip late">Possible double</span></div>}{r.item.rate_varies && <span className="chip late ratetag">Rate varies</span>}{r.ordered > 0 && <div className="muted small">{n2(r.ordered)} {r.item.unit} already ordered</div>}</td>
                                <td className="small">{r.by.filter((b) => b.loc !== 'Earlier orders').map((b) => `${b.loc} ${n2(b.qty)}`).join(' · ') || '—'}</td>
                                <td className="r num">{n2(r.asked)} {r.item.unit}</td>
                                <td className="r num muted">{n2(r.inStore)} {r.item.unit}</td>
                                <td className="r num muted">{packText(r.item, r.sug)}</td>
                                <td><div className="stepper">
                                  <button aria-label="Less" onClick={() => setEdit((p) => ({ ...p, [r.item.id]: Math.max(0, r.qty - r.step) }))}>−</button>
                                  <span className="num">{packText(r.item, r.qty)}</span>
                                  <button aria-label="More" onClick={() => setEdit((p) => ({ ...p, [r.item.id]: r.qty + r.step }))}>+</button>
                                </div></td>
                                <td className="r num">{r.rate != null ? money(r.qty * r.rate) : '—'}</td>
                                <td style={{ whiteSpace: 'nowrap' }}><button className="btn quiet" onClick={(e) => openPush(r, r.qty, e.currentTarget)}>Push</button><button className="btn quiet" onClick={(e) => { const bb = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMovePos({ x: bb.right, y: bb.bottom }); setMoveFor(moveFor === r.item.id ? null : r.item.id); setMoveTo(''); }}>Move</button></td>
                              </tr>
                              {r.carried > 0 && (openRow === r.item.id || needsDecision(r)) && (
                                <tr style={{ background: 'var(--warn-soft, #FBF0D5)' }}><td colSpan={8} style={{ paddingTop: 0 }}>
                                  <div className="stack" style={{ gap: 4, padding: '4px 0 6px 26px' }}>
                                    <div className="row small" style={{ justifyContent: 'space-between' }}><span><b>Current order</b> <span className="muted">{r.by.filter((x) => x.loc !== 'Earlier orders').map((x) => `${x.loc} ${n2(x.qty)}`).join(' · ') || 'No new ask today'}</span></span><b className="num">{packText(r.item, Math.max(0, r.asked - r.carried))}</b></div>
                                    {holds.filter((h) => h.item_id === r.item.id && h.due_date <= date && h.from_date < date).map((h) => (
                                      <div key={h.id} className="row small" style={{ justifyContent: 'space-between' }}><span><b>Previous order</b> <span className="muted">asked {dayLabel(h.from_date)}{h.counters ? ` · ${h.counters}` : ''} · pushed: {h.reason}{h.push_count > 1 ? ` (${h.push_count} times)` : ''}</span></span><b className="num">{packText(r.item, h.qty)}</b></div>))}
                                    {needsDecision(r) && (() => { const d = dropOf(r.item.id); return (
                                      <div style={{ marginTop: 6 }}>
                                        <div className="small" style={{ color: '#6B4A00' }}><b>Possible double order.</b> This counter asked again for the same item. The total of {packText(r.item, r.asked)} may be more than they need.</div>
                                        {d ? (
                                          <div className="small" style={{ marginTop: 6 }}>
                                            {d.status === 'asked' ? <span className="chip due">Waiting for the owner to decide on dropping {packText(r.item, d.qty)}</span> : <div className="stack" style={{ gap: 6 }}><div><b>Owner asks:</b> {d.owner_question}</div>
                                              <div className="row" style={{ gap: 6 }}><input aria-label="Your reply" placeholder="Your reply" value={talk[d.id] ?? ''} onChange={(e) => setTalk((t) => ({ ...t, [d.id]: e.target.value }))} style={{ flex: 1 }} /><button className="btn primary" disabled={!(talk[d.id] ?? '').trim()} onClick={() => void dropAct('buy_drop_reply', { p_id: d.id, p_reply: talk[d.id] }, 'Reply sent')}>Reply</button></div></div>}
                                          </div>
                                        ) : dropFor === r.item.id ? (
                                          <div className="stack" style={{ gap: 6, marginTop: 6, maxWidth: 420 }}>
                                            <div className="muted small">The counter is not told. Only the owner sees this.</div>
                                            <select aria-label="Why drop" value={dropWhy} onChange={(e) => setDropWhy(e.target.value)}><option value="">Why do you want to drop it? (required)</option>{DROP_WHY.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                                            <textarea rows={2} aria-label="Note for the owner" placeholder="Short note for the owner (optional)" value={dropNote} onChange={(e) => setDropNote(e.target.value)} />
                                            <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={!dropWhy} onClick={() => void dropRequest(r)}>Send to owner</button><button className="btn quiet" onClick={() => setDropFor(null)}>Cancel</button></div>
                                          </div>
                                        ) : (
                                          <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                                            <button className="btn primary" onClick={() => { setDropFor(r.item.id); setDropWhy(''); setDropNote(''); }}>Ask owner to drop the previous {packText(r.item, r.carried)}</button>
                                            <button className="btn" onClick={() => void keepAll(r)}>Buy all {packText(r.item, r.asked)}, it is needed</button>
                                          </div>
                                        )}
                                      </div>); })()}
                                  </div></td></tr>)}
                              </Fragment>))}</tbody>
                          </table>
                        </div>
                      )}
                      {moveFor != null && list.some((r) => r.item.id === moveFor) && (
                        <>
                          <div onClick={() => setMoveFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                          <div role="dialog" aria-label="Move item" style={{ position: 'fixed', zIndex: 41, top: Math.min(movePos.y + 6, window.innerHeight - 250), left: Math.max(8, Math.min(movePos.x - 280, window.innerWidth - 296)), width: 280, background: 'var(--surface, #fff)', border: '1px solid var(--line, #ddd)', borderRadius: 12, boxShadow: 'var(--shadow-2)', padding: 12 }}>
                            <div className="small" style={{ marginBottom: 6 }}>Move {itemMap.get(moveFor)?.name} to</div>
                            <select aria-label="Vendor" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ width: '100%' }}>
                              <option value="">Choose vendor</option>
                              {vendors.filter((x) => x.id !== vid).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </select>
                            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                              <button className="btn primary" disabled={!moveTo} onClick={() => moveToday(moveFor)}>Just for today</button>
                              <button className="btn" disabled={!moveTo} onClick={() => void moveUsual(moveFor)}>Make usual</button>
                            </div>
                          </div>
                        </>
                      )}
                      {vpos.length > 0 && (
                        <div className="row" style={{ padding: '10px 16px 0', gap: 8 }}>
                          <span className="muted small">Placed:</span>
                          {vpos.map((p) => <button key={p.id} className="chip done pickchip" onClick={() => setDlg({ vendorId: vid, poId: p.id })}>{p.po_number} · {timeOf(p.sent_at)}</button>)}
                        </div>
                      )}
                      <div className="row" style={{ padding: '10px 16px 0', justifyContent: 'space-between' }}>
                        <span className="muted small">{kind === 'store' ? '' : 'Change any quantity, then review. Values are estimates to plan cash, at the last rate available until the exact rate is entered. The order message never carries a price. Nothing is sent until you tap the button.'}</span>
                        {kind !== 'store' && list.length > 0 && <button className="btn primary" disabled={blocked} onClick={() => setDlg({ vendorId: vid })}>{kind === 'bought' ? 'Open shopping list' : 'Review order'}</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && canDecide && pendingDrops.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn, #B77A00)' }}>
          <b>Drop requests ({pendingDrops.length})</b>
          <div className="stack" style={{ gap: 10, marginTop: 8 }}>
            {pendingDrops.map((d) => (
              <div key={d.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><div><b>{d.item_name}: drop {n2(d.qty)} {d.unit}</b><div className="muted small">{d.kind === 'short' ? `The store ordered less than asked for ${dayLabel(d.for_date)}.` : `From the earlier ask, for ${dayLabel(d.for_date)}.`} Asked by {d.requested_by_name ?? 'the store'}.</div></div></div>
                <div className="small" style={{ marginTop: 4 }}>Store's reason: <b>{d.reason}</b>{d.note ? ` · ${d.note}` : ''}{d.store_reply ? <><br />Store replied: <b>{d.store_reply}</b></> : null}</div>
                {d.status === 'question' ? <div className="muted small" style={{ marginTop: 4 }}>You asked: {d.owner_question}. Waiting for the store.</div> : askOpen === d.id ? (
                  <div className="row" style={{ gap: 6, marginTop: 6 }}><input aria-label="Your question" value={talk['q' + d.id] ?? ''} placeholder="Ask the store why" onChange={(e) => setTalk((t) => ({ ...t, ['q' + d.id]: e.target.value }))} style={{ flex: 1 }} /><button className="btn primary" disabled={!(talk['q' + d.id] ?? '').trim()} onClick={() => void dropAct('buy_drop_ask', { p_id: d.id, p_question: talk['q' + d.id] }, 'Question sent')}>Send</button><button className="btn quiet" onClick={() => setAskOpen(null)}>Cancel</button></div>
                ) : (
                  <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <button className="btn primary" onClick={() => void dropAct('buy_drop_decide', { p_id: d.id, p_ok: true }, 'Drop approved')}>Approve drop</button>
                    <button className="btn" onClick={() => setAskOpen(d.id)}>Ask why first</button>
                    <button className="btn quiet" onClick={() => void dropAct('buy_drop_decide', { p_id: d.id, p_ok: false }, 'Rejected, the store buys all')}>Reject, buy all</button>
                  </div>)}
              </div>))}
          </div>
        </div>
      )}

      {!loading && canDecide && doneDrops.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Dropped this week</b>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>{doneDrops.map((d) => <div key={d.id} className="small"><b>{d.item_name}</b> {n2(d.qty)} {d.unit} <span className="muted">· {d.reason} · asked by {d.requested_by_name ?? 'the store'} · {d.decided_at ? dayLabel(d.decided_at.slice(0, 10)) : ''}</span></div>)}</div>
        </div>
      )}

      {!loading && pushedOut.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Pushed to tomorrow ({pushedOut.length})</b>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {pushedOut.map((h) => { const it = itemMap.get(h.item_id); return (
              <div key={h.id} className="row small" style={{ justifyContent: 'space-between' }}>
                <span><b>{it?.name}</b> {it ? packText(it, h.qty) : n2(h.qty)} <span className="muted">· {h.reason}</span></span>
                {canDecide && <button className="btn quiet" onClick={() => cancelHold(h.id)}>Cancel ask</button>}
              </div>); })}
          </div>
        </div>
      )}

      {pushFor != null && rows.some((r) => r.item.id === pushFor) && (
        <>
          <div onClick={() => setPushFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div role="dialog" aria-label="Push to tomorrow" style={{ position: 'fixed', zIndex: 41, top: Math.min(pushPos.y + 6, window.innerHeight - 320), left: Math.max(8, Math.min(pushPos.x - 300, window.innerWidth - 316)), width: 300, background: 'var(--surface, #fff)', border: '1px solid var(--line, #ddd)', borderRadius: 12, boxShadow: 'var(--shadow-2)', padding: 12 }}>
            <div className="small" style={{ marginBottom: 6 }}><b>Push {itemMap.get(pushFor)?.name} to tomorrow</b></div>
            <div className="muted small" style={{ marginBottom: 6 }}>The counter will see it is pending. It shows on tomorrow's list until it is bought.</div>
            <label className="small">How much to push</label>
            <input inputMode="decimal" aria-label="Quantity to push" value={pushQty} onChange={(e) => setPushQty(e.target.value.replace(/[^0-9.]/g, ''))} style={{ width: '100%', marginBottom: 8 }} />
            <select aria-label="Reason" value={pushWhy} onChange={(e) => setPushWhy(e.target.value)} style={{ width: '100%' }}>
              <option value="">Why? (required)</option>
              {REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn primary" disabled={!pushWhy || !(Number(pushQty) > 0)} onClick={() => void doPush()}>Push to tomorrow</button>
              <button className="btn quiet" onClick={() => setPushFor(null)}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {dlg && dv && (
        <OrderSheet
          key={dlg.poId ?? dlg.vendorId}
          vendor={dv} kind={kindOf(dv)} po={dpo} rows={(dlg.party ? partyToPlace.get(dv.id) : byVendor.get(dv.id)) ?? []} party={dlg.party ? (partyLabel || 'Party') : undefined} itemMap={itemMap} forDate={date}
          onClose={() => setDlg(null)}
          onDone={async (keep) => { setEdit({}); await load(); if (!keep) setDlg(null); }}
        />
      )}
    </>
  );
}

function OrderSheet({ vendor, kind, po, rows, itemMap, forDate, party, onClose, onDone }: {
  party?: string; vendor: VendorRow; kind: Kind; po?: PoRow; rows: Row[]; itemMap: Map<number, ItemRow>; forDate: string; onClose: () => void; onDone: (keepOpen: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const today = istToday();
  const timeKey = `compass-po-time-${vendor.id}`;
  const [reqDate, setReqDate] = useState(forDate < today ? today : forDate);
  const [reqTime, setReqTime] = useState(lsGet(timeKey));
  const [delivery, setDelivery] = useState(true);
  const [notes, setNotes] = useState(party ? `Party order: ${party}` : '');
  const [pickTime, setPickTime] = useState(false);
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ poNo: string; text: string } | null>(null);
  const isMsg = kind === 'wa' || kind === 'phone';

  // Viewing a PO that was already placed.
  const viewText = po ? buildMessage({
    vendor: vendor.name, poNo: po.po_number, notes: po.notes, orderDate: po.order_date, reqDate: po.required_date ?? po.for_date ?? today, reqTime: po.required_time ?? '', delivery: po.delivery,
    lines: po.po_lines.map((l) => ({ name: itemMap.get(l.item_id)?.name ?? '', ...(itemMap.get(l.item_id) ? packLine(itemMap.get(l.item_id)!, Number(l.qty)) : { qty: Number(l.qty), unit: '' }) }))
  }) : '';
  const viewList = po ? po.po_lines.map((l) => `${itemMap.get(l.item_id)?.name ?? ''}  ${itemMap.get(l.item_id) ? packText(itemMap.get(l.item_id)!, Number(l.qty)) : n2(Number(l.qty))}`).join('\n') : '';

  const previewLines = rows.map((r) => ({ name: r.item.name, ...packLine(r.item, r.qty) }));
  const preview = buildMessage({ vendor: vendor.name, poNo: 'ST-PO-xxxx (added when you copy)', notes, orderDate: today, reqDate, reqTime: reqTime || 'Pick a time', delivery, lines: previewLines });
  const needTime = isMsg && !reqTime;

  const action = kind === 'wa' ? 'Copy to WhatsApp Group' : kind === 'phone' ? 'Mark as ordered by phone' : kind === 'app' ? `Mark as ordered in ${vendor.name}` : 'Mark as bought';

  async function place() {
    setBusy(true);
    const lines = rows.map((r) => ({ item_id: r.item.id, qty: r.qty, unit_rate: r.rate ?? '', asked: r.asked, in_store: r.inStore }));
    const { data, error } = await supabase.rpc(party ? 'party_create_po' : 'create_po', {
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
            <button className="btn" onClick={() => { if (!printText(title, isMsg ? preview : rows.map((r) => `${r.item.name}  ${packText(r.item, r.qty)}`).join('\n'))) toast('Allow pop-ups to print'); }}>Print</button>
            {!isMsg && <button className="btn" onClick={async () => toast((await copyText(`${vendor.name}\n` + rows.map((r, i) => `${i + 1}. ${r.item.name} ${packText(r.item, r.qty)}`).join('\n'))) ? 'List copied' : 'Could not copy')}>Copy list</button>}
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
                  <b className="num">{packText(r.item, r.qty)}</b>
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
          {po && (po.status === 'sent' || po.status === 'draft') && <PoCancelBox poId={po.id} onDone={() => { void onDone(false); }} />}
        </>
      )}
    </Sheet>
  );
}

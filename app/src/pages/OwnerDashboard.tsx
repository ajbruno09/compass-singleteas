import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useHealth } from '../components/StoreCheck';
import { MonthToDate } from '../components/MonthToDate';
import '../te.css';

// Owner dashboard: Tea Estate v2, as approved in the mock. Live data where it exists, "Waiting" where it does not yet.
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const istDate = (off = 0) => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const lakh = (n: number) => (n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : inr(n));
type Tag = 'live' | 'part' | 'wait';
const chip = (k: Tag) => `<span class="chip ${k}">${k === 'live' ? 'Live' : k === 'part' ? 'Partial' : 'Waiting'}</span>`;
const spark = (a: number[], c: string, w = 120, h = 28) => { const mn = Math.min(...a), mx = Math.max(...a), r = mx - mn || 1; const p = a.map((v, i) => `${(i / (a.length - 1) * w).toFixed(1)},${(h - 3 - (v - mn) / r * (h - 6)).toFixed(1)}`).join(' '); return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${p}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };
const ring = (p: number | null, c: string) => { const R = 26, C = 2 * Math.PI * R; return `<div class="ring"><svg width="62" height="62" viewBox="0 0 62 62"><circle cx="31" cy="31" r="${R}" fill="none" stroke="var(--line)" stroke-width="6"/>${p == null ? '' : `<circle cx="31" cy="31" r="${R}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C * p / 100} ${C}" transform="rotate(-90 31 31)"/>`}</svg><b>${p == null ? '—' : p}</b></div>`; };
const IC: Record<string, string> = {"Net sales": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 8h6M9 11h6M9 8c4 0 4 5 0 5l4 3", "Food cost": "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3", "Food cost %": "M19 5L5 19M7.5 6.5a1.5 1.5 0 1 0 0 .01M16.5 17.5a1.5 1.5 0 1 0 0 .01", "7 day average": "M3 17l6-6 4 4 8-8M15 7h6v6", "Contribution margin": "M4 20V10M10 20V4M16 20v-7M22 20H2", "Stock value": "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5", "Vendor payables": "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6", "Open alerts": "M12 3l10 18H2L12 3zM12 10v5M12 18h.01"};
const ic = (n: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[n] ?? ''}"/></svg>`;
const col = (k: string) => (k === 'dn' ? 'var(--bad)' : k === 'up' ? 'var(--good)' : 'var(--mut)');
interface Ind { location_id: number; for_date: string; outcome: string | null; late: boolean }
interface Al { id: string; level: string; title: string; body: string | null; created_at: string }
interface Dept { name: string; score: number | null; sub: string; rows: [string, string, string][] }

export function OwnerDashboard() {
  const { profile, locations } = useSession();
  const counters = useMemo(() => locations.filter((l) => l.kind === 'department' && l.active), [locations]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => istDate(i - 6)), []);
  const [sales, setSales] = useState<{ business_date: string; location_id: number; amount: number }[]>([]);
  const [inds, setInds] = useState<Ind[]>([]);
  const [bills, setBills] = useState<{ balance: number; due_date: string | null }[]>([]);
  const [alerts, setAlerts] = useState<Al[]>([]);
  const [stock, setStock] = useState<{ location_id: number; qty: number; item_id: number }[]>([]);
  const [cost, setCost] = useState<Record<number, number>>({});
  const [pos, setPos] = useState<{ status: string; po_lines: { qty: number; unit_rate: number | null }[] }[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [sheet, setSheet] = useState<{ title: string; html: string } | null>(null);
  const { items: health } = useHealth();

  const loadAlerts = async () => { const { data } = await supabase.from('alerts').select('id, level, title, body, created_at').is('done_at', null).order('created_at', { ascending: false }).limit(8); setAlerts((data as Al[]) ?? []); };
  useEffect(() => {
    (async () => {
      const today = istDate(0); const monthStart = today.slice(0, 8) + '01';
      const [s, ind, bal, pr, so, po, iss] = await Promise.all([
        supabase.from('daily_sales').select('business_date, location_id, amount').gte('business_date', monthStart < istDate(-13) ? monthStart : istDate(-13)).lte('business_date', today),
        supabase.from('indents').select('location_id, for_date, outcome, late').gte('for_date', days[0]).lte('for_date', today),
        supabase.from('vendor_bill_balances').select('balance, due_date').gt('balance', 0),
        supabase.from('items').select('id, last_cost').not('last_cost', 'is', null),
        supabase.from('stock_on_hand').select('location_id, item_id, qty'),
        supabase.from('purchase_orders').select('status, po_lines(qty, unit_rate)').gte('created_at', new Date(Date.now() - 14 * 864e5).toISOString()).neq('status', 'draft'),
        supabase.from('issues').select('status').gte('issued_at', new Date(Date.now() - 14 * 864e5).toISOString()),
      ]);
      setSales((s.data as typeof sales) ?? []); setInds((ind.data as Ind[]) ?? []);
      setBills(((bal.data as typeof bills) ?? []).map((b) => ({ balance: Number(b.balance), due_date: b.due_date })));
      setCost(Object.fromEntries(((pr.data as { id: number; last_cost: number }[]) ?? []).map((x) => [x.id, Number(x.last_cost)])));
      setStock(((so.data as typeof stock) ?? []).map((x) => ({ ...x, qty: Number(x.qty) })));
      setPos((po.data as typeof pos) ?? []); setIssues(((iss.data as { status: string }[]) ?? []).map((x) => x.status));
      void loadAlerts();
    })();
  }, [days]);

  const html = useMemo(() => {
    const today = istDate(0);
    const dayTot = (d: string) => sales.filter((x) => x.business_date === d).reduce((a, x) => a + Number(x.amount), 0);
    const S = days.map(dayTot); const hasSales = S.some((v) => v > 0);
    const latest = [...days].reverse().find((d) => dayTot(d) > 0) ?? today;
    const todayTot = dayTot(latest); const lwDate = (() => { const d = new Date(latest + 'T00:00:00'); d.setDate(d.getDate() - 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(); const lw = dayTot(lwDate); const delta = lw > 0 && todayTot > 0 ? (todayTot - lw) / lw * 100 : null;
    const latestLabel = latest === today ? 'today' : new Date(latest + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    const wk = new Date(latest + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' });
    const owed = bills.reduce((a, b) => a + b.balance, 0); const overdue = bills.filter((b) => b.due_date && b.due_date < today).reduce((a, b) => a + b.balance, 0);
    const due7 = bills.filter((b) => b.due_date && b.due_date >= today && b.due_date <= istDate(7)); const due7amt = due7.reduce((a, b) => a + b.balance, 0);
    const stockVal = (loc?: number) => stock.filter((x) => (loc ? x.location_id === loc : true) && cost[x.item_id] != null && x.qty > 0).reduce((a, x) => a + x.qty * cost[x.item_id], 0);
    const storeVal = stockVal(1);
    const urgent = alerts.filter((a) => ['urgent', 'critical', 'sos'].includes(a.level)).length;
    const openPos = pos.filter((p) => ['sent', 'partly_received'].includes(p.status)); const openVal = openPos.reduce((a, p) => a + p.po_lines.reduce((b, l) => b + Number(l.qty) * Number(l.unit_rate ?? 0), 0), 0);
    const overdueHealth = (health ?? []).filter((h) => h.age_days >= 2);
    const need = alerts.length + overdueHealth.length;

    const stat = (id: number, d: string) => { const x = inds.find((i) => i.location_id === id && i.for_date === d); if (!x) return 'x'; if (x.outcome === 'missed') return 'm'; if (x.outcome === 'late' || x.late) return 'l'; if (x.outcome === 'on_time' || x.outcome === 'nothing') return 'o'; return 'x'; };
    const dotRows = counters.map((c) => { const st = days.map((d) => stat(c.id, d)); const live = st.filter((x) => x !== 'x'); const pct = live.length ? Math.round(live.filter((x) => x === 'o').length / live.length * 100) : null; return { name: c.name, st, pct }; });
    const allLive = dotRows.flatMap((r) => r.st).filter((x) => x !== 'x'); const counterScore = allLive.length ? Math.round(allLive.filter((x) => x === 'o').length / allLive.length * 100) : null;
    const posDone = pos.length ? Math.round(pos.filter((p) => ['received', 'closed', 'complete'].includes(p.status)).length / pos.length * 100) : null;
    const issDone = issues.length ? Math.round(issues.filter((x) => x === 'confirmed').length / issues.length * 100) : null;
    const lab = (p: number | null): [string, string] => (p == null ? ['wait', 'Not scored yet'] : p < 65 ? ['crit', 'Critical'] : p < 80 ? ['att', 'Needs attention'] : ['ok', 'On track']);
    const D: Dept[] = [
      { name: 'Main store', score: issDone, sub: 'Issues confirmed by counters', rows: [['Issues confirmed by counters', '100%', issDone == null ? 'Waiting' : issDone + '%']] },
      { name: 'Kitchen', score: null, sub: 'Needs production and wastage data', rows: [] },
      { name: 'Service counters', score: counterScore, sub: 'Indents on time, last 7 days', rows: [['Indents on time', '100%', counterScore == null ? 'Waiting' : counterScore + '%']] },
      { name: 'Purchase', score: null, sub: 'Needs order turnaround data', rows: [] },
      { name: 'Receiving', score: posDone, sub: 'Orders received, last 14 days', rows: [['Orders received', '100%', posDone == null ? 'Waiting' : posDone + '%']] },
      { name: 'Accounts', score: null, sub: 'Needs bill approval data', rows: [] }];
    (window as unknown as { __depts: Dept[] }).__depts = D;

    const K: [string, string, string, string, Tag, number[] | null, string][] = [
      ['Net sales', hasSales && todayTot > 0 ? inr(todayTot) : '—', delta != null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% on last ${wk}` : '', delta == null ? '' : delta >= 0 ? 'up' : 'dn', hasSales ? 'part' : 'wait', hasSales ? S : null, hasSales ? `Counter sales for ${latestLabel}` : 'Waiting for sales'],
      ['Food cost', '—', '', '', 'wait', null, 'Needs sales and prices'],
      ['Food cost %', '—', '', '', 'wait', null, 'Needs sales and prices'],
      ['7 day average', '—', '', '', 'wait', null, 'Needs food cost'],
      ['Contribution margin', '—', '', '', 'wait', null, 'Needs recipes and other costs'],
      ['Stock value', storeVal > 0 ? lakh(storeVal) : '—', '', '', storeVal > 0 ? 'part' : 'wait', null, storeVal > 0 ? 'Only items that have a price' : 'Needs prices and stock'],
      ['Vendor payables', lakh(owed), overdue > 0 ? `${inr(overdue)} overdue` : 'Nothing overdue', overdue > 0 ? 'dn' : 'up', 'live', null, ''],
      ['Open alerts', String(alerts.length), urgent ? `${urgent} urgent` : '', urgent ? 'dn' : '', 'live', null, '']];
    const kpis = K.map((k) => `<div class="card kpi"><div class="l"><span class="kl">${ic(k[0])}${k[0]}</span>${chip(k[4])}</div><div class="kb"><div><div class="v ${k[1] === '—' ? 'mut' : ''}">${k[1]}</div><div class="d" style="color:${col(k[3])}">${esc(k[2])}</div></div>${k[5] ? spark(k[5], col(k[3]) === 'var(--mut)' ? 'var(--acc)' : col(k[3]), 96, 34) : ''}</div>${k[6] ? `<div class="need">${k[6]}</div>` : ''}</div>`).join('');
    const bigA = [[`Net sales, ${latestLabel}`, hasSales && todayTot > 0 ? inr(todayTot) : 'Waiting', delta != null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% on last ${wk}` : 'Counters only', delta != null && delta < 0 ? 'dn' : ''], ['Food cost', 'Soon', 'Needs sales and prices', ''], ['Owed to vendors', lakh(owed), overdue > 0 ? `${inr(overdue)} overdue` : 'Nothing overdue', overdue > 0 ? 'dn' : ''], ['Open alerts', String(alerts.length), urgent ? `${urgent} urgent` : 'None urgent', urgent ? 'dn' : '']].map((x) => `<div><div class="l">${x[0]}</div><div class="v">${x[1]}</div><div class="d ${x[3]}">${x[2]}</div></div>`).join('');
    const depts = D.map((d, i) => { const [k, l] = lab(d.score); return `<div class="card dept" data-dept="${i}">${ring(d.score, d.score == null ? 'var(--line)' : d.score < 65 ? 'var(--bad)' : d.score < 80 ? 'var(--warn)' : 'var(--good)')}<div><div class="t">${d.name}</div><span class="chip ${k}" style="margin:4px 0 2px">${l}</span><div class="s">${d.sub}</div></div></div>`; }).join('');
    // trend
    const W = 520; const x = (i: number) => 34 + i * (W - 60) / 6; const mx = Math.max(...S, 1); const ys = (v: number) => 150 - (v / mx) * 110;
    const area = S.map((v, i) => `${x(i)},${ys(v)}`).join(' ');
    const dn = days.map((d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }));
    const trend = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acc)" stop-opacity=".28"/><stop offset="1" stop-color="var(--acc)" stop-opacity="0"/></linearGradient></defs>` + [0, 1, 2, 3].map((i) => `<line x1="34" x2="${W - 26}" y1="${30 + i * 40}" y2="${30 + i * 40}" stroke="var(--line)"/>`).join('') + (hasSales ? `<polygon points="34,150 ${area} ${x(6)},150" fill="url(#g)"/><polyline points="${area}" fill="none" stroke="var(--acc)" stroke-width="3" stroke-linejoin="round"/>` : `<text x="${W / 2}" y="95" text-anchor="middle">Waiting for sales</text>`) + dn.map((d, i) => `<text x="${x(i)}" y="176" text-anchor="middle">${d}</text>`).join('') + `<text x="34" y="14">Sales ₹</text><text x="${W - 26}" y="14" text-anchor="end">Food cost %</text>`;
    const tleg = `<span style="color:var(--acc);font-weight:700">■</span> Net sales &nbsp; <span style="color:var(--acc2);font-weight:700">●</span> Food cost % (coming soon). Today is provisional.`;
    // counter sales
    const byLoc = new Map(sales.filter((x2) => x2.business_date === latest).map((r) => [r.location_id, Number(r.amount)]));
    const MAIN: [string, string][] = [['South Indian', 'South Indian'], ['Indian', 'Indian'], ['Snacks', 'Snacks Frozen'], ['Tandoor', 'Tandoor'], ['Continental', 'Continental'], ['Hot Brew', 'Hot Brew'], ['Cold Beverages', 'Cold Beverages']];
    const mStart = today.slice(0, 8) + '01';
    const mSales = sales.filter((x2) => x2.business_date >= mStart);
    const openDays = new Set(mSales.filter((x2) => Number(x2.amount) > 0).map((x2) => x2.business_date)).size;
    const dLab = new Date(latest + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const rows = MAIN.map(([label, loc]) => { const id = counters.find((c) => c.name === loc)?.id ?? -1; const d = byLoc.get(id) ?? 0; const mtd = mSales.filter((x2) => x2.location_id === id).reduce((a, x2) => a + Number(x2.amount), 0); const avg = openDays ? mtd / openDays : 0; return { label, d, mtd, vs: avg > 0 && d > 0 ? (d - avg) / avg * 100 : null }; });
    const tot = rows.reduce((a, r) => a + r.d, 0);
    const vsCell = (x: number | null) => (x == null ? '<span class="mut">—</span>' : `<span style="color:${x >= 0 ? 'var(--good)' : 'var(--bad)'}">${x >= 0 ? '▲' : '▼'} ${Math.abs(x).toFixed(0)}%</span>`);
    const cs = `<tr><th>Counter</th><th class="r">${dLab}</th><th class="r">MTD</th><th class="r">vs average</th><th class="r">Food cost MTD</th></tr>` + rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="r num">${inr(r.d)}</td><td class="r num">${inr(r.mtd)}</td><td class="r">${vsCell(r.vs)}</td><td class="r num mut">—</td></tr>`).join('');
    const csNote = `Net sales before tax. MTD is ${openDays} open ${openDays === 1 ? 'day' : 'days'}. vs average leaves out closed days.`;
    const IND_NAMES = ['Indian', 'South Indian', 'Tandoor', 'Continental', 'Gravy', 'Hot Brew', 'Cold Beverages', 'Pickup Station'];
    const dots = IND_NAMES.map((n) => { const c = counters.find((x) => x.name === n); if (!c) return ''; const r = dotRows.find((d) => d.name === n); const t = stat(c.id, today); const [k, l] = t === 'o' ? ['ok', 'On time'] : t === 'l' ? ['att', 'Late'] : t === 'm' ? ['crit', 'Missed'] : ['wait', 'No indent yet']; const pct = r?.pct ?? null; return `<div class="ir"><span class="n">${esc(n)}</span><span class="chip ${k}">${l}</span><span class="p" style="color:${pct == null ? 'var(--mut)' : pct < 70 ? 'var(--bad)' : pct < 90 ? 'var(--warn)' : 'var(--good)'}">${pct == null ? '—' : pct + '%'}</span></div>`; }).join('');
    const money = ([['Store stock', storeVal > 0 ? lakh(storeVal) : '—', storeVal > 0 ? 'Only items that have a price' : 'Needs prices and stock', storeVal > 0 ? 'part' : 'wait'], ['Counter stock', '—', 'Needs counters to count', 'wait'], ['Open purchase orders', lakh(openVal), `${openPos.length} orders. Not yet an expense`, 'live'], ['Due in 7 days', inr(due7amt), `${due7.length} bills`, 'live'], ['Wastage today', '—', 'Needs wastage entries', 'wait']] as [string, string, string, Tag][]).map((m) => `<div class="card"><div class="sm mut" style="display:flex;justify-content:space-between">${m[0]}${chip(m[3])}</div><div class="v">${m[1]}</div><div class="sm mut">${m[2]}</div></div>`).join('');
    const AL = [
      ...overdueHealth.map((h) => ({ id: '', cls: 'm', t: `Store has not fixed: ${h.title.toLowerCase()}`, b: `Open ${h.age_days + 1} days.` })),
      ...alerts.map((a) => ({ id: a.id, cls: ['urgent', 'critical', 'sos'].includes(a.level) ? 'c' : 'm', t: a.title, b: a.body ?? '' }))];
    const al = AL.length ? AL.map((a) => `<div class="al ${a.cls === 'm' ? 'm' : ''}"><span class="sev"></span><div><b>${esc(a.t)}</b><div class="sm mut">${esc(a.b)}</div></div><div class="go">${a.id ? `<button class="btn p" data-done="${a.id}">Mark done</button>` : ''}</div></div>`).join('') : '<div class="sm mut">Nothing is waiting for you.</div>';
    const head = need ? `${hasSales && delta != null ? (delta >= 0 ? 'Sales are up' : 'Sales are down') + ', and ' : ''}${need} ${need === 1 ? 'thing needs' : 'things need'} you now.` : 'Nothing needs you right now.';
    return { csNote, latestLabel, kpis, bigA, depts, trend, tleg, cs, dots, money, al, head, dim: tot === 0, hasTot: tot > 0 };
  }, [sales, inds, bills, alerts, stock, cost, pos, issues, counters, days, health]);

  const when = (() => { const n = new Date(); const o = { timeZone: 'Asia/Kolkata' } as const; return `${n.toLocaleDateString('en-IN', { weekday: 'long', ...o })} ${n.toLocaleDateString('en-IN', { day: 'numeric', ...o })} ${n.toLocaleDateString('en-IN', { month: 'short', ...o })}, ${n.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, ...o }).replace('am', 'am').replace('pm', 'pm')}`; })();
  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const dep = t.closest('[data-dept]') as HTMLElement | null;
    if (dep) { const d = ((window as unknown as { __depts: Dept[] }).__depts)[Number(dep.dataset.dept)]; setSheet({ title: `${d.name}, how the score is made`, html: d.rows.length ? `<table><tr><th>Measure</th><th class="r">Target</th><th class="r">Result</th></tr>${d.rows.map((r) => `<tr><td>${r[0]}</td><td class="r">${r[1]}</td><td class="r">${r[2]}</td></tr>`).join('')}</table><p class="sm mut" style="margin-top:10px">Only delays this department caused count against it. More measures and reasons follow as the data comes in.</p>` : `<p class="sm mut">${d.sub}. This score starts once that data is coming in.</p>` }); return; }
    const done = t.closest('[data-done]') as HTMLElement | null;
    if (done) void supabase.rpc('finish_alert', { p_id: done.dataset.done }).then(() => loadAlerts());
  };

  return (
    <div className="te" onClick={onClick}>
      <section className="hero a"><div className="hl"><div className="sub">Single Teas, Bilekahalli · {when}</div><h1>{html.head}</h1></div><div className="big4" dangerouslySetInnerHTML={{ __html: html.bigA }} /></section>
      <MonthToDate />
      <div className="sec kpisec"><h2>Key numbers</h2><div className="grid kpis" dangerouslySetInnerHTML={{ __html: html.kpis }} /></div>
      <div className="sec grid dd2">
        <div><h2>Department performance</h2><div className="grid depts" dangerouslySetInnerHTML={{ __html: html.depts }} /></div>
        <div className="indcol"><div className="ih"><h2>Who raised indent on time</h2><span className="sm mut">Last 7 days</span></div><div className="card indcard"><div id="ind" dangerouslySetInnerHTML={{ __html: html.dots }} /></div></div>
      </div>
      <div className="sec grid two">
        <div className="card"><div style={{ display: 'flex', justifyContent: 'space-between' }}><h2>Sales and food cost, last 7 days</h2><span className="chip part">Partial</span></div><svg className="chart" viewBox="0 0 520 190" width="100%" dangerouslySetInnerHTML={{ __html: html.trend }} /><div className="sm mut" dangerouslySetInnerHTML={{ __html: html.tleg }} /></div>
        <div className="card"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Sales by counter</h2><span className={'chip ' + (html.hasTot ? 'part' : 'wait')}>{html.hasTot ? 'Partial' : 'Waiting'}</span></div><table className={'cs' + (html.dim ? ' dim' : '')} dangerouslySetInnerHTML={{ __html: html.cs }} /><div className="sm mut" style={{ marginTop: 8 }}>{html.csNote}</div></div>
      </div>
      <div className="sec"><h2>Money</h2><div className="grid money" dangerouslySetInnerHTML={{ __html: html.money }} /></div>
      <div className="sec"><div className="card"><h2>Needs you now</h2><div dangerouslySetInnerHTML={{ __html: html.al }} /></div></div>
      <div className="sec"><div className="card"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>How much of this is real data</h2><button className="btn" onClick={() => setSheet({ title: 'Data readiness', html: `<table>${[['live', 'Indents, Store issues, Receive, SOS, closing counts, bills, alerts'], ['part', 'Daily sales (by hand), stock value (items with a price), prices'], ['wait', 'Food cost, contribution margin, wastage, counter stock, sales by counter from the POS']].map((r) => `<tr><td>${chip(r[0] as Tag)}</td><td>${r[1]}</td></tr>`).join('')}</table>` })}>See the list</button></div><div className="rd"><i style={{ width: '39%', background: 'var(--good)' }} /><i style={{ width: '26%', background: 'var(--warn)' }} /><i style={{ width: '35%', background: 'var(--line)' }} /></div><div className="sm mut">Green is live, amber is partly there, grey is still waiting.</div></div></div>
      {sheet && <div className="back on" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}><div className="sheet"><div style={{ display: 'flex', justifyContent: 'space-between' }}><h2>{sheet.title}</h2><button className="btn" onClick={() => setSheet(null)}>Close</button></div><div dangerouslySetInnerHTML={{ __html: sheet.html }} /></div></div>}
      <span hidden>{profile?.id}</span>
    </div>
  );
}

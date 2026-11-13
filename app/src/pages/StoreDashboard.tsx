import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty } from '../lib/format';
import { AlertsPanel } from '../components/AlertsPanel';
import { Sheet } from '../components/Sheet';
import { useHealth } from '../components/StoreCheck';
import '../store-dash.css';

interface Dash {
  low_n: number; low: { name: string; unit: string; qty: number; par: number }[]; levels: number;
}
interface Today {
  date: string; sent_n: number; issued_n: number; issued_at: string | null; not_issued: string[];
  waiting_pos: { vendor: string; po: string; due: string }[]; bills: { n: number; detail: string | null };
  counted_today: boolean; last_count: string | null; undecided: number | null; closed: boolean;
}
type Dot = 'y' | 'n' | 'p' | 'h';
interface Day { d: string; served: Dot; right: Dot; deliveries: Dot; decided: Dot; counted: Dot; bills: Dot }
interface Card {
  start: string; days: Day[]; score: number | null; lost: { job: string; times: number; points: number }[]; streak: number;
  items: { item: string; unit: string; counter: string; asked: number; given: number; kind: 'ok' | 'short' | 'over' }[];
}
const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).replace(' am', ' am').replace(' pm', ' pm') : '';
const hourNow = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
const JOB_LABEL: Record<string, string> = {
  served: 'Counters were not given their things', right: 'Counters got less or more than they asked', deliveries: 'Deliveries were not taken in on time',
  decided: 'Ordering was not finished', counted: 'Stock was not counted', bills: 'Bills were not uploaded'
};
const GRID: [keyof Day, string][] = [['served', 'Gave counters their things'], ['right', 'Gave the right amounts'], ['deliveries', 'Took in deliveries'], ['decided', 'Finished ordering'], ['counted', 'Counted the stock'], ['bills', 'Uploaded bills']];
const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

export function StoreDashboard() {
  const { profile } = useSession();
  const { items: health } = useHealth();
  const [d, setD] = useState<Dash | null>(null);
  const [t, setT] = useState<Today | null>(null);
  const [c, setC] = useState<Card | null>(null);
  const [sheet, setSheet] = useState<'ok' | 'short' | 'over' | null>(null);
  const load = useCallback(async () => {
    const [a, b, e] = await Promise.all([supabase.rpc('store_dash'), supabase.rpc('store_today'), supabase.rpc('store_scorecard')]);
    if (a.data) setD(a.data as Dash); if (b.data) setT(b.data as Today); if (e.data) setC(e.data as Card);
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => { if (!document.hidden) void load(); }, 60000);
    const vis = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  const now = new Date();
  const hour = hourNow();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = profile?.full_name?.split(' ')[0] ?? '';
  const stamp = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short' });
  if (!t || !c || !d) return <div className="sd-root"><div className="sd-wrap"><AlertsPanel /></div></div>;

  type St = 'y' | 'n' | 'p';
  interface Job { title: string; st: St; ok: string; skip: string; to: string; btn: string }
  const overdue = t.waiting_pos.filter((p) => p.due < t.date);
  const waitingNames = [...new Set(t.waiting_pos.map((p) => p.vendor))];
  const undec = t.undecided;
  const jobs: Job[] = [
    t.sent_n === 0
      ? { title: 'Give the counters their things', st: 'y', ok: 'No counter has asked for anything today.', skip: '', to: '/issue', btn: 'Give now' }
      : t.issued_n >= t.sent_n
        ? { title: 'Give the counters their things', st: 'y', ok: `Done at ${clock(t.issued_at)}. All ${t.sent_n} counters.`, skip: '', to: '/issue', btn: 'Give now' }
        : { title: 'Give the counters their things', st: hour >= 12 ? 'n' : 'p', ok: '', skip: `Not given yet: ${t.not_issued.join(', ')}. If you do not give them, the counters cannot make their food and drinks.`, to: '/issue', btn: 'Give now' },
    t.waiting_pos.length === 0
      ? { title: "Take in today's deliveries", st: 'y', ok: 'Nothing is waiting to come in.', skip: '', to: '/receive', btn: 'Take in delivery' }
      : { title: "Take in today's deliveries", st: overdue.length ? 'n' : 'p', ok: '', skip: `${waitingNames.slice(0, 3).join(', ')}${waitingNames.length > 3 ? ` and ${waitingNames.length - 3} more` : ''} ${waitingNames.length === 1 ? 'has' : 'have'} not been taken in${overdue.length ? ` (${overdue.length} late)` : ''}. If you do not take it in, the counters wait for it and the vendor bill cannot be checked.`, to: '/receive', btn: 'Take in delivery' },
    t.closed
      ? { title: 'Decide on the items that are not ordered', st: 'y', ok: 'All decided. Ordering is finished.', skip: '', to: '/buying', btn: 'Decide now' }
      : undec == null
        ? { title: 'Decide on the items that are not ordered', st: hour >= 17 ? 'n' : 'p', ok: '', skip: 'Open Buying and decide on each item the counters need. If you do not, the counters will not get them.', to: '/buying', btn: 'Decide now' }
        : undec > 0
          ? { title: 'Decide on the items that are not ordered', st: 'n', ok: '', skip: `${undec} ${undec === 1 ? 'item the counters need is' : 'items the counters need are'} not ordered. Order each one, put it off, or say you will not buy it. Otherwise the counters will not get ${undec === 1 ? 'it' : 'them'}.`, to: '/buying', btn: 'Decide now' }
          : { title: 'Decide on the items that are not ordered', st: 'p', ok: '', skip: "Everything is decided. Press 'Finish today's ordering' on the Buying page.", to: '/buying', btn: 'Finish ordering' },
    t.counted_today
      ? { title: 'Count the stock in the store', st: 'y', ok: 'Counted today.', skip: '', to: '/counts', btn: 'Count now' }
      : { title: 'Count the stock in the store', st: hour >= 17 ? 'n' : 'p', ok: '', skip: 'If you do not count, we do not know what is really in the store. You may buy too much or run out.', to: '/counts', btn: 'Count now' },
    t.bills.n === 0
      ? { title: 'Upload the bill for every delivery', st: 'y', ok: 'Every delivery has its bill.', skip: '', to: '/receive', btn: 'Upload bills' }
      : { title: 'Upload the bill for every delivery', st: 'n', ok: '', skip: `${t.bills.n} ${t.bills.n === 1 ? 'delivery has' : 'deliveries have'} no bill photo. If you do not upload, we cannot pay the vendor the right amount.`, to: '/receive', btn: 'Upload bills' }
  ];
  const left = jobs.filter((j) => j.st !== 'y').length;
  const big = [
    { l: 'Deliveries not taken in yet', v: t.waiting_pos.length, cls: t.waiting_pos.length ? (overdue.length ? 'sd-bad' : 'sd-warn') : 'sd-good', s: t.waiting_pos.length ? (overdue.length ? `${overdue.length} late` : 'Due today') : 'All in', to: '/receive' },
    { l: 'Items not ordered yet', v: t.closed ? 0 : undec == null ? '?' : undec, cls: t.closed || undec === 0 ? 'sd-good' : 'sd-bad', s: t.closed ? 'All decided' : undec == null ? 'Open Buying' : 'Order, put off, or say no', to: '/buying' },
    { l: 'Bills to upload', v: t.bills.n, cls: t.bills.n ? 'sd-warn' : 'sd-good', s: t.bills.n ? 'Deliveries with no bill' : 'All uploaded', to: '/receive' },
    { l: 'Stock counts left', v: t.counted_today ? 0 : 1, cls: t.counted_today ? 'sd-good' : 'sd-warn', s: t.counted_today ? 'Counted today' : 'Not counted today', to: '/counts' }
  ];

  const ok = c.items.filter((i) => i.kind === 'ok').length, sh = c.items.filter((i) => i.kind === 'short'), ov = c.items.filter((i) => i.kind === 'over');
  const total = c.items.length;
  const wins: string[] = [];
  if (t.sent_n > 0 && t.issued_n >= t.sent_n) wins.push(`Counters served by ${clock(t.issued_at)}`);
  if (total > 0 && ok > 0) wins.push(`${ok} of ${total} items exactly right`);
  if (c.streak >= 2) wins.push(`${c.streak} days in a row serving the counters`);
  if (t.counted_today) wins.push('Stock counted today');
  if (t.bills.n === 0) wins.push('Every bill uploaded');
  const msg = left === 0 ? 'A full green day. The counters had everything they needed because of you. Well done.'
    : wins.length === 0 ? `A fresh day. Each job you finish turns a red cross green. ${NUM[left]} to go.`
    : left === 1 ? 'Almost there. Just one job left, and you will have a full green day.'
    : `Good work so far. ${NUM[left]} jobs left to make it a full green day.`;
  const sc = c.score;
  const scCls = sc == null ? '' : sc >= 85 ? 'sd-good' : sc >= 60 ? 'sd-warn' : 'sd-bad';
  const scCol = sc == null ? 'var(--mut)' : sc >= 85 ? 'var(--good)' : sc >= 60 ? 'var(--warn)' : 'var(--bad)';
  const needs = (health ?? []).filter((i) => i.state === 'open');
  const shown = sheet ? c.items.filter((i) => i.kind === sheet) : [];
  const diff = (i: Card['items'][number]) => i.asked > 0 ? `${i.given >= i.asked ? '+' : ''}${Math.round((i.given - i.asked) / i.asked * 100)}%` : 'extra';
  const dayName = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'narrow' });

  return (
    <div className="sd-root"><div className="sd-wrap">
      <AlertsPanel />
      <section className="sd-hero"><div><div className="sd-sub">Single Teas, Bilekahalli · {stamp}</div>
        <h1>{greet}{first ? `, ${first}` : ''}. {left ? `${left} ${left === 1 ? 'job' : 'jobs'} left today.` : 'All jobs are done today.'}</h1></div>
        <div className="sd-big4">
          {big.map((b) => (
            <Link key={b.l} to={b.to}><div className="sd-l">{b.l}</div><div className={`sd-v sd-num ${b.cls}`}>{b.v}</div><div className="sd-d">{b.s}</div></Link>
          ))}
        </div></section>

      <div className="sd-cheer"><b>{msg}</b>{wins.length > 0 && <div className="sd-wins">{wins.map((w) => <span key={w}>{w}</span>)}</div>}</div>

      <div className="sd-sec sd-card"><div className="sd-head"><h2>Your jobs today</h2><span className="sd-sm sd-mut">{jobs.length - left} of {jobs.length} done</span></div>
        {jobs.map((j) => (
          <div className="sd-job" key={j.title}>
            <span className={`sd-tick ${j.st}`}>{j.st === 'y' ? '✓' : j.st === 'p' ? '!' : '×'}</span>
            <div className="sd-jt"><b>{j.title}</b>{j.st === 'y' ? <div className="sd-okt">{j.ok}</div> : <div className="sd-skip">{j.skip}</div>}</div>
            {j.st === 'y' ? <span className="sd-chip sd-ok">Done</span> : <Link to={j.to} className="sd-btn">{j.btn}</Link>}
          </div>))}
      </div>

      <div className="sd-sec sd-cols">
        <div className="sd-stack">
          <div className="sd-card"><div className="sd-head"><h2>Did the counters get what they asked for?</h2><span className="sd-sm sd-mut">Today</span></div>
            {total === 0 ? <div className="sd-sm sd-mut">Nothing has been given out yet today.</div> : <>
              <div className="sd-trio">
                <button onClick={() => setSheet('ok')}><div className="sd-tn sd-num" style={{ color: 'var(--good)' }}>{ok}</div><div className="sd-sm">Got exactly</div></button>
                <button onClick={() => setSheet('short')}><div className="sd-tn sd-num" style={{ color: sh.length ? 'var(--bad)' : 'var(--good)' }}>{sh.length}</div><div className="sd-sm">Got less</div></button>
                <button onClick={() => setSheet('over')}><div className="sd-tn sd-num" style={{ color: ov.length ? 'var(--warn)' : 'var(--good)' }}>{ov.length}</div><div className="sd-sm">Got more</div></button>
              </div>
              {sh.slice(0, 3).map((i) => <div className="sd-line" key={i.item + i.counter}><span className="sd-tag s">Less</span>{i.item}: {i.counter} asked for {fmtQty(i.asked, i.unit)}, you gave {fmtQty(i.given, i.unit)}. That counter may run out.</div>)}
              {ov.slice(0, 2).map((i) => <div className="sd-line" key={i.item + i.counter}><span className="sd-tag o">More</span>{i.item}: {i.counter} asked for {fmtQty(i.asked, i.unit)}, you gave {fmtQty(i.given, i.unit)}. The extra may go bad or sit unused.</div>)}
              <div className="sd-sm sd-mut" style={{ marginTop: 8 }}>Give what the counter asked for. A little more or less (up to 10%) is okay.</div></>}
          </div>
          {needs.length > 0 && <div className="sd-card"><div className="sd-head"><h2>Also waiting for you</h2></div>
            {needs.slice(0, 5).map((n, i) => <Link key={i} to={n.route} className="sd-need" style={{ textDecoration: 'none', color: 'inherit' }}><span className="sd-t"><b>{n.title}</b><span>{n.detail}</span></span></Link>)}</div>}
        </div>
        <div className="sd-stack">
          <div className="sd-card"><div className="sd-head"><h2>Store performance scorecard</h2><span className="sd-sm sd-mut">Last 7 days</span></div>
            {sc == null
              ? <><div className="sd-sm" style={{ marginBottom: 6 }}><b>Your first score comes after today.</b> Today is a fresh start. Every job you finish turns a dot green.</div></>
              : <><div className="sd-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}><div className={`sd-score ${scCls}`} style={{ color: scCol }}>{sc}</div><div className="sd-mut" style={{ marginBottom: 8 }}>out of 100</div></div>
                <div className="sd-bar"><i style={{ width: `${sc}%`, background: scCol }} /></div>
                {c.lost.length > 0 && <div className="sd-sm sd-mut" style={{ marginTop: 8 }}>Where points were lost</div>}
                {c.lost.map((l) => <div className="sd-lost" key={l.job}><span>{JOB_LABEL[l.job]} on {l.times} {l.times === 1 ? 'day' : 'days'}</span><b>-{l.points}</b></div>)}</>}
            <table className="sd-wk"><thead><tr><th>Green is done. Red is missed.</th>{c.days.map((x) => <th key={x.d}>{dayName(x.d)}</th>)}</tr></thead>
              <tbody>{GRID.map(([k, label]) => <tr key={k}><td>{label}</td>{c.days.map((x) => <td key={x.d}><span className={`sd-pip ${x[k]}`} /></td>)}</tr>)}</tbody></table>
            <div className="sd-sm sd-mut" style={{ marginTop: 8 }}>This is the store's score, not one person's. The owner sees the same page.</div>
          </div>
          {d.low_n > 0 && <div className="sd-card"><div className="sd-head"><h2>Running low at the store</h2><Link to="/store-levels" className="sd-link" style={{ textDecoration: 'none' }}>Store levels ›</Link></div>
            {d.low.map((l) => <div key={l.name} className="sd-job" style={{ padding: '6px 0' }}><span className="sd-jt">{l.name}</span><span className="sd-num sd-sm">{fmtQty(l.qty, l.unit)} <span className="sd-mut">of {fmtQty(l.par, l.unit)}</span></span></div>)}</div>}
        </div>
      </div>
      {sheet && <Sheet title={sheet === 'ok' ? 'Got exactly' : sheet === 'short' ? 'Got less' : 'Got more'} onClose={() => setSheet(null)}>
        <p className="sd-sm sd-mut">What the counters asked for and what the store gave.</p>
        <div className="sd-kv sd-sm sd-mut"><span>Item</span><span>Asked</span><span>Gave</span><span>Diff</span></div>
        {shown.map((i) => <div className="sd-kv" key={i.item + i.counter}><span>{i.item}<div className="sd-sm sd-mut">{i.counter}</div></span><span className="sd-num">{fmtQty(i.asked, i.unit)}</span><span className="sd-num">{fmtQty(i.given, i.unit)}</span><span className="sd-num" style={{ color: i.kind === 'short' ? 'var(--bad)' : i.kind === 'over' ? 'var(--warn)' : 'var(--good)' }}>{diff(i)}</span></div>)}
      </Sheet>}
    </div></div>
  );
}

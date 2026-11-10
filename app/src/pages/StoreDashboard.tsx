import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { qty as fmtQty } from '../lib/format';
import { dayLabel } from '../lib/ist';
import { AlertsPanel } from '../components/AlertsPanel';
import { useHealth } from '../components/StoreCheck';
import '../store-dash.css';

interface Dash {
  for_date: string;
  indents: { id: number; name: string; sent_at: string | null; nothing: boolean; issued_at: string | null; state: 'issued' | 'not_issued' | 'nothing' | 'not_started' }[];
  pos: { po: string; vendor: string; items: number; due: string | null; when: string; state: 'waiting' | 'nobill' | 'received'; received_at: string | null }[];
  nobill: { n: number; detail: string | null };
  low_n: number; low: { name: string; unit: string; qty: number; par: number }[];
  total: number; counted14: number; neg: number; levels: number;
  counts: { name: string; done: boolean }[];
}
const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).replace(' am', ' am').replace(' pm', ' pm') : '';
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function StoreDashboard() {
  const { profile } = useSession();
  const { items: health } = useHealth();
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { supabase.rpc('store_dash').then(({ data }) => { if (data) setD(data as Dash); }); }, []);

  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(now));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = profile?.full_name?.split(' ')[0] ?? '';
  const stamp = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

  if (!d) return <div className="sd-root"><div className="sd-wrap"><AlertsPanel /></div></div>;

  const sev = { red: 0, amber: 1, blue: 2 } as const;
  const dot = { red: 'sd-d-red', amber: 'sd-d-amber', blue: 'sd-d-blue' } as const;
  const needs: { sev: 'red' | 'amber' | 'blue'; title: string; detail: string; to: string }[] = [
    ...(health ?? []).filter((i) => i.state === 'open').map((i) => ({ sev: i.sev, title: i.title, detail: i.detail, to: i.route })),
    ...(d.nobill.n > 0 ? [{ sev: 'amber' as const, title: `${d.nobill.n} ${d.nobill.n === 1 ? 'delivery' : 'deliveries'} received, no bill yet`, detail: (d.nobill.detail ?? '').split(', ').slice(0, 3).join(', '), to: '/receive' }] : []),
  ].sort((a, b) => sev[a.sev] - sev[b.sev]);

  const toIssue = d.indents.filter((i) => i.state === 'not_issued').length;
  const sentN = d.indents.filter((i) => i.state !== 'not_started').length;
  const waiting = d.pos.filter((p) => p.state === 'waiting');
  const noBillPos = d.pos.filter((p) => p.state === 'nobill').length;
  const pct = d.total ? Math.min(100, Math.round((d.counted14 / d.total) * 100)) : 0;
  const countsDone = d.counts.filter((c) => c.done).length;
  const cls = (n: number, bad = false) => n > 0 ? (bad ? 'sd-bad' : 'sd-warn') : 'sd-good';
  const today = todayIST();
  const dueText = (p: Dash['pos'][number]) => p.state === 'waiting' ? `${p.po} · ${p.items} ${p.items === 1 ? 'item' : 'items'} · ${p.due && p.due <= today ? (p.due === today ? 'due today' : 'overdue') : p.due ? 'due ' + dayLabel(p.due) : 'waiting'}` : `${p.po} · ${p.items} ${p.items === 1 ? 'item' : 'items'} · received ${clock(p.received_at)}`;
  const showBanner = waiting.length > 0 && hour >= 9 && hour < 18;

  return (
    <div className="sd-root"><div className="sd-wrap">
      <AlertsPanel />
      <section className="sd-hero"><div><div className="sd-sub">Single Teas, Bilekahalli · {stamp}</div>
        <h1>{greet}{first ? `, ${first}` : ''}. {needs.length ? `${needs.length} ${needs.length === 1 ? 'thing needs' : 'things need'} you now.` : 'All clear, nothing needs you.'}</h1></div>
        <div className="sd-big4">
          <Link to="/issue"><div className="sd-l">Indents to issue</div><div className={`sd-v sd-num ${cls(toIssue, true)}`}>{toIssue}</div><div className="sd-d">of {sentN} sent</div></Link>
          <Link to="/receive"><div className="sd-l">Deliveries waiting</div><div className={`sd-v sd-num ${cls(waiting.length)}`}>{waiting.length}</div><div className="sd-d">{waiting.length ? [...new Set(waiting.map((p) => p.vendor))].slice(0, 2).join(', ') : 'all received'}</div></Link>
          <Link to="/store-levels"><div className="sd-l">Running low</div><div className={`sd-v sd-num ${cls(d.low_n)}`}>{d.low_n}</div><div className="sd-d">{d.levels ? 'against Store levels' : 'no Store levels set yet'}</div></Link>
          <Link to="/stockview"><div className="sd-l">Store records up to date</div><div className={`sd-v sd-num ${pct >= 70 ? 'sd-good' : 'sd-warn'}`}>{pct}%</div><div className="sd-d">{d.counted14} of {d.total} counted in 14 days</div></Link>
        </div></section>
      {showBanner && <div className="sd-banner"><span>Reminder. {waiting.length === 1 ? 'One delivery is' : `${waiting.length} deliveries are`} due. Receive {waiting.length === 1 ? 'it' : 'them'} as they arrive so the stock stays right.</span><Link to="/receive"><button>Open Receive goods</button></Link></div>}
      <div className="sd-sec sd-cols">
        <div className="sd-stack">
          <div className="sd-card"><div className="sd-head"><h2>Needs you now</h2><span className="sd-sm sd-mut">{needs.length ? `${needs.length} to do` : ''}</span></div>
            {needs.length === 0 ? <div className="sd-allclear">Everything is issued, received and counted. Nice work.</div> : needs.map((n, i) => (
              <Link key={i} to={n.to} className="sd-need" style={{ textDecoration: 'none', color: 'inherit' }}><span className={`sd-dot ${dot[n.sev]}`} /><span className="sd-t"><b>{n.title}</b><span>{n.detail}</span></span><span className="sd-go">›</span></Link>))}</div>
          <div className="sd-card"><div className="sd-head"><h2>Indents for {dayLabel(d.for_date)}</h2><span className="sd-sm sd-mut">{sentN} of {d.indents.length} sent</span></div>
            {d.indents.map((i) => (
              <div className="sd-ir" key={i.id}><span className="sd-n">{i.name}</span><span className="sd-p">{i.state === 'not_started' ? 'Not sent' : `Sent ${clock(i.sent_at)}`}</span>
                <span className={`sd-chip ${i.state === 'not_issued' ? 'sd-crit' : i.state === 'not_started' ? 'sd-wait' : 'sd-ok'}`}>{i.state === 'issued' ? `Issued ${clock(i.issued_at)}` : i.state === 'not_issued' ? 'Not issued' : i.state === 'nothing' ? 'Nothing needed' : 'Not started'}</span></div>))}</div>
          <div className="sd-card"><div className="sd-head"><h2>Closing counts last night</h2><span className="sd-sm sd-mut">{countsDone} of {d.counts.length} done</span></div>
            <div className="sd-counts">{d.counts.map((c) => <div className="sd-cc" key={c.name}><span>{c.name}</span><span className={`sd-chip ${c.done ? 'sd-ok' : 'sd-att'}`}>{c.done ? 'Done' : 'Missing'}</span></div>)}</div></div>
        </div>
        <div className="sd-stack">
          <div className="sd-card"><div className="sd-head"><h2>Deliveries</h2><span className="sd-sm sd-mut">{(waiting.length ? `${waiting.length} waiting` : 'all received') + (noBillPos ? `, ${noBillPos} no bill` : '')}</span></div>
            {d.pos.length === 0 ? <div className="sd-allclear">No orders out right now.</div> : d.pos.map((p) => (
              <Link key={p.po} to="/receive" className="sd-po" style={{ textDecoration: 'none', color: 'inherit' }}><span className="sd-t">{p.vendor}<span>{dueText(p)}</span></span>
                <span className={`sd-chip ${p.state === 'received' ? 'sd-ok' : 'sd-att'}`}>{p.state === 'waiting' ? 'Waiting' : p.state === 'nobill' ? 'No bill yet' : 'Received'}</span></Link>))}</div>
          <div className="sd-card"><div className="sd-head"><h2>Running low at the Store</h2><Link to="/store-levels" className="sd-link" style={{ textDecoration: 'none' }}>Store levels ›</Link></div>
            {d.low.length === 0 ? <div className="sd-allclear">{d.levels ? 'Nothing is running low.' : 'No Store levels are set yet. Set them on Store levels so Compass can tell you what is running low.'}</div> : d.low.map((l) => (
              <div className="sd-lv" key={l.name}><span>{l.name}</span><span className="sd-num sd-sm">{fmtQty(l.qty, l.unit)} <span className="sd-mut">of {fmtQty(l.par, l.unit)}</span></span><div className="sd-bar"><i className="sd-l" style={{ width: `${Math.max(0, Math.min(100, (l.qty / l.par) * 100))}%` }} /></div></div>))}</div>
          <div className="sd-card"><div className="sd-head"><h2>Store records</h2><Link to="/stockview" className="sd-link" style={{ textDecoration: 'none' }}>Below zero list ›</Link></div>
            <div className="sd-sm" style={{ display: 'grid', gap: 11 }}>
              {([['Counted in the last 14 days', d.counted14, false], ['Below zero, need a count', d.neg, true], ['Items with a Store level', d.levels, false]] as [string, number, boolean][]).map(([l, n, bad]) => (
                <div key={l}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l}</span><span className="sd-num" style={bad ? { color: 'var(--bad)' } : undefined}>{n} of {d.total}</span></div><div className="sd-bar" style={{ marginTop: 5 }}><i style={{ width: `${d.total ? Math.min(100, (n / d.total) * 100) : 0}%`, ...(bad ? { background: 'var(--bad)' } : {}) }} /></div></div>))}
              <div className="sd-mut">A closing count at the Store clears the below zero items. Set levels so Compass can tell you what is running low.</div></div></div>
        </div>
      </div>
    </div></div>
  );
}

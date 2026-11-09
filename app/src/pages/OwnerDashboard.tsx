import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { money } from '../lib/format';
import { AlertsPanel } from '../components/AlertsPanel';
import { useHealth } from '../components/StoreCheck';

const istDate = (off = 0) => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const lakh = (n: number) => (n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : money(n));
type Tag = 'live' | 'part' | 'wait';
const TagChip = ({ t }: { t: Tag }) => <span className={'tag2 ' + t}>{t === 'live' ? 'Live' : t === 'part' ? 'Partial' : 'Waiting'}</span>;
interface Sale { location_id: number; amount: number }
interface Ind { location_id: number; for_date: string; outcome: string | null; late: boolean; status: string }

export function OwnerDashboard() {
  const { profile, locations } = useSession();
  const counters = useMemo(() => locations.filter((l) => l.kind === 'department' && l.active), [locations]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesLW, setSalesLW] = useState(0);
  const [inds, setInds] = useState<Ind[]>([]);
  const [owed, setOwed] = useState(0);
  const [alerts, setAlerts] = useState(0);
  const [priced, setPriced] = useState({ n: 0, total: 0 });
  const [flow, setFlow] = useState({ pos_waiting: 0, issues_unconfirmed: 0, counts_done: 0, counters: 0 });
  const [todo, setTodo] = useState({ reopen: 0, sosAsk: 0, noClose: 0, flagged: 0 });
  const { items: health } = useHealth();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => istDate(i - 6)), []);

  useEffect(() => {
    (async () => {
      const today = istDate(0);
      const [s, slw, ind, bal, al, pb, fl, ro, sa, nc, fg] = await Promise.all([
        supabase.from('daily_sales').select('location_id, amount').eq('business_date', today),
        supabase.from('daily_sales').select('amount').eq('business_date', istDate(-7)),
        supabase.from('indents').select('location_id, for_date, outcome, late, status').gte('for_date', days[0]).lte('for_date', today),
        supabase.from('vendor_bill_balances').select('balance').gt('balance', 0),
        supabase.from('alerts').select('id', { count: 'exact', head: true }).is('done_at', null),
        supabase.from('item_price_book').select('unit_cost'),
        supabase.rpc('flow_status'),
        supabase.from('indent_reopen_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('sos_extra_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.rpc('closing_missing_last_night'),
        supabase.from('vendor_bills').select('id', { count: 'exact', head: true }).like('remarks', '%Check:%'),
      ]);
      setSales((s.data as Sale[]) ?? []);
      setSalesLW(((slw.data as { amount: number }[]) ?? []).reduce((a, x) => a + Number(x.amount), 0));
      setInds((ind.data as Ind[]) ?? []);
      setOwed(((bal.data as { balance: number }[]) ?? []).reduce((a, x) => a + Number(x.balance), 0));
      setAlerts(al.count ?? 0);
      const pr = (pb.data as { unit_cost: number | null }[]) ?? [];
      setPriced({ n: pr.filter((x) => x.unit_cost != null).length, total: pr.length });
      if (fl.data) setFlow(fl.data as typeof flow);
      setTodo({ reopen: ro.count ?? 0, sosAsk: sa.count ?? 0, noClose: ((nc.data as unknown[] | null) ?? []).length, flagged: fg.count ?? 0 });
    })();
  }, [days]);

  const total = sales.reduce((a, x) => a + Number(x.amount), 0);
  const delta = salesLW > 0 ? ((total - salesLW) / salesLW) * 100 : null;
  const byLoc = new Map(sales.map((x) => [x.location_id, Number(x.amount)]));
  const rowsSales = counters.map((c) => ({ id: c.id, name: c.name, amt: byLoc.get(c.id) ?? 0 })).filter((r) => r.amt > 0).sort((a, b) => b.amt - a.amt);
  const stat = (locId: number, d: string) => {
    const x = inds.find((i) => i.location_id === locId && i.for_date === d);
    if (!x) return 'x';
    if (x.outcome === 'missed') return 'm';
    if (x.outcome === 'late' || x.late) return 'l';
    if (x.outcome === 'on_time' || x.outcome === 'nothing') return 'o';
    return 'x';
  };
  const overdue = (health ?? []).filter((h) => h.age_days >= 2);
  const need = overdue.length + (todo.reopen ? 1 : 0) + (todo.sosAsk ? 1 : 0) + (todo.flagged ? 1 : 0);
  const first = profile?.full_name?.split(' ')[0] ?? '';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const Line = ({ to, label, n, bad }: { to: string; label: string; n: string | number; bad?: boolean }) => (
    <Link to={to} className="row needrow" style={{ justifyContent: 'space-between', color: 'inherit', textDecoration: 'none', padding: '8px 10px', margin: '0 -10px', borderRadius: 10 }}>
      <span>{label}</span><span className="row" style={{ gap: 6 }}><span className={'chip ' + (bad ? 'late' : 'done')}>{n}</span><span aria-hidden className="muted">›</span></span>
    </Link>
  );

  return (
    <>
      <section className="hero2">
        <p className="small muted">Single Teas, Bilekahalli · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{greet}{first ? `, ${first}` : ''}. {need ? `${need} ${need === 1 ? 'thing needs' : 'things need'} you now.` : 'Nothing needs you right now.'}</h1>
        <div className="big4">
          <div><span className="l">Net sales today</span><span className="v">{total > 0 ? money(total) : 'Waiting'}</span><span className={'d' + (delta != null && delta < 0 ? ' dn' : '')}>{delta != null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% on last ${new Date().toLocaleDateString('en-IN', { weekday: 'long' })}` : 'Entered by hand for now'}</span></div>
          <div><span className="l">Food cost</span><span className="v muted">Coming soon</span><span className="d" style={{ color: 'var(--ink-3)' }}>Needs sales and prices</span></div>
          <div><span className="l">Owed to vendors</span><span className="v">{lakh(owed)}</span><span className="d" style={{ color: 'var(--ink-3)' }}><Link to="/bills" style={{ color: 'inherit' }}>Open bills</Link></span></div>
          <div><span className="l">Open alerts</span><span className={'v'}>{alerts}</span><span className="d" style={{ color: 'var(--ink-3)' }}>Shown below</span></div>
        </div>
      </section>

      <AlertsPanel />

      <div className="dash2o">
        <section className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><h2>Sales by counter, today</h2><TagChip t={rowsSales.length ? 'part' : 'wait'} /></div>
          {rowsSales.length === 0 ? <p className="small muted">Waiting for today's sales to be entered. Counters will show here, with their share of the day.</p> : (
            <table className="mini"><thead><tr><th>Counter</th><th className="r">Sales</th><th>Share</th></tr></thead><tbody>
              {rowsSales.map((r) => <tr key={r.id}><td>{r.name}</td><td className="r num">{money(r.amt)}</td><td><div className="sb"><i style={{ width: `${Math.round((r.amt / total) * 100)}%` }} /></div></td></tr>)}
            </tbody></table>)}
          <p className="small muted">Food cost per counter comes later, once sales and prices are both in.</p>
        </section>

        <section className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><h2>Money</h2><TagChip t="live" /></div>
          <Line to="/bills" label="Owed to vendors" n={lakh(owed)} bad={owed > 0} />
          <Line to="/receive" label="Orders waiting to be received" n={flow.pos_waiting} bad={flow.pos_waiting > 0} />
          <Line to="/issue" label="Issues not yet confirmed by counters" n={flow.issues_unconfirmed} bad={flow.issues_unconfirmed > 0} />
          <Line to="/buying-setup" label="Items with a price" n={`${priced.n} of ${priced.total}`} bad={priced.n < priced.total} />
        </section>
      </div>

      <section className="card" style={{ display: 'grid', gap: 6 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>Who raised their indent on time</h2><span className="small muted">Last 7 days, oldest to latest</span></div>
        <div className="dots2">
          {counters.map((c) => {
            const st = days.map((d) => stat(c.id, d)); const live = st.filter((x) => x !== 'x'); const pct = live.length ? Math.round((live.filter((x) => x === 'o').length / live.length) * 100) : null;
            return <div className="dr2" key={c.id}><span className="n">{c.name}</span><span className="dd2">{st.map((x, i) => <i key={i} className={x} title={`${days[i]}: ${x === 'o' ? 'On time' : x === 'l' ? 'Late' : x === 'm' ? 'Missed' : 'No indent'}`} />)}</span><span className="p">{pct == null ? '' : pct + '%'}</span></div>;
          })}
        </div>
        <div className="lg2"><span><i className="o" /> On time</span><span><i className="l" /> Late</span><span><i className="m" /> Missed</span><span><i className="x" /> No indent</span></div>
      </section>

      <section className="card" style={{ display: 'grid', gap: 6 }}>
        <h2>Needs you now</h2>
        {need === 0 && <p className="small muted">Nothing is waiting for you.</p>}
        {overdue.map((h) => <Line key={h.key} to={h.route} label={`Store has not fixed: ${h.title.toLowerCase()}`} n={`Day ${h.age_days + 1}`} bad />)}
        {todo.reopen > 0 && <Line to="/indents" label="Indents waiting for you to open" n={todo.reopen} bad />}
        {todo.sosAsk > 0 && <Line to="/sos" label="Counters asking for one more SOS" n={todo.sosAsk} bad />}
        {todo.flagged > 0 && <Line to="/bills" label="Bills waiting for a check" n={todo.flagged} bad />}
        {todo.noClose > 0 && <Line to="/counts" label="Counters with no closing count last night" n={todo.noClose} bad />}
      </section>

      <section className="card" style={{ display: 'grid', gap: 8 }}>
        <h2>How much of this is real data</h2>
        <div className="rd2">
          {([['Indents, issues, receiving, SOS, closing counts', 'live'], ['Vendor bills and what is owed', 'live'], ['Prices (price book is being filled)', 'part'], ['Daily sales (entered by hand)', 'part'], ['Sales by counter from the POS', 'wait'], ['Food cost and recipe costing', 'wait']] as [string, Tag][]).map(([l, t]) => <div key={l} className="row" style={{ justifyContent: 'space-between' }}><span>{l}</span><TagChip t={t} /></div>)}
        </div>
      </section>
    </>
  );
}

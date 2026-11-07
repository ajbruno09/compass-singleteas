import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { money } from '../lib/format';
import { dayLabel } from '../lib/ist';
import { AlertsPanel } from '../components/AlertsPanel';

interface VendorDue { name: string; balance: number; bills: number }

export function Dashboard() {
  const { profile, locations } = useSession();
  const [indents, setIndents] = useState<Record<number, string>>({});
  const [indentDate, setIndentDate] = useState('');
  const [counts, setCounts] = useState({ items: 0, vendors: 0, people: 0, noPhone: 0, noPhoto: 0 });
  const [dues, setDues] = useState<VendorDue[]>([]);
  const [unpaid, setUnpaid] = useState(0);
  const [flagged, setFlagged] = useState(0);
  const [todo, setTodo] = useState({ reopen: 0, sosAsk: 0, missed: 0, late: 0, noClose: 0 });
  const [flow, setFlow] = useState({ pos_waiting: 0, issues_unconfirmed: 0, counts_done: 0, counters: 0 });
  const seesMoney = profile?.role !== 'store';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  useEffect(() => { supabase.rpc('flow_status').then(({ data }) => { if (data) setFlow(data as typeof flow); }); }, []);
  useEffect(() => {
    (async () => {
      const d = await supabase.rpc('indent_for_date');
      if (d.data) {
        setIndentDate(String(d.data));
        const r = await supabase.from('indents').select('location_id, status').eq('for_date', String(d.data));
        setIndents(Object.fromEntries(((r.data as { location_id: number; status: string }[]) ?? []).map((x) => [x.location_id, x.status])));
      }
      if (d.data) {
        const [ro, sa, mi, la, nc] = await Promise.all([
          supabase.from('indent_reopen_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('sos_extra_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('indents').select('id', { count: 'exact', head: true }).eq('for_date', String(d.data)).eq('outcome', 'missed'),
          supabase.from('indents').select('id', { count: 'exact', head: true }).eq('for_date', String(d.data)).eq('late', true),
          supabase.rpc('closing_missing_last_night')
        ]);
        setTodo({ reopen: ro.count ?? 0, sosAsk: sa.count ?? 0, missed: mi.count ?? 0, late: la.count ?? 0, noClose: ((nc.data as unknown[] | null) ?? []).length });
      }
      const [items, vendors, people] = await Promise.all([
        supabase.from('items').select('id, photo_path', { count: 'exact' }).eq('active', true),
        supabase.from('vendors').select('id, phone, whatsapp', { count: 'exact' }).eq('active', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('active', true)
      ]);
      const v = (vendors.data as { phone: string | null; whatsapp: string | null }[]) ?? [];
      const it = (items.data as { photo_path: string | null }[]) ?? [];
      setCounts({ items: items.count ?? 0, vendors: vendors.count ?? 0, people: people.count ?? 0,
        noPhone: v.filter((x) => !x.phone && !x.whatsapp).length, noPhoto: it.filter((x) => !x.photo_path).length });
      if (seesMoney) {
        const { data } = await supabase.from('vendor_bill_balances').select('vendor_name, balance').gt('balance', 0);
        const m = new Map<string, VendorDue>();
        let total = 0;
        for (const r of (data as { vendor_name: string; balance: number }[]) ?? []) {
          const x = m.get(r.vendor_name) ?? { name: r.vendor_name, balance: 0, bills: 0 };
          x.balance += Number(r.balance); x.bills += 1; total += Number(r.balance); m.set(r.vendor_name, x);
        }
        setDues([...m.values()].sort((a, b) => b.balance - a.balance).slice(0, 6));
        setUnpaid(total);
        const f = await supabase.from('vendor_bills').select('id', { count: 'exact', head: true }).like('remarks', '%Check:%');
        setFlagged(f.count ?? 0);
      }
    })();
  }, [seesMoney]);

  const maxDue = dues[0]?.balance || 1;
  const counters = locations.filter((l) => l.kind === 'department' && l.active);
  const state = (id: number) => indents[id];
  const sentN = counters.filter((c) => ['submitted', 'locked'].includes(state(c.id) ?? '')).length;
  const tile = { textDecoration: 'none', color: 'inherit' } as const;
  const rowLink = { justifyContent: 'space-between', color: 'inherit', textDecoration: 'none', padding: '8px 10px', margin: '0 -10px', borderRadius: 10, cursor: 'pointer' } as const;
  const Row = ({ to, label, n, chip }: { to: string; label: string; n: string | number; chip: string }) => (
    <Link to={to} className="row needrow" style={rowLink}><span>{label}</span><span className="row" style={{ gap: 6 }}><span className={'chip ' + chip}>{n}</span><span aria-hidden style={{ color: 'var(--muted, #7A867F)' }}>›</span></span></Link>
  );

  return (
    <>
      <div className="pagehead">
        <div><p className="label">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 style={{ fontSize: 26, lineHeight: '34px' }}>{greet}{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1></div>
      </div>
      <AlertsPanel />
      <div className="grid-tiles">
        <Link to="/vendors" className="card tile" style={tile}><span className="label">Vendors</span><span className="big">{counts.vendors}</span><span className="small" style={{ color: counts.noPhone ? 'var(--warn)' : undefined, fontWeight: counts.noPhone ? 550 : 400 }}>{counts.noPhone ? `${counts.noPhone} without WhatsApp` : 'All reachable'}</span></Link>
        {profile?.role === 'owner' && <Link to="/people" className="card tile" style={tile}><span className="label">People with access</span><span className="big">{counts.people}</span><span className="small muted">Owner, store and counters</span></Link>}
        {seesMoney && <Link to="/bills" className="card tile attn" style={tile}><span className="label" style={{ color: 'var(--warn)' }}>Unpaid to vendors</span><span className="big">{money(unpaid)}</span><span className="small" style={{ color: 'var(--warn)', fontWeight: 550 }}>{flagged > 0 ? `${flagged} bills need a check` : 'Nothing flagged'}</span></Link>}
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        {seesMoney && dues.length > 0 && (
          <section className="tablewrap" style={{ flex: '3 1 520px', minWidth: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}><h2>Largest unpaid vendors</h2><Link to="/bills" className="btn quiet" style={{ minHeight: 28 }}>View all</Link></div>
            <table>
              <thead><tr><th>Vendor</th><th style={{ width: 80 }}>Bills</th><th style={{ width: 200 }}>Share of largest</th><th className="r" style={{ width: 120 }}>Amount</th></tr></thead>
              <tbody>{dues.map((d) => (
                <tr key={d.name}><td style={{ fontWeight: 500 }}>{d.name}</td><td className="num">{d.bills}</td>
                  <td><div style={{ height: 6, borderRadius: 999, background: 'var(--sunken)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round((d.balance / maxDue) * 100)}%`, background: 'var(--brand)', borderRadius: 999 }} /></div></td>
                  <td className="r num" style={{ fontWeight: 550 }}>{money(d.balance)}</td></tr>))}</tbody>
            </table>
          </section>
        )}
        <div className="stack" style={{ flex: '2 1 320px', minWidth: 0 }}>
          <section className="card" style={{ display: 'grid', gap: 10 }}>
            <h2>Needs a look</h2>
            <p className="small muted" style={{ margin: '-4px 0 2px' }}>Tap a line to open it and fix it.</p>
            {(profile?.role === 'owner') && <Row to="/indents" label="Indents waiting for you to open" n={todo.reopen} chip={todo.reopen ? 'late' : 'done'} />}
            {(profile?.role === 'owner') && <Row to="/sos" label="Counters asking for one more SOS" n={todo.sosAsk} chip={todo.sosAsk ? 'late' : 'done'} />}
            {(profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'store') && <Row to="/counts" label="Counters with no closing count last night" n={todo.noClose} chip={todo.noClose ? 'late' : 'done'} />}
            <Row to="/indents" label="Indents missed (closed without sending)" n={todo.missed} chip={todo.missed ? 'late' : 'done'} />
            <Row to="/indents" label="Indents sent late" n={todo.late} chip={todo.late ? 'due' : 'done'} />
            {seesMoney && <Row to="/bills" label="Bills waiting for a check" n={flagged} chip={flagged ? 'late' : 'done'} />}
            <Row to="/receive" label="Orders waiting to be received" n={flow.pos_waiting} chip={flow.pos_waiting ? 'late' : 'done'} />
            <Row to="/issue" label="Issues not yet confirmed by counters" n={flow.issues_unconfirmed} chip={flow.issues_unconfirmed ? 'late' : 'done'} />
            <Row to="/counts" label="Closing counts done today" n={`${flow.counts_done} of ${flow.counters}`} chip={flow.counts_done >= flow.counters && flow.counters > 0 ? 'done' : 'due'} />
            <Row to="/vendors" label="Vendors with no WhatsApp group yet" n={counts.noPhone} chip={counts.noPhone ? 'late' : 'done'} />
          </section>
          {counters.length > 0 && (
            <section className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><h2>Indents {indentDate ? `for ${dayLabel(indentDate)}` : ''}</h2><span className="small muted">{sentN} of {counters.length} sent</span></div>
              {counters.map((c) => {
                const st = state(c.id);
                const sent = st === 'submitted' || st === 'locked';
                return <Link key={c.id} to="/indents" className="row needrow" style={rowLink}><span>{c.name}</span>
                  <span className="row" style={{ gap: 6 }}><span className={'chip ' + (sent ? 'done' : st ? 'late' : 'off')}>{sent ? 'Sent' : st ? 'Open' : 'Not started'}</span><span aria-hidden style={{ color: 'var(--muted, #7A867F)' }}>›</span></span></Link>;
              })}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

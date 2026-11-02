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
  const seesMoney = profile?.role !== 'store';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  useEffect(() => {
    (async () => {
      const d = await supabase.rpc('indent_for_date');
      if (d.data) {
        setIndentDate(String(d.data));
        const r = await supabase.from('indents').select('location_id, status').eq('for_date', String(d.data));
        setIndents(Object.fromEntries(((r.data as { location_id: number; status: string }[]) ?? []).map((x) => [x.location_id, x.status])));
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

  return (
    <>
      <div className="pagehead">
        <div><p className="label">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 style={{ fontSize: 26, lineHeight: '34px' }}>{greet}{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1></div>
      </div>
      <AlertsPanel />
      <div className="grid-tiles">
        <Link to="/items" className="card tile" style={tile}><span className="label">Items</span><span className="big">{counts.items}</span><span className="small muted">{counts.noPhoto ? `${counts.noPhoto} without a photo` : 'All have photos'}</span></Link>
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
            {seesMoney && <Link to="/bills" className="row" style={{ justifyContent: 'space-between', color: 'inherit', textDecoration: 'none' }}><span>Bills waiting for a check</span><span className={'chip ' + (flagged ? 'late' : 'done')}>{flagged}</span></Link>}
            <Link to="/vendors" className="row" style={{ justifyContent: 'space-between', color: 'inherit', textDecoration: 'none' }}><span>Vendors with no WhatsApp group yet</span><span className={'chip ' + (counts.noPhone ? 'late' : 'done')}>{counts.noPhone}</span></Link>
          </section>
          {counters.length > 0 && (
            <section className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><h2>Indents {indentDate ? `for ${dayLabel(indentDate)}` : ''}</h2><span className="small muted">{sentN} of {counters.length} sent</span></div>
              {counters.map((c) => {
                const st = state(c.id);
                const sent = st === 'submitted' || st === 'locked';
                return <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}><span>{c.name}</span>
                  <span className={'chip ' + (sent ? 'done' : st ? 'late' : 'off')}>{sent ? 'Sent' : st ? 'Open' : 'Not started'}</span></div>;
              })}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

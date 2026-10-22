import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { money } from '../lib/format';

interface VendorDue { name: string; balance: number; bills: number }

export function Dashboard() {
  const { profile } = useSession();
  const [counts, setCounts] = useState({ items: 0, vendors: 0, people: 0, noPhone: 0, noPhoto: 0 });
  const [dues, setDues] = useState<VendorDue[]>([]);
  const [unpaid, setUnpaid] = useState(0);
  const [flagged, setFlagged] = useState(0);
  const seesMoney = profile?.role !== 'store';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  useEffect(() => {
    (async () => {
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

  return (
    <>
      <div className="pagehead">
        <div><p className="label">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{greet}{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1></div>
      </div>
      <p className="banner">Compass is being set up. Indents, store issues and closing stock switch on in the next update, once items and staff are loaded.</p>
      <div className="grid-tiles">
        <Link to="/items" className="card tile" style={{ textDecoration: 'none', color: 'inherit' }}><span className="label">Items</span><span className="big">{counts.items}</span><span className="small muted">{counts.noPhoto ? `${counts.noPhoto} without a photo` : 'All have photos'}</span></Link>
        <Link to="/vendors" className="card tile" style={{ textDecoration: 'none', color: 'inherit' }}><span className="label">Vendors</span><span className="big">{counts.vendors}</span><span className="small" style={{ color: counts.noPhone ? 'var(--watch)' : undefined, fontWeight: counts.noPhone ? 700 : 400 }}>{counts.noPhone ? `${counts.noPhone} without WhatsApp` : 'All reachable'}</span></Link>
        {profile?.role === 'owner' && <Link to="/people" className="card tile" style={{ textDecoration: 'none', color: 'inherit' }}><span className="label">People with access</span><span className="big">{counts.people}</span></Link>}
        {seesMoney && <Link to="/bills" className="card tile" style={{ textDecoration: 'none', color: 'inherit', background: 'var(--turmeric-tint)', borderColor: 'var(--turmeric)' }}><span className="label" style={{ color: 'var(--ink)' }}>Unpaid to vendors</span><span className="big">{money(unpaid)}</span>{flagged > 0 && <span className="small" style={{ fontWeight: 700 }}>{flagged} bills need a check</span>}</Link>}
      </div>
      {seesMoney && dues.length > 0 && (
        <section className="card" style={{ display: 'grid', gap: 10 }}>
          <h2>Largest unpaid vendors</h2>
          {dues.map((d) => (
            <div key={d.name} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{d.name} <span className="small muted">· {d.bills} bills</span></span><span className="num">{money(d.balance)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

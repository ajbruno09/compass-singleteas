import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { money, errText } from '../lib/format';
import type { Vendor } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface Totals { vendor_id: string; billed: number; balance: number; bills: number }

export function Vendors() {
  const { profile } = useSession();
  const [rows, setRows] = useState<Vendor[]>([]);
  const [totals, setTotals] = useState<Record<string, Totals>>({});
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [q, setQ] = useState('');
  const canEdit = profile?.role === 'owner' || profile?.role === 'accounts';
  const seesMoney = profile?.role !== 'store';

  async function load() {
    const { data } = await supabase.from('vendors').select('*').order('name');
    setRows((data as Vendor[]) ?? []);
    if (seesMoney) {
      const { data: b } = await supabase.from('vendor_bill_balances').select('vendor_id, amount, balance, status');
      const t: Record<string, Totals> = {};
      for (const r of (b as { vendor_id: string; amount: number; balance: number; status: string }[]) ?? []) {
        if (r.status === 'cancelled') continue;
        const x = (t[r.vendor_id] ??= { vendor_id: r.vendor_id, billed: 0, balance: 0, bills: 0 });
        x.billed += Number(r.amount); x.balance += Number(r.balance); x.bills += 1;
      }
      setTotals(t);
    }
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const missingPhone = rows.filter((r) => r.active && !(r.whatsapp || r.phone)).length;

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Masters</p><h1>Vendors</h1></div>
        {canEdit && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add vendor</button>}
      </div>
      {missingPhone > 0 && <p className="banner warn">{missingPhone} active vendors have no WhatsApp number. Add them so POs can be sent in one tap.</p>}
      <input id="vendor-search" placeholder="Search vendors" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Vendor</th><th>WhatsApp</th><th>Credit days</th>{seesMoney && <><th className="r">Bills</th><th className="r">Billed</th><th className="r">Unpaid</th></>}</tr></thead>
          <tbody>
            {shown.map((v) => {
              const t = totals[v.id];
              return (
                <tr key={v.id} className={canEdit ? 'click' : ''} onClick={() => canEdit && setEditing(v)}>
                  <td><strong>{v.name}</strong>{!v.active && <span className="chip off" style={{ marginLeft: 8 }}>Inactive</span>}{v.category && <div className="small muted">{v.category}</div>}</td>
                  <td className="num small">{v.whatsapp || v.phone || <span className="chip late">Missing</span>}</td>
                  <td className="num">{v.credit_days ?? '—'}</td>
                  {seesMoney && <><td className="r num">{t?.bills ?? 0}</td><td className="r num">{money(t?.billed ?? 0)}</td>
                    <td className="r num" style={{ color: (t?.balance ?? 0) > 0 ? 'var(--watch)' : undefined, fontWeight: (t?.balance ?? 0) > 0 ? 700 : 400 }}>{money(t?.balance ?? 0)}</td></>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No vendors yet.</p>}
      </div>
      {editing && <VendorForm vendor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

const FIELDS: [keyof Vendor, string, string?][] = [
  ['name', 'Name'], ['category', 'What they supply'], ['contact_person', 'Contact person'], ['whatsapp', 'WhatsApp number', 'tel'],
  ['phone', 'Phone', 'tel'], ['email', 'Email', 'email'], ['address', 'Address'], ['gst', 'GST number'], ['credit_days', 'Credit days', 'number'],
  ['bank_name', 'Bank'], ['bank_account', 'Account number'], ['ifsc', 'IFSC'], ['upi', 'UPI ID'], ['code', 'Vendor code']
];

function VendorForm({ vendor, onClose, onSaved }: { vendor: Vendor | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, vendor?.[k] == null ? '' : String(vendor[k])])));
  const [active, setActive] = useState(vendor?.active ?? true);
  const [remarks, setRemarks] = useState(vendor?.remarks ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    if (!v.name.trim()) return setError('Give the vendor a name.');
    if (v.whatsapp && !/^\+?[0-9 ]{10,15}$/.test(v.whatsapp)) return setError('WhatsApp number should be 10 digits, or with +91.');
    setBusy(true);
    try {
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.trim() === '' ? null : val.trim()]));
      body.credit_days = v.credit_days ? Number(v.credit_days) : null;
      body.active = active; body.remarks = remarks;
      const res = vendor ? await supabase.from('vendors').update(body).eq('id', vendor.id) : await supabase.from('vendors').insert(body);
      if (res.error) throw res.error;
      toast(vendor ? 'Vendor saved' : 'Vendor added');
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet title={vendor ? vendor.name : 'Add vendor'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save vendor'}</button></>}>
      <div className="form-grid">
        {FIELDS.map(([k, label, type]) => (
          <label key={k} className="field"><span>{label}</span>
            <input id={`vendor-${k}`} type={type === 'number' ? 'text' : type ?? 'text'} inputMode={type === 'number' || type === 'tel' ? 'numeric' : undefined}
              value={v[k]} onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value }))} /></label>
        ))}
      </div>
      <label className="field"><span>Remarks</span><textarea id="vendor-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}

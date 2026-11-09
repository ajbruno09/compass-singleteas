import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { money, errText } from '../lib/format';
import type { Vendor } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { photoUrl } from '../lib/masters';

async function qrUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from('vendor-qr').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
void photoUrl;

interface Totals { vendor_id: string; billed: number; balance: number; bills: number }

export function Vendors() {
  const { profile } = useSession();
  const [rows, setRows] = useState<Vendor[]>([]);
  const [totals, setTotals] = useState<Record<string, Totals>>({});
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [paying, setPaying] = useState<Vendor | null>(null);
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [removing, setRemoving] = useState<Vendor | null>(null);
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

  const shown = useMemo(() => rows.filter((r) => (showOff || r.active) && r.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, q, showOff]);
  const offCount = rows.filter((r) => !r.active).length;
  async function bringBack(v: Vendor) { const { error } = await supabase.from('vendors').update({ active: true }).eq('id', v.id); if (error) alert(errText(error)); else void load(); }
  const missingPhone = rows.filter((r) => r.active && r.sends_po_whatsapp !== false && !(r.whatsapp || r.phone)).length;

  return (
    <>
      <div className="pagehead">
        <div><p className="label">Masters</p><h1>Vendors</h1></div>
        {canEdit && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add vendor</button>}
      </div>
      {missingPhone > 0 && <p className="banner warn">{missingPhone} active vendors have no WhatsApp number. Add them so POs can be sent in one tap.</p>}
      <div className="row" style={{ gap: 12 }}>
        <input id="vendor-search" placeholder="Search vendors" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        {offCount > 0 && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Show removed vendors ({offCount})</label>}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Vendor</th><th>WhatsApp</th><th>Credit days</th>{canEdit && <th style={{ width: 210 }} />}{seesMoney && <><th className="r">Bills</th><th className="r">Billed</th><th className="r">Unpaid</th></>}</tr></thead>
          <tbody>
            {shown.map((v) => {
              const t = totals[v.id];
              return (
                <tr key={v.id} className={canEdit ? 'click' : ''} onClick={() => canEdit && setEditing(v)}>
                  <td><strong>{v.name}</strong>{!v.active && <span className="chip off" style={{ marginLeft: 8 }}>Removed</span>}{v.code && <span className="small muted" style={{ marginLeft: 8 }}>{v.code}</span>}{v.category && <div className="small muted">{v.category}</div>}</td>
                  <td className="num small">{v.whatsapp || v.phone || (v.sends_po_whatsapp === false ? <span className="muted small">Not by WhatsApp</span> : <span className="chip late">Missing</span>)}</td>
                  <td className="num">{v.credit_days ?? '—'}</td>
                  {canEdit && <td onClick={(e) => e.stopPropagation()}><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn quiet" onClick={() => setEditing(v)}>Edit</button>{v.active ? <><button className="btn quiet" onClick={() => setPaying(v)}>Pay</button><button className="btn quiet" onClick={() => setRemoving(v)}>Remove</button></> : <button className="btn quiet" onClick={() => void bringBack(v)}>Bring back</button>}</div></td>}
                  {seesMoney && <><td className="r num">{t?.bills ?? 0}</td><td className="r num">{money(t?.billed ?? 0)}</td>
                    <td className="r num" style={{ color: (t?.balance ?? 0) > 0 ? 'var(--watch)' : undefined, fontWeight: (t?.balance ?? 0) > 0 ? 700 : 400 }}>{money(t?.balance ?? 0)}</td></>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No vendors yet.</p>}
      </div>
      {removing && <RemoveSheet vendor={removing} unpaid={totals[removing.id]?.balance ?? 0} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); void load(); }} />}
      {paying && <PaySheet vendor={paying} onClose={() => setPaying(null)} onEdit={() => { setEditing(paying); setPaying(null); }} />}
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
  const [wa, setWa] = useState(vendor?.sends_po_whatsapp ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPrev, setQrPrev] = useState<string | null>(null);
  useEffect(() => { void qrUrl(vendor?.qr_path).then(setQrPrev); }, [vendor]);

  async function save() {
    setError('');
    if (!v.name.trim()) return setError('Give the vendor a name.');
    if (wa && !v.whatsapp.trim()) return setError('Add the WhatsApp number, or switch off "Send POs on WhatsApp" for this vendor.');
    if (v.whatsapp && !/^\+?[0-9 ]{10,15}$/.test(v.whatsapp)) return setError('WhatsApp number should be 10 digits, or with +91.');
    setBusy(true);
    try {
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.trim() === '' ? null : val.trim()]));
      body.credit_days = v.credit_days ? Number(v.credit_days) : null;
      body.active = active; body.remarks = remarks; body.sends_po_whatsapp = wa;
      const res = vendor ? await supabase.from('vendors').update(body).eq('id', vendor.id).select('id').single() : await supabase.from('vendors').insert(body).select('id').single();
      if (res.error) throw res.error;
      if (qrFile) {
        const vid = (res.data as { id: string }).id;
        const path = `${vid}/${Date.now()}.${(qrFile.name.split('.').pop() || 'png').toLowerCase()}`;
        const up = await supabase.storage.from('vendor-qr').upload(path, qrFile, { upsert: true });
        if (up.error) throw up.error;
        const u2 = await supabase.from('vendors').update({ qr_path: path }).eq('id', vid);
        if (u2.error) throw u2.error;
      }
      toast(vendor ? 'Vendor saved' : 'Vendor added');
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet title={vendor ? vendor.name : 'Add vendor'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save vendor'}</button></>}>
      <label className="row" style={{ gap: 10, fontWeight: 600 }}><input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} />Send POs to this vendor on WhatsApp</label>
      {!wa && <p className="small muted" style={{ margin: 0 }}>This vendor is ordered another way (app, shop, in house). No WhatsApp number or payment details are needed.</p>}
      <div className="form-grid">
        {FIELDS.filter(([k]) => wa || !['whatsapp', 'bank_name', 'bank_account', 'ifsc', 'upi'].includes(k)).map(([k, label, type]) => (
          <label key={k} className="field"><span>{label}</span>
            <input id={`vendor-${k}`} type={type === 'number' ? 'text' : type ?? 'text'} inputMode={type === 'number' || type === 'tel' ? 'numeric' : undefined}
              value={v[k]} onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value }))} /></label>
        ))}
      </div>
      {wa && <fieldset className="card" style={{ display: 'grid', gap: 10 }}>
        <legend className="label">Payment QR code</legend>
        <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div style={{ width: 120, height: 120, borderRadius: 10, background: 'var(--surface-200)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>{qrPrev ? <img src={qrPrev} alt="Payment QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Icon name="camera" size={30} />}</div>
          <label className="field" style={{ flex: 1 }}><span>Upload the vendor's QR image</span><input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; setQrFile(f); if (f) setQrPrev(URL.createObjectURL(f)); }} /><span className="small muted">A screenshot of their UPI QR works. It shows large when you tap Pay, so you can scan it.</span></label>
        </div>
      </fieldset>}
      <label className="field"><span>Remarks</span><textarea id="vendor-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
      {error && <p className="banner bad" role="alert">{error}</p>}
    </Sheet>
  );
}

function PaySheet({ vendor, onClose, onEdit }: { vendor: Vendor; onClose: () => void; onEdit: () => void }) {
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { void qrUrl(vendor.qr_path).then(setQr); }, [vendor]);
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => toast('Copied')); };
  const rows: [string, string | null][] = [['UPI ID', vendor.upi], ['Bank', vendor.bank_name], ['Account number', vendor.bank_account], ['IFSC', vendor.ifsc], ['Phone', vendor.phone || vendor.whatsapp]];
  return (
    <Sheet title={`Pay ${vendor.name}`} onClose={onClose} footer={<button className="btn secondary" onClick={onEdit}>Edit vendor</button>}>
      {qr ? <div style={{ display: 'grid', placeItems: 'center' }}><img src={qr} alt="Payment QR" style={{ width: 'min(320px, 100%)', background: '#fff', padding: 8, borderRadius: 12 }} /></div> : <p className="banner warn">No QR uploaded yet. Tap Edit vendor to add the QR image.</p>}
      <div className="stack">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{k}</span><span className="row" style={{ gap: 6 }}><b className="num">{v}</b><button className="btn quiet" onClick={() => copy(v!)}>Copy</button></span></div>)}</div>
    </Sheet>
  );
}

function RemoveSheet({ vendor, unpaid, onClose, onDone }: { vendor: Vendor; unpaid: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [n, setN] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('items').select('id', { count: 'exact', head: true }).eq('default_vendor_id', vendor.id).eq('active', true).then(({ count }) => setN(count ?? 0)); }, [vendor.id]);
  async function go() {
    setBusy(true);
    const { error } = await supabase.from('vendors').update({ active: false }).eq('id', vendor.id);
    setBusy(false);
    if (error) return toast(errText(error));
    toast(`${vendor.name} removed. You can bring them back any time.`); onDone();
  }
  return (
    <Sheet title={`Remove ${vendor.name}?`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Keep vendor</button><button className="btn primary" disabled={busy || n === null} onClick={go}>{busy ? 'Removing…' : 'Remove vendor'}</button></>}>
      <p>They will no longer show when ordering. Their past orders, bills and payments stay exactly as they are, and you can bring them back from this page.</p>
      {n !== null && n > 0 && <p className="banner warn">{n} item{n === 1 ? '' : 's'} still use {vendor.name} as the usual vendor. Pick another usual vendor for them in Buying.</p>}
      {unpaid > 0 && <p className="banner warn">There is still {money(unpaid)} unpaid to this vendor. It stays on record.</p>}
    </Sheet>
  );
}

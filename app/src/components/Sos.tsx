import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { timeOf } from '../lib/ist';
import { SOS_AFTER_SECONDS, type Contact, type DeptItem, type Location, type SosAlert } from '../lib/types';
import { useToast } from './Toast';
import { Sheet } from './Sheet';
import { Icon } from './Icon';

const QUICK_NOTES = ['Finished', 'Almost over', 'Need it now', 'Wrong item came'];

// The red SOS button on a counter's phone: "I need something right now".
export function SosButton({ locations, defaultId }: { locations: Location[]; defaultId?: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [alert, setAlert] = useState<SosAlert | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [now, setNow] = useState(Date.now());
  const ids = locations.map((l) => l.id);
  const key = ids.join(',');

  const refresh = useCallback(async () => {
    if (!ids.length) return;
    const { data } = await supabase.from('sos_alerts').select('*').in('location_id', ids).is('resolved_at', null).order('created_at', { ascending: false }).limit(1);
    setAlert(((data as SosAlert[]) ?? [])[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void refresh();
    const ch = supabase.channel(`sos-mine-${key}`).on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => { void refresh(); }).subscribe();
    const poll = window.setInterval(() => { void refresh(); }, 15000);
    const tick = window.setInterval(() => setNow(Date.now()), 5000);
    return () => { void supabase.removeChannel(ch); window.clearInterval(poll); window.clearInterval(tick); };
  }, [key, refresh]);

  useEffect(() => { if (open) supabase.rpc('sos_contacts').then(({ data }) => setContacts((data as Contact[]) ?? [])); }, [open]);

  return (
    <>
      <button className={'sosfab' + (alert ? ' live' : '')} onClick={() => setOpen(true)} aria-label="SOS, I need something right now">
        <Icon name="bell" size={22} /> SOS
      </button>
      {open && (
        <Sheet title={alert ? 'Your SOS' : 'Need something right now?'} onClose={() => setOpen(false)}>
          {alert
            ? <Status alert={alert} contacts={contacts} now={now} onDone={() => { setAlert(null); setOpen(false); }} />
            : <Form locations={locations} defaultId={defaultId ?? ids[0]} onSent={(a) => { setAlert(a); toast('SOS sent to the store'); }} />}
        </Sheet>
      )}
    </>
  );
}

function Form({ locations, defaultId, onSent }: { locations: Location[]; defaultId: number; onSent: (a: SosAlert) => void }) {
  const toast = useToast();
  const [locationId, setLocationId] = useState(defaultId);
  const [items, setItems] = useState<DeptItem[]>([]);
  useEffect(() => { setItem(null); supabase.rpc('department_items', { p_location_id: locationId }).then(({ data }) => setItems((data as DeptItem[]) ?? [])); }, [locationId]);
  const [q, setQ] = useState('');
  const [item, setItem] = useState<DeptItem | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const found = useMemo(() => { const t = q.trim().toLowerCase(); return t ? items.filter((i) => i.name.toLowerCase().includes(t)).slice(0, 6) : []; }, [q, items]);
  async function send() {
    setBusy(true);
    const { data, error } = await supabase.rpc('raise_sos', { p_location_id: locationId, p_item_id: item?.id ?? null, p_note: note });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    onSent(data as SosAlert);
  }
  return (
    <>
      <p className="muted">This makes a loud alarm on the store phone. Use it only when you really cannot wait.</p>
      {locations.length > 1 && (
        <div className="seg" role="group" aria-label="Which counter">{locations.map((l) => <button key={l.id} aria-pressed={l.id === locationId} onClick={() => setLocationId(l.id)}>{l.name}</button>)}</div>
      )}
      {item ? (
        <div className="card row" style={{ justifyContent: 'space-between' }}><b>{item.name}</b><button className="btn quiet" onClick={() => setItem(null)}>Change</button></div>
      ) : (
        <div className="stack">
          <label className="field"><span>Which item? (you can skip this)</span>
            <div className="searchbox"><Icon name="search" size={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a few letters" /></div>
          </label>
          {found.map((i) => <button key={i.id} className="btn secondary" style={{ justifyContent: 'flex-start' }} onClick={() => { setItem(i); setQ(''); }}>{i.name}</button>)}
        </div>
      )}
      <div className="seg">{QUICK_NOTES.map((n) => <button key={n} aria-pressed={note === n} onClick={() => setNote(note === n ? '' : n)}>{n}</button>)}</div>
      <label className="field"><span>Anything else to tell the store?</span><input value={QUICK_NOTES.includes(note) ? '' : note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
      <button className="btn floor sosgo" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send SOS to the store'}</button>
    </>
  );
}

function Status({ alert, contacts, now, onDone }: { alert: SosAlert; contacts: Contact[]; now: number; onDone: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<DeptItem[]>([]);
  useEffect(() => { supabase.rpc('department_items', { p_location_id: alert.location_id }).then(({ data }) => setItems((data as DeptItem[]) ?? [])); }, [alert.location_id]);
  const waited = Math.floor((now - new Date(alert.created_at).getTime()) / 1000);
  const escalated = !alert.acked_at && waited >= SOS_AFTER_SECONDS;
  const item = items.find((i) => i.id === alert.item_id);
  async function done() {
    const { error } = await supabase.rpc('resolve_sos', { p_id: alert.id });
    if (error) { toast(errText(error)); return; }
    onDone();
  }
  return (
    <>
      <div className="card stack">
        <p><b>{item?.name ?? 'Request'}</b>{alert.note ? <span className="muted"> · {alert.note}</span> : null}</p>
        <p className="small muted">Sent at {timeOf(alert.created_at)}</p>
      </div>
      {alert.acked_at
        ? <p className="banner ok">The store is on it{alert.eta_minutes ? `. About ${alert.eta_minutes} minutes.` : '.'}</p>
        : escalated
          ? <p className="banner bad">No answer from the store yet. The owner is being alerted too. You can also call.</p>
          : <p className="banner warn">Waiting for the store to answer…</p>}
      {!alert.acked_at && escalated && (
        <div className="stack">
          {contacts.map((c) => <a key={c.phone} className="btn secondary floor" href={`tel:+91${c.phone}`}><Icon name="phone" /> Call {c.full_name}</a>)}
        </div>
      )}
      <button className="btn secondary floor" onClick={() => void done()}>{alert.acked_at ? 'I got it, close this' : 'Cancel, no longer needed'}</button>
    </>
  );
}

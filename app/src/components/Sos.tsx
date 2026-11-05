import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { timeOf } from '../lib/ist';
import { SOS_AFTER_SECONDS, type Contact, type DeptItem, type Location, type SosAlert } from '../lib/types';
import { useToast } from './Toast';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { useLang } from '../lib/i18n';

const QUICK_NOTES = ['Finished', 'Almost over', 'Need it now', 'Wrong item came'];

// The red SOS button on a counter's phone: "I need something right now".
export function SosButton({ locations, defaultId }: { locations: Location[]; defaultId?: number }) {
  const toast = useToast();
  const { t } = useLang();
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
        <Icon name="bell" size={22} /> {t('SOS')}
      </button>
      {open && (
        <Sheet title={alert ? t('Your SOS') : t('Need something right now?')} onClose={() => setOpen(false)}>
          {alert
            ? <Status alert={alert} contacts={contacts} now={now} onDone={() => { setAlert(null); setOpen(false); }} />
            : <Form contacts={contacts} locations={locations} defaultId={defaultId ?? ids[0]} onSent={(a) => { setAlert(a); toast(t('SOS sent to the store')); }} />}
        </Sheet>
      )}
    </>
  );
}

const MAX_ITEMS = 3;

function Form({ contacts, locations, defaultId, onSent }: { contacts: Contact[]; locations: Location[]; defaultId: number; onSent: (a: SosAlert) => void }) {
  const toast = useToast();
  const { t, local } = useLang();
  const nm = (i: DeptItem) => (local && i.local_names?.hi) || i.name;
  const [locationId, setLocationId] = useState(defaultId);
  const [items, setItems] = useState<DeptItem[]>([]);
  useEffect(() => { supabase.rpc('department_items', { p_location_id: locationId }).then(({ data }) => setItems((data as DeptItem[]) ?? [])); }, [locationId]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<(DeptItem & { loc: number })[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => { setLeft(null); supabase.rpc('sos_left', { p_location_id: locationId }).then(({ data }) => setLeft(typeof data === 'number' ? data : null)); }, [locationId]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const recentKey = `compass-sos-recent-${locationId}`;
  const recent = useMemo(() => { try { const ids: number[] = JSON.parse(localStorage.getItem(recentKey) ?? '[]'); return ids.map((id) => items.find((i) => i.id === id)).filter((x): x is DeptItem => !!x).slice(0, 6); } catch { return []; } }, [items, recentKey]);
  const found = useMemo(() => { const t = q.trim().toLowerCase(); return t ? items.filter((i) => i.name.toLowerCase().includes(t) || (i.local_names?.hi ?? '').includes(t)).slice(0, 8) : []; }, [q, items]);
  function choose(i: DeptItem) { setPicked((p) => (p.length >= MAX_ITEMS || p.some((x) => x.id === i.id) ? p : [...p, { ...i, loc: locationId }])); setQ(''); }
  async function send() {
    setBusy(true);
    const { data, error } = await supabase.rpc('raise_sos', { p_location_id: picked[0]?.loc ?? locationId, p_item_ids: picked.map((i) => i.id), p_note: note });
    setBusy(false);
    if (error) { toast(errText(error)); return; }
    try { const ids: number[] = JSON.parse(localStorage.getItem(recentKey) ?? '[]'); if (picked.length) localStorage.setItem(recentKey, JSON.stringify([...picked.map((i) => i.id), ...ids.filter((x) => !picked.some((i) => i.id === x))].slice(0, 8))); } catch { /* ignore */ }
    onSent(data as SosAlert);
  }
  if (left === 0) {
    return (
      <>
        <p className="banner warn">{t('You have used all your SOS for today. Please call the store or Admin.')}</p>
        <div className="stack">{contacts.map((c) => <a key={c.phone} className="btn secondary floor" href={`tel:+91${c.phone}`}><Icon name="phone" /> {t('Call {name}', { name: c.full_name })}</a>)}</div>
      </>
    );
  }
  return (
    <>
      <p className="muted">{t('This makes a loud alarm on the store phone. Use it only when you really cannot wait.')}</p>
      {locations.length > 1 && (
        <div className="seg" role="group" aria-label="Which counter">{locations.map((l) => <button key={l.id} aria-pressed={l.id === locationId} onClick={() => setLocationId(l.id)}>{l.name}</button>)}</div>
      )}
      {picked.length > 0 && (
        <div className="chips" aria-label={t('Chosen items')}>
          {picked.map((i) => <button key={i.id} className="btn secondary" onClick={() => setPicked(picked.filter((x) => x.id !== i.id))} aria-label={`${t('Remove')} ${nm(i)}`}>{nm(i)}{locations.length > 1 ? ` · ${locations.find((l) => l.id === i.loc)?.name ?? ''}` : ''} ✕</button>)}
        </div>
      )}
      {picked.length < MAX_ITEMS ? (
        <div className="stack">
          <label className="field"><span>{picked.length ? t('Add another item (up to 3)') : t('Which items? (up to 3, you can skip this)')}</span>
            <div className="searchbox"><Icon name="search" size={18} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) choose(found[0]); }} placeholder={t('Type a few letters')} /></div>
          </label>
          {!q && recent.length > 0 && <div className="chips" aria-label={t('Often needed')}>{recent.filter((i) => !picked.some((x) => x.id === i.id)).map((i) => <button key={i.id} className="btn secondary" onClick={() => choose(i)}>{nm(i)}</button>)}</div>}
          {found.filter((i) => !picked.some((x) => x.id === i.id)).map((i) => <button key={i.id} className="btn secondary" style={{ justifyContent: 'flex-start' }} onClick={() => choose(i)}>{nm(i)}</button>)}
        </div>
      ) : <p className="small muted">{t('That is 3 items, the most for one SOS.')}</p>}
      <div className="seg">{QUICK_NOTES.map((n) => <button key={n} aria-pressed={note === n} onClick={() => setNote(note === n ? '' : n)}>{t(n)}</button>)}</div>
      <label className="field"><span>{t('Anything else to tell the store?')}</span><input value={QUICK_NOTES.includes(note) ? '' : note} onChange={(e) => setNote(e.target.value)} placeholder={t('Optional')} /></label>
      {left != null && left <= 2 && <p className="small muted">{left === 1 ? t('This is your last SOS for today.') : t('{n} SOS left today', { n: left })}</p>}
      <button className="btn floor sosgo" disabled={busy} onClick={() => void send()}>{busy ? t('Sending…') : t('Send SOS to the store')}</button>
    </>
  );
}

function Status({ alert, contacts, now, onDone }: { alert: SosAlert; contacts: Contact[]; now: number; onDone: () => void }) {
  const toast = useToast();
  const { t, local } = useLang();
  const [items, setItems] = useState<DeptItem[]>([]);
  useEffect(() => { supabase.rpc('department_items', { p_location_id: alert.location_id }).then(({ data }) => setItems((data as DeptItem[]) ?? [])); }, [alert.location_id]);
  const waited = Math.floor((now - new Date(alert.created_at).getTime()) / 1000);
  const escalated = !alert.acked_at && waited >= SOS_AFTER_SECONDS;
  const wanted = (alert.item_ids && alert.item_ids.length ? alert.item_ids : alert.item_id != null ? [alert.item_id] : []).map((id) => items.find((i) => i.id === id)).filter((x): x is DeptItem => !!x);
  const label = wanted.map((i) => (local && i.local_names?.hi) || i.name).join(', ');
  async function done() {
    const { error } = await supabase.rpc('resolve_sos', { p_id: alert.id });
    if (error) { toast(errText(error)); return; }
    onDone();
  }
  return (
    <>
      <div className="card stack">
        <p><b>{label || t('Request')}</b>{alert.note ? <span className="muted"> · {alert.note}</span> : null}</p>
        <p className="small muted">{t('Sent at {time}', { time: timeOf(alert.created_at) })}</p>
      </div>
      {alert.acked_at
        ? <p className="banner ok">{alert.eta_minutes ? t('The store is on it. About {n} minutes.', { n: alert.eta_minutes }) : t('The store is on it.')}</p>
        : escalated
          ? <p className="banner bad">{t('No answer from the store yet. Admin is being alerted too. You can also call.')}</p>
          : <p className="banner warn">{t('Waiting for the store to answer…')}</p>}
      {!alert.acked_at && escalated && (
        <div className="stack">
          {contacts.map((c) => <a key={c.phone} className="btn secondary floor" href={`tel:+91${c.phone}`}><Icon name="phone" /> {t('Call {name}', { name: c.full_name })}</a>)}
        </div>
      )}
      <button className="btn secondary floor" onClick={() => void done()}>{alert.acked_at ? t('I got it, close this') : t('Cancel, no longer needed')}</button>
    </>
  );
}

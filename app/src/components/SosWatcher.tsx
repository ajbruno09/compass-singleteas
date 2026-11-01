import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { timeOf } from '../lib/ist';
import { alarmUnlocked, keepAwake, startAlarm, stopAlarm, testBeep, unlockAlarm } from '../lib/alarm';
import { SOS_AFTER_SECONDS, type SosAlert } from '../lib/types';
import { useToast } from './Toast';
import { Icon } from './Icon';

// Lives on the store phone and the owner's phone. The store rings at once; the owner rings if nobody answers.
export function SosWatcher() {
  const { profile, locations } = useSession();
  const toast = useToast();
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [now, setNow] = useState(Date.now());
  const [armed, setArmed] = useState(alarmUnlocked());
  const role = profile?.role;
  const watching = role === 'store' || role === 'owner' || role === 'manager';

  const load = useCallback(async () => {
    const { data } = await supabase.from('sos_alerts').select('*').is('resolved_at', null).order('created_at');
    const list = (data as SosAlert[]) ?? [];
    setAlerts(list);
    const need = list.map((a) => a.item_id).filter((x): x is number => x != null);
    if (need.length) {
      const { data: its } = await supabase.from('items').select('id, name').in('id', need);
      setNames(Object.fromEntries(((its as { id: number; name: string }[]) ?? []).map((i) => [i.id, i.name])));
    }
  }, []);

  useEffect(() => {
    if (!watching) return;
    void load();
    const ch = supabase.channel('sos-office').on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => { void load(); }).subscribe();
    const poll = window.setInterval(() => { void load(); }, 10000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (document.visibilityState === 'visible') { void load(); if (armed) void keepAwake(true); } };
    document.addEventListener('visibilitychange', vis);
    return () => { void supabase.removeChannel(ch); window.clearInterval(poll); window.clearInterval(tick); document.removeEventListener('visibilitychange', vis); };
  }, [watching, load, armed]);

  useEffect(() => { if (armed && watching) void keepAwake(true); return () => { void keepAwake(false); }; }, [armed, watching]);

  const age = (a: SosAlert) => Math.floor((now - new Date(a.created_at).getTime()) / 1000);
  const unanswered = useMemo(() => alerts.filter((a) => !a.acked_at), [alerts]);
  const ringing = useMemo(
    () => unanswered.filter((a) => role === 'store' || age(a) >= SOS_AFTER_SECONDS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unanswered, role, now]
  );

  useEffect(() => {
    if (ringing.length > 0 && armed) startAlarm(); else stopAlarm();
    return () => stopAlarm();
  }, [ringing.length, armed]);

  useEffect(() => {
    if (ringing.length === 0) return;
    const t = document.title;
    document.title = '🚨 SOS · Compass';
    return () => { document.title = t; };
  }, [ringing.length]);

  const where = (a: SosAlert) => locations.find((l) => l.id === a.location_id)?.name ?? 'A counter';
  async function ack(a: SosAlert, eta: number) {
    const { error } = await supabase.rpc('ack_sos', { p_id: a.id, p_eta: eta });
    if (error) toast(errText(error)); else void load();
  }
  async function done(a: SosAlert) {
    const { error } = await supabase.rpc('resolve_sos', { p_id: a.id });
    if (error) toast(errText(error)); else void load();
  }

  if (!watching) return null;
  return (
    <>
      {!armed ? (
        <button className="banner warn alarmbar" onClick={() => { setArmed(unlockAlarm()); testBeep(); }}>
          <Icon name="bell" /> Tap here to turn on the SOS alarm sound on this phone
        </button>
      ) : (
        <div className="row small muted"><Icon name="bell" size={16} /> SOS siren is on. Keep Compass open for the loud siren. Alerts still reach this phone when it is closed. <button className="btn quiet" style={{ minHeight: 28 }} onClick={testBeep}>Test sound</button></div>
      )}

      {alerts.filter((a) => a.acked_at).map((a) => (
        <div key={a.id} className="banner ok row" style={{ justifyContent: 'space-between' }}>
          <span>{where(a)}: {names[a.item_id ?? -1] ?? 'request'}{a.note ? `, ${a.note}` : ''}{a.eta_minutes ? ` · about ${a.eta_minutes} min` : ''}</span>
          <button className="btn secondary" style={{ minHeight: 36 }} onClick={() => void done(a)}>Done</button>
        </div>
      ))}
      {role !== 'store' && unanswered.filter((a) => age(a) < SOS_AFTER_SECONDS).map((a) => (
        <div key={a.id} className="banner warn">{where(a)} sent an SOS. If the store does not answer in {Math.max(0, SOS_AFTER_SECONDS - age(a))} seconds, this phone will ring.</div>
      ))}

      {ringing.length > 0 && (
        <div className="sosoverlay" role="alertdialog" aria-label="SOS">
          <div className="soscard">
            <p className="sosbig">🚨 SOS</p>
            {ringing.slice(0, 3).map((a) => (
              <div key={a.id} className="stack" style={{ textAlign: 'left' }}>
                <h1>{where(a)}</h1>
                <p style={{ fontSize: 22, fontWeight: 800 }}>{names[a.item_id ?? -1] ?? 'Needs something right now'}</p>
                {a.note && <p style={{ fontSize: 18 }}>{a.note}</p>}
                <p className="small">Waiting {Math.floor(age(a) / 60)}:{String(age(a) % 60).padStart(2, '0')} · sent {timeOf(a.created_at)}{role !== 'store' ? ' · the store did not answer' : ''}</p>
                <div className="seg">
                  {[10, 20, 30, 60].map((m) => <button key={m} className="sosbtn" onClick={() => void ack(a, m)}>On it, {m} min</button>)}
                </div>
              </div>
            ))}
            {!armed && <button className="btn floor" onClick={() => setArmed(unlockAlarm())}>Turn on sound</button>}
          </div>
        </div>
      )}
    </>
  );
}

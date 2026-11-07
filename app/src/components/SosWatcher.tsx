import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { timeOf } from '../lib/ist';
import { alarmUnlocked, keepAwake, startAlarm, stopAlarm, unlockAlarm } from '../lib/alarm';
import { SOS_AFTER_SECONDS, type SosAlert } from '../lib/types';
import { useToast } from './Toast';

const MUTE_MINUTES = 15;
const idsOf = (a: SosAlert): number[] => (a.item_ids && a.item_ids.length ? a.item_ids : a.item_id != null ? [a.item_id] : []);

// Lives on the store phone and the owner's phone. The store rings at once; the owner rings if nobody answers.
export function SosWatcher() {
  const { profile, locations } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [units, setUnits] = useState<Record<number, string>>({});
  const [now, setNow] = useState(Date.now());
  const [mutedUntil, setMutedUntil] = useState(0);
  const [armed, setArmed] = useState(alarmUnlocked());
  useEffect(() => { const f = () => setArmed(alarmUnlocked()); window.addEventListener('compass-armed', f); return () => window.removeEventListener('compass-armed', f); }, []);
  const role = profile?.role;
  const watching = role === 'store' || role === 'owner' || role === 'manager';

  const load = useCallback(async () => {
    if (role === 'store' || role === 'owner') await supabase.rpc('sos_sweep');
    const { data } = await supabase.from('sos_alerts').select('*').is('resolved_at', null).order('created_at');
    const list = (data as SosAlert[]) ?? [];
    setAlerts(list);
    const need = [...new Set(list.flatMap((a) => idsOf(a)))];
    if (need.length) {
      const { data: its } = await supabase.from('items').select('id, name, unit').in('id', need);
      const rows = (its as { id: number; name: string; unit: string }[]) ?? [];
      setNames(Object.fromEntries(rows.map((i) => [i.id, i.name]))); setUnits(Object.fromEntries(rows.map((i) => [i.id, i.unit])));
    }
  }, [role]);

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

  // The alarm is on by default: the first tap anywhere in Compass turns the sound on (phones only allow sound after a tap).
  useEffect(() => {
    if (!watching || armed) return;
    const arm = () => { const ok = unlockAlarm(); setArmed(ok); if (ok) window.dispatchEvent(new Event('compass-armed')); };
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, arm, { once: true, passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, arm));
  }, [watching, armed]);

  useEffect(() => { if (armed && watching) void keepAwake(true); return () => { void keepAwake(false); }; }, [armed, watching]);

  const age = (a: SosAlert) => Math.floor((now - new Date(a.created_at).getTime()) / 1000);
  const unanswered = useMemo(() => alerts.filter((a) => !a.acked_at), [alerts]);
  const overdue = (a: SosAlert) => !!a.acked_at && !a.issued_at && !!a.eta_minutes && now > new Date(a.acked_at).getTime() + a.eta_minutes * 60000;
  const late = useMemo(
    () => alerts.filter((a) => a.acked_at && overdue(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alerts, now]
  );
  const ringing = useMemo(
    () => [...unanswered.filter((a) => role === 'store' || age(a) >= SOS_AFTER_SECONDS), ...late],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unanswered, late, role, now]
  );

  useEffect(() => {
    // A mute is only for a short while. When the time is up the alarm comes back on by itself.
    const loud = ringing.length > 0 && now >= mutedUntil;
    if (loud && armed) startAlarm(); else stopAlarm();
    return () => stopAlarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringing, mutedUntil, armed, now >= mutedUntil]);
  function muteFor15() {
    setMutedUntil(Date.now() + MUTE_MINUTES * 60000);
    void supabase.rpc('log_sos_mute', { p_minutes: MUTE_MINUTES });
  }

  useEffect(() => {
    if (ringing.length === 0) return;
    const t = document.title;
    document.title = '🚨 SOS · Compass';
    return () => { document.title = t; };
  }, [ringing.length]);

  const what = (a: SosAlert, fallback: string) => { const n = idsOf(a).filter((id) => names[id]).map((id) => { const q = a.item_qtys?.[String(id)]; return names[id] + (q ? ` ${q} ${units[id] ?? ''}` : ''); }); return n.length ? n.join(', ') : fallback; };
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
      {role === 'store' && !armed && <p className="banner warn">SOS sound switches on by itself with your first tap on this screen.</p>}
      {role === 'store' && armed && now < mutedUntil && <p className="banner warn">The SOS sound is muted for {Math.max(1, Math.ceil((mutedUntil - now) / 60000))} more minutes. It comes back on by itself.</p>}
      {alerts.filter((a) => a.acked_at).map((a) => (
        <div key={a.id} className="banner ok row" style={{ justifyContent: 'space-between' }}>
          <span>{where(a)}: {what(a, 'request')}{a.note ? `, ${a.note}` : ''}{a.eta_minutes ? ` · about ${a.eta_minutes} min` : ''}</span>
          <span className="row" style={{ gap: 6 }}>
            {role !== 'manager' && <button className="btn primary" style={{ minHeight: 36 }} onClick={() => nav('/sos')}>{a.issued_at ? 'View' : 'Issue now'}</button>}
            <button className="btn secondary" style={{ minHeight: 36 }} onClick={() => void done(a)}>Done</button>
          </span>
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
                <p style={{ fontSize: 22, fontWeight: 800 }}>{what(a, 'Needs something right now')}</p>
                {a.note && <p style={{ fontSize: 18 }}>{a.note}</p>}
                <p className="small">Waiting {Math.floor(age(a) / 60)}:{String(age(a) % 60).padStart(2, '0')} · sent {timeOf(a.created_at)}{role !== 'store' ? ' · the store did not answer' : ''}</p>
                {a.acked_at
                  ? <p style={{ fontWeight: 800 }}>Overdue. You said {a.eta_minutes} min. Please issue now.</p>
                  : <div className="seg">{[10, 20, 30, 60].map((m) => <button key={m} className="sosbtn" onClick={() => void ack(a, m)}>On it, {m} min</button>)}</div>}
                {role !== 'manager' && <button className="btn floor" onClick={() => nav('/sos')}>Open SOS page and issue</button>}
              </div>
            ))}
            {now >= mutedUntil && armed && <button className="btn floor" onClick={muteFor15}>🔇 Mute for {MUTE_MINUTES} minutes</button>}
            {now < mutedUntil && <p className="small">Sound is off for {Math.max(1, Math.ceil((mutedUntil - now) / 60000))} more minutes, then it rings again by itself.</p>}
            {!armed && <button className="btn floor" onClick={() => setArmed(unlockAlarm())}>Turn on sound</button>}
          </div>
        </div>
      )}
    </>
  );
}

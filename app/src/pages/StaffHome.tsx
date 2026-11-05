import { StatusStrip } from '../components/StatusStrip';
import { AvatarButton } from '../components/AvatarButton';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { clock12, dayLabel, timeOf, windowState, type Reminders } from '../lib/ist';
import { type IndentRec } from '../lib/types';
import { useLang } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { SosButton } from '../components/Sos';
import { NoticeStack } from '../components/NoticeStack';

export function StaffHome() {
  const { profile, myLocations, signOut } = useSession();
  const nav = useNavigate();
  const [status, setStatus] = useState<Record<number, IndentRec>>({});
  const [date, setDate] = useState('');
  const [rem, setRem] = useState<Reminders>({});
  const { t, local, toggle, canSwitch } = useLang();
  const [waiting, setWaiting] = useState<Record<number, number>>({});
  const [counted, setCounted] = useState<Record<number, string>>({});

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: w }] = await Promise.all([supabase.rpc('indent_for_date'), supabase.rpc('indent_window')]);
      setDate(String(d)); setRem((w as Reminders) ?? {});
      const { data } = await supabase.from('indents').select('id, location_id, for_date, status, submitted_at, nothing_needed').eq('for_date', String(d));
      setStatus(Object.fromEntries(((data as IndentRec[]) ?? []).map((r) => [r.location_id, r])));
    })();
  }, []);
  useEffect(() => {
    (async () => {
      const bd = await supabase.rpc('business_date', { p_at: new Date().toISOString() });
      const w: Record<number, number> = {}; const c: Record<number, string> = {};
      for (const l of myLocations) {
        const p = await supabase.rpc('pending_issues', { p_location_id: l.id });
        w[l.id] = ((p.data as unknown[]) ?? []).length;
        const k = await supabase.from('stock_counts').select('status').eq('location_id', l.id).eq('business_date', String(bd.data)).eq('frequency', 'daily').maybeSingle();
        if (k.data) c[l.id] = (k.data as { status: string }).status;
      }
      setWaiting(w); setCounted(c);
    })();
  }, [myLocations]);

  const win = windowState(rem);
  const sentText = (r?: IndentRec) => !r || r.status === 'draft' ? null : r.nothing_needed ? t('Nothing needed') : t('Sent {time}', { time: timeOf(r.submitted_at) });

  return (
    <div className="phone">
      <div className="phone-head">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <AvatarButton size={40} />
          <div><p style={{ font: '800 18px/20px var(--font-display)' }}>{t('Hello, {name}', { name: profile?.full_name?.split(' ')[0] ?? '' })}</p>
            <p className="small muted">{date ? t('Indent for {day}', { day: dayLabel(date) }) : ''}</p></div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {canSwitch && <div className="langsw" role="group" aria-label="Language"><button aria-pressed={local} onClick={() => { if (!local) toggle(); }}>हिंदी</button><button aria-pressed={!local} onClick={() => { if (local) toggle(); }}>English</button></div>}
          <button className="btn quiet" onClick={signOut} aria-label={t('Sign out')}><Icon name="out" /></button>
        </div>
      </div>

      {!profile?.photo && <button className="banner warn" style={{ textAlign: 'left', width: '100%' }} onClick={() => nav('/profile')}>Please add your photo. Tap here.</button>}
      <StatusStrip />
      <NoticeStack />
      <p className={'banner' + (win === 'late' ? ' warn' : '')}>
        {win === 'open' ? t('Indent time is on. Please send by {time}.', { time: clock12(rem.indent_due ?? '17:00') })
          : win === 'early' ? t('Indent time starts at {time}. You can start earlier.', { time: clock12(rem.indent_open ?? '15:30') })
          : t('Indent time was until {time}. Please send now if you have not.', { time: clock12(rem.indent_due ?? '17:00') })}
      </p>

            <div className="stack">
        {myLocations.map((l) => {
          const r = status[l.id];
          const s = sentText(r);
          return (
            <button key={l.id} className="countercard" onClick={() => nav(`/indent?loc=${l.id}`)}>
              <Icon name="clip" size={34} stroke={1.6} />
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span className="name" style={{ display: 'block' }}>{l.name}</span>
                <span className="small muted" style={{ fontWeight: 700 }}>{s ?? (r ? t('Started, not sent') : t('Make the indent'))}</span>
              </span>
              <span className={'chip ' + (s ? 'done' : win === 'late' ? 'late' : 'due')}>{s ? t('Sent') : t('Open')}</span>
            </button>
          );
        })}
        {myLocations.map((l) => (
          <div key={'x' + l.id} className="stack">
            <button className="countercard" onClick={() => nav(`/received?loc=${l.id}`)}>
              <Icon name="box" size={34} stroke={1.6} />
              <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>{t('Items from the store')}</span><span className="small muted" style={{ fontWeight: 700 }}>{myLocations.length > 1 ? l.name + ' · ' : ''}{waiting[l.id] ? t('Please confirm what you received') : t('Nothing waiting')}</span></span>
              <span className={'chip ' + (waiting[l.id] ? 'late' : 'off')}>{waiting[l.id] ? waiting[l.id] : '0'}</span>
            </button>
            <button className="countercard" onClick={() => nav(`/count?loc=${l.id}`)}>
              <Icon name="moon" size={34} stroke={1.6} />
              <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>{t('Closing stock')}</span><span className="small muted" style={{ fontWeight: 700 }}>{myLocations.length > 1 ? l.name + ' · ' : ''}{counted[l.id] === 'submitted' ? t('Count sent') : counted[l.id] ? t('Started, not sent') : t('Count what is left at closing')}</span></span>
              <span className={'chip ' + (counted[l.id] === 'submitted' ? 'done' : 'due')}>{counted[l.id] === 'submitted' ? t('Sent') : t('Open')}</span>
            </button>
          </div>
        ))}
      </div>
      {myLocations.length === 0 && <p className="banner warn">No counter has been given to you yet. Please tell Admin, so they can set it up.</p>}
      <button className="countercard" style={{ marginTop: 10 }} onClick={() => nav('/mine')}>
        <Icon name="scale" size={34} stroke={1.6} />
        <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>My Compass</span><span className="small muted" style={{ fontWeight: 700 }}>My sales, targets and incentives</span></span>
        <span className="chip due">New</span>
      </button>
      {myLocations.length > 0 && <SosButton locations={myLocations} />}
    </div>
  );
}

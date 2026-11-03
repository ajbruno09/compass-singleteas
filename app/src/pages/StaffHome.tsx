import { StatusStrip } from '../components/StatusStrip';
import { ProfileSheet } from '../components/ProfileSheet';
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
  const [me, setMe] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: w }] = await Promise.all([supabase.rpc('indent_for_date'), supabase.rpc('indent_window')]);
      setDate(String(d)); setRem((w as Reminders) ?? {});
      const { data } = await supabase.from('indents').select('id, location_id, for_date, status, submitted_at, nothing_needed').eq('for_date', String(d));
      setStatus(Object.fromEntries(((data as IndentRec[]) ?? []).map((r) => [r.location_id, r])));
    })();
  }, []);

  const win = windowState(rem);
  const sentText = (r?: IndentRec) => !r || r.status === 'draft' ? null : r.nothing_needed ? t('Nothing needed') : t('Sent {time}', { time: timeOf(r.submitted_at) });

  return (
    <div className="phone">
      {me && <ProfileSheet onClose={() => setMe(false)} />}
      <div className="phone-head">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <button className="btn quiet" style={{ padding: 0, minHeight: 0 }} onClick={() => setMe(true)} aria-label="My profile">{profile?.photo ? <img src={profile.photo} alt="" width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <img src="/logo-mark.png" alt="" width={32} height={32} />}</button>
          <div><p style={{ font: '800 18px/20px var(--font-display)' }}>{t('Hello, {name}', { name: profile?.full_name?.split(' ')[0] ?? '' })}</p>
            <p className="small muted">{date ? t('Indent for {day}', { day: dayLabel(date) }) : ''}</p></div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {canSwitch && <div className="langsw" role="group" aria-label="Language"><button aria-pressed={local} onClick={() => { if (!local) toggle(); }}>हिंदी</button><button aria-pressed={!local} onClick={() => { if (local) toggle(); }}>English</button></div>}
          <button className="btn quiet" onClick={signOut} aria-label={t('Sign out')}><Icon name="out" /></button>
        </div>
      </div>

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
      </div>
      <p className="small muted">{t('Receiving, counting and waste come next.')}</p>
      {myLocations.length > 0 && <SosButton locations={myLocations} />}
    </div>
  );
}

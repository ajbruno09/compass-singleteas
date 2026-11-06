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
  const [week, setWeek] = useState<{ weekly_off: number | null; shift_start: string | null; shift_end: string | null } | null>(null);
  const [rec, setRec] = useState<{ on_time: number; late: number; missed: number; sos_count: number }>({ on_time: 0, late: 0, missed: 0, sos_count: 0 });
  useEffect(() => {
    (async () => {
      if (!profile) return;
      const [w, sc] = await Promise.all([
        supabase.from('staff_schedule').select('weekly_off, shift_start, shift_end').eq('profile_id', profile.id).maybeSingle(),
        supabase.rpc('counter_scorecard', { p_days: 30 })
      ]);
      setWeek((w.data as typeof week) ?? null);
      const mine = new Set(myLocations.map((l) => l.id));
      const rows = ((sc.data as { location_id: number; on_time: number; late: number; missed: number; sos_count: number }[]) ?? []).filter((x) => mine.has(x.location_id));
      setRec(rows.reduce((a, x) => ({ on_time: a.on_time + x.on_time, late: a.late + x.late, missed: a.missed + x.missed, sos_count: a.sos_count + x.sos_count }), { on_time: 0, late: 0, missed: 0, sos_count: 0 }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, myLocations]);

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
      <WeekCard week={week} />
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
      {myLocations.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <b>Your record, last 30 days</b>
          <div className="row" style={{ gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            <span><b className="num">{rec.on_time}</b> <span className="muted small">indents on time</span></span>
            <span><b className="num" style={{ color: rec.late ? 'var(--bad, #B42335)' : undefined }}>{rec.late}</b> <span className="muted small">late</span></span>
            <span><b className="num" style={{ color: rec.missed ? 'var(--bad, #B42335)' : undefined }}>{rec.missed}</b> <span className="muted small">missed</span></span>
            <span><b className="num">{rec.sos_count}</b> <span className="muted small">SOS used</span></span>
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>Planning the indent well means fewer SOS and a better record.</p>
        </div>
      )}
      {[['🎯', 'Your targets', 'Coming soon. Look out for your targets here.'], ['💰', 'Your incentives', 'Coming soon. Look out for your incentives here.'], ['📉', 'Food cost control', 'Coming soon. See how we are doing on wastage and cost.']].map(([e, h, b]) => (
        <div key={h} style={{ border: '1.5px dashed var(--line, #D9DEDB)', borderRadius: 14, padding: '12px 14px', marginTop: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 22 }}>{e}</div><b>{h}</b><div className="small muted">{b}</div>
        </div>
      ))}
      <button className="countercard" style={{ marginTop: 10 }} onClick={() => nav('/mine')}>
        <Icon name="scale" size={34} stroke={1.6} />
        <span style={{ flex: 1, textAlign: 'left' }}><span className="name" style={{ display: 'block' }}>My Compass</span><span className="small muted" style={{ fontWeight: 700 }}>My sales, targets and incentives</span></span>
        <span className="chip due">New</span>
      </button>
      {myLocations.length > 0 && <SosButton locations={myLocations} />}
    </div>
  );
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function WeekCard({ week }: { week: { weekly_off: number | null; shift_start: string | null; shift_end: string | null } | null }) {
  // Monday is 0. Dates for this week, in Indian time.
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dow = (today.getDay() + 6) % 7;
  const days = DAY_NAMES.map((d, i) => { const dt = new Date(today); dt.setDate(today.getDate() - dow + i); return { d, n: dt.getDate(), i }; });
  const hm = (x: string | null) => (x ? clock12(x) : '');
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>My week</b>
        <span className="small muted">{week?.shift_start && week?.shift_end ? `${hm(week.shift_start)} to ${hm(week.shift_end)}` : 'Shift not set yet'}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', marginTop: 8 }}>
        {days.map((x) => (
          <div key={x.d} style={{ borderRadius: 10, padding: '6px 0', fontSize: 11, background: x.i === week?.weekly_off ? 'var(--badbg, #FCE8E5)' : 'var(--sunk, #EEF1EF)', color: x.i === week?.weekly_off ? 'var(--bad, #B02A1E)' : undefined, outline: x.i === dow ? '2px solid var(--primary, #1B6A4D)' : undefined }}>
            <span>{x.d}</span><b style={{ display: 'block', fontSize: 14 }}>{x.n}</b>{x.i === week?.weekly_off ? 'Off' : ''}
          </div>))}
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>{week?.weekly_off != null ? `Your weekly off is ${FULL[week.weekly_off]}.` : 'Your weekly off has not been set yet.'}</p>
    </div>
  );
}

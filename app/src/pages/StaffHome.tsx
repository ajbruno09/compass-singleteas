import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { clock12, dayLabel, timeOf, windowState, type Reminders } from '../lib/ist';
import { LANGUAGES, type IndentRec } from '../lib/types';
import { Icon } from '../components/Icon';
import { SosButton } from '../components/Sos';

export function StaffHome() {
  const { profile, myLocations, signOut } = useSession();
  const nav = useNavigate();
  const [status, setStatus] = useState<Record<number, IndentRec>>({});
  const [date, setDate] = useState('');
  const [rem, setRem] = useState<Reminders>({});
  const [local, setLocal] = useState(() => { try { return localStorage.getItem('compass-lang') === 'local'; } catch { return false; } });
  const lang = profile?.extra_language ?? null;

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: w }] = await Promise.all([supabase.rpc('indent_for_date'), supabase.rpc('indent_window')]);
      setDate(String(d)); setRem((w as Reminders) ?? {});
      const { data } = await supabase.from('indents').select('id, location_id, for_date, status, submitted_at, nothing_needed').eq('for_date', String(d));
      setStatus(Object.fromEntries(((data as IndentRec[]) ?? []).map((r) => [r.location_id, r])));
    })();
  }, []);

  const win = windowState(rem);
  const sentText = (r?: IndentRec) => !r || r.status === 'draft' ? null : r.nothing_needed ? 'Nothing needed' : `Sent ${timeOf(r.submitted_at)}`;

  return (
    <div className="phone">
      <div className="phone-head">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <img src="/icon.svg" alt="" width={32} height={32} />
          <div><p style={{ font: '800 18px/20px var(--font-display)' }}>Hello, {profile?.full_name?.split(' ')[0]}</p>
            <p className="small muted">{date ? `Indent for ${dayLabel(date)}` : ''}</p></div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {lang && <button className="btn secondary" style={{ minHeight: 40, borderRadius: 999 }} onClick={() => { const n = !local; setLocal(n); try { localStorage.setItem('compass-lang', n ? 'local' : 'en'); } catch { /* ignore */ } }}><Icon name="globe" size={16} />{local ? 'English' : (LANGUAGES[lang] ?? lang).split(' ')[0]}</button>}
          <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
        </div>
      </div>

      <p className={'banner' + (win === 'late' ? ' warn' : '')}>
        {win === 'open' ? `Indent time is on. Please send by ${clock12(rem.indent_due ?? '17:00')}.`
          : win === 'early' ? `Indent time starts at ${clock12(rem.indent_open ?? '15:30')}. You can start earlier.`
          : `Indent time was until ${clock12(rem.indent_due ?? '17:00')}. Please send now if you have not.`}
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
                <span className="small muted" style={{ fontWeight: 700 }}>{s ?? (r ? 'Started, not sent' : 'Make the indent')}</span>
              </span>
              <span className={'chip ' + (s ? 'done' : win === 'late' ? 'late' : 'due')}>{s ? 'Sent' : 'Open'}</span>
            </button>
          );
        })}
      </div>
      <p className="small muted">Receiving, counting and waste come next.</p>
      {myLocations.length > 0 && <SosButton locations={myLocations} />}
    </div>
  );
}

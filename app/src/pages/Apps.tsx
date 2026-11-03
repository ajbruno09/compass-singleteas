import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { appsFor, type AppDef } from '../lib/apps';
import { ROLE_LABEL } from '../lib/types';
import { Icon } from '../components/Icon';

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join(''); }

function Tile({ a }: { a: AppDef }) {
  const body = (
    <>
      <span className="ico"><Icon name={a.icon} size={20} /></span>
      <div><h2>{a.name}</h2><p className="small muted" style={{ marginTop: 2, fontSize: 12.5, lineHeight: '18px' }}>{a.blurb}</p></div>
      {a.status === 'live' ? <span className="chip done" style={{ justifySelf: 'start' }}>Live</span>
        : <span className={'chip ' + (a.status === 'separate' ? 'due' : 'off')} style={{ justifySelf: 'start' }}>{a.badge}</span>}
    </>
  );
  if (a.href) return <a className="app" href={a.href} target="_blank" rel="noreferrer">{body}</a>;
  if (a.to) return <Link className="app" to={a.to}>{body}</Link>;
  return <div className="app soon" aria-disabled="true">{body}</div>;
}

export function Apps() {
  const { profile, signOut } = useSession();
  useEffect(() => { try { sessionStorage.setItem('compass-picked', '1'); } catch { /* ignore */ } }, []);
  if (!profile) return null;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div style={{ minHeight: '100%' }}>
      <header className="apps-top">
        <div className="logo"><img src="/logo-mark.png" alt="" /><b>Compass</b></div>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
          <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 550, lineHeight: '16px' }}>{profile.full_name}</div><div className="small muted">{ROLE_LABEL[profile.role]}</div></div>
          <span className="avatar">{initials(profile.full_name || 'C')}</span>
          <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
        </div>
      </header>
      <main className="apps-wrap"><div className="apps-inner">
        <div>
          <p className="label">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 style={{ fontSize: 28, lineHeight: '36px', marginTop: 4 }}>{greet}, {profile.full_name?.split(' ')[0]}</h1>
          <p className="muted" style={{ marginTop: 4 }}>Pick the app you want to work in. You can switch any time with All apps.</p>
        </div>
        <div className="apps-grid">{appsFor(profile.role).map((a) => <Tile key={a.id} a={a} />)}</div>
      </div></main>
    </div>
  );
}

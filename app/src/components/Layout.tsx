import { useState } from 'react';
import { Brand } from './Brand';
import { ProfileSheet } from './ProfileSheet';
import { AvatarButton } from './AvatarButton';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../lib/session';
import { ROLE_LABEL, type Role } from '../lib/types';
import { Icon } from './Icon';
import { appsFor } from '../lib/apps';

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
import { SosWatcher } from './SosWatcher';
import { StatusStrip } from './StatusStrip';

interface NavItem { to: string; label: string; icon: string; roles: Role[] }
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home', roles: ['owner', 'manager', 'store', 'accounts'] },
  { to: '/indents', label: 'Indents', icon: 'clip', roles: ['owner', 'manager', 'store'] },
  { to: '/buying', label: 'Buying', icon: 'cart', roles: ['owner', 'store'] },
  { to: '/receive', label: 'Receive goods', icon: 'truck', roles: ['owner', 'store'] },
  { to: '/sos', label: 'SOS requests', icon: 'bell', roles: ['owner', 'manager', 'store'] },
  { to: '/issue', label: 'Issue to counters', icon: 'box', roles: ['owner', 'store'] },
  { to: '/stockview', label: 'Stock in hand', icon: 'layers', roles: ['owner', 'manager', 'store'] },
  { to: '/counts', label: 'Closing counts', icon: 'moon', roles: ['owner', 'manager', 'store'] },
  { to: '/items', label: 'Items', icon: 'tag', roles: ['owner', 'manager', 'store'] },
  { to: '/upload', label: 'Bulk upload', icon: 'layers', roles: ['owner', 'manager', 'store'] },
  { to: '/recipes', label: 'Recipes', icon: 'scale', roles: ['owner', 'manager', 'store', 'accounts'] },
  { to: '/inventory', label: 'Plates and glasses', icon: 'box', roles: ['owner', 'manager', 'store'] },
  { to: '/maintenance', label: 'Maintenance', icon: 'clock', roles: ['owner', 'manager', 'store'] },
  { to: '/stock', label: 'Opening stock', icon: 'clip', roles: ['owner', 'store'] },
  { to: '/sales', label: 'Daily sales', icon: 'receipt', roles: ['owner', 'manager', 'accounts'] },
  { to: '/vendors', label: 'Vendors', icon: 'truck', roles: ['owner', 'manager', 'store', 'accounts'] },
  { to: '/bills', label: 'Bills and payments', icon: 'receipt', roles: ['owner', 'manager', 'accounts'] },
  { to: '/menu', label: 'Menu items', icon: 'box', roles: ['owner', 'manager', 'store'] },
  { to: '/notices', label: 'Notices', icon: 'bell', roles: ['owner', 'manager'] },
  { to: '/rules', label: 'Rules', icon: 'scale', roles: ['owner', 'manager'] },
  { to: '/counters', label: 'Counters', icon: 'box', roles: ['owner'] },
  { to: '/reasons', label: 'Indent reasons', icon: 'clip', roles: ['owner'] },
  { to: '/scorecard', label: 'Counter record', icon: 'scale', roles: ['owner', 'manager', 'store'] },
  { to: '/schedules', label: 'Weekly offs', icon: 'clock', roles: ['owner', 'manager'] },
  { to: '/people', label: 'People', icon: 'users', roles: ['owner', 'manager'] }
];

export function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useSession();
  const nav = NAV.filter((n) => profile && n.roles.includes(profile.role));
  const navigate = useNavigate();
  const loc = useLocation();
  const [me, setMe] = useState(false);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main menu">
        <div className="brand"><Brand /></div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <span className="row" style={{ gap: 10 }}><Icon name={n.icon} />{n.label}</span>
          </NavLink>
        ))}
        <div className="who">
          {profile && appsFor(profile.role).length > 1 && <Link to="/apps" className="navlink"><span className="row" style={{ gap: 10 }}><Icon name="grid" />All apps</span></Link>}
          <div className="row" style={{ gap: 10, flexWrap: 'nowrap', padding: '0 6px' }}>
            {profile?.photo ? <img className="avatar" src={profile.photo} alt="" style={{ objectFit: 'cover' }} /> : <span className="avatar">{initials(profile?.full_name || profile?.email || 'C')}</span>}
            <button className="btn quiet" style={{ minWidth: 0, flex: 1, textAlign: 'left', display: 'block', padding: 0 }} onClick={() => setMe(true)} aria-label="My profile"><div style={{ fontWeight: 550, lineHeight: '16px' }}>{profile?.full_name || profile?.email}</div><div className="small muted">{profile ? ROLE_LABEL[profile.role] : ''} · My profile</div></button>
            <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
          </div>
        </div>
      </aside>
      <header className="topbar">
        <div className="brand" style={{ padding: 0 }}><Brand size={26} /></div>
        <select aria-label="Go to" value={nav.find((n) => n.to === loc.pathname)?.to ?? '/'} onChange={(e) => navigate(e.target.value)}>
          {nav.map((n) => <option key={n.to} value={n.to}>{n.label}</option>)}
          {profile && appsFor(profile.role).length > 1 && <option value="/apps">All apps</option>}
        </select>
        <AvatarButton />
        <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
      </header>
      {me && <ProfileSheet onClose={() => setMe(false)} />}
      <main className="main"><StatusStrip /><SosWatcher />{children}</main>
    </div>
  );
}

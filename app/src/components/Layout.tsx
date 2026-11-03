import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../lib/session';
import { ROLE_LABEL, type Role } from '../lib/types';
import { Icon } from './Icon';
import { appsFor } from '../lib/apps';

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
import { SosWatcher } from './SosWatcher';
import { PushSetup } from './PushSetup';
import { PhotoPrompt, QuickUnlock } from './BioLock';

interface NavItem { to: string; label: string; icon: string; roles: Role[] }
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home', roles: ['owner', 'manager', 'store', 'accounts'] },
  { to: '/indents', label: 'Indents', icon: 'clip', roles: ['owner', 'manager', 'store'] },
  { to: '/buying', label: 'Buying', icon: 'cart', roles: ['owner', 'store'] },
  { to: '/items', label: 'Items', icon: 'tag', roles: ['owner', 'manager', 'store'] },
  { to: '/stock', label: 'Opening stock', icon: 'layers', roles: ['owner', 'store'] },
  { to: '/vendors', label: 'Vendors', icon: 'truck', roles: ['owner', 'manager', 'store', 'accounts'] },
  { to: '/bills', label: 'Bills and payments', icon: 'receipt', roles: ['owner', 'manager', 'accounts'] },
  { to: '/menu', label: 'Menu items', icon: 'box', roles: ['owner', 'manager', 'store'] },
  { to: '/notices', label: 'Notices', icon: 'bell', roles: ['owner', 'manager'] },
  { to: '/rules', label: 'Rules', icon: 'scale', roles: ['owner', 'manager'] },
  { to: '/people', label: 'People', icon: 'users', roles: ['owner', 'manager'] }
];

export function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useSession();
  const nav = NAV.filter((n) => profile && n.roles.includes(profile.role));
  const navigate = useNavigate();
  const loc = useLocation();
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main menu">
        <div className="brand"><img src="/logo-mark.png" alt="" /><span>SToMS</span></div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <span className="row" style={{ gap: 10 }}><Icon name={n.icon} />{n.label}</span>
          </NavLink>
        ))}
        <div className="who">
          {profile && appsFor(profile.role).length > 1 && <Link to="/apps" className="navlink"><span className="row" style={{ gap: 10 }}><Icon name="grid" />All apps</span></Link>}
          <div className="row" style={{ gap: 10, flexWrap: 'nowrap', padding: '0 6px' }}>
            {profile?.photo ? <img className="avatar" src={profile.photo} alt="" style={{ objectFit: 'cover' }} /> : <span className="avatar">{initials(profile?.full_name || profile?.email || 'C')}</span>}
            <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 550, lineHeight: '16px' }}>{profile?.full_name || profile?.email}</div><div className="small muted">{profile ? ROLE_LABEL[profile.role] : ''}</div></div>
            <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
          </div>
        </div>
      </aside>
      <header className="topbar">
        <div className="brand" style={{ padding: 0 }}><img src="/logo-mark.png" alt="" /><span>SToMS</span></div>
        <select aria-label="Go to" value={nav.find((n) => n.to === loc.pathname)?.to ?? '/'} onChange={(e) => navigate(e.target.value)}>
          {nav.map((n) => <option key={n.to} value={n.to}>{n.label}</option>)}
          {profile && appsFor(profile.role).length > 1 && <option value="/apps">All apps</option>}
        </select>
        <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
      </header>
      <main className="main"><PhotoPrompt /><PushSetup /><QuickUnlock /><SosWatcher />{children}</main>
    </div>
  );
}

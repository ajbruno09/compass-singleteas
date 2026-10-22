import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../lib/session';
import { ROLE_LABEL, type Role } from '../lib/types';
import { Icon } from './Icon';

interface NavItem { to: string; label: string; icon: string; roles: Role[] }
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home', roles: ['owner', 'manager', 'store', 'accounts'] },
  { to: '/items', label: 'Items', icon: 'tag', roles: ['owner', 'manager', 'store'] },
  { to: '/stock', label: 'Opening stock', icon: 'layers', roles: ['owner', 'store'] },
  { to: '/vendors', label: 'Vendors', icon: 'truck', roles: ['owner', 'manager', 'store', 'accounts'] },
  { to: '/bills', label: 'Bills and payments', icon: 'receipt', roles: ['owner', 'manager', 'accounts'] },
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
        <div className="brand"><img src="/icon.svg" alt="" /><span>Compass</span></div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <span className="row" style={{ gap: 10 }}><Icon name={n.icon} />{n.label}</span>
          </NavLink>
        ))}
        <div className="who">
          <span style={{ fontWeight: 700 }}>{profile?.full_name || profile?.email}</span>
          <span className="small muted">{profile ? ROLE_LABEL[profile.role] : ''}</span>
          <button className="btn secondary" onClick={signOut}><Icon name="out" />Sign out</button>
        </div>
      </aside>
      <header className="topbar">
        <div className="brand" style={{ padding: 0 }}><img src="/icon.svg" alt="" /><span>Compass</span></div>
        <select aria-label="Go to" value={nav.find((n) => n.to === loc.pathname)?.to ?? '/'} onChange={(e) => navigate(e.target.value)}>
          {nav.map((n) => <option key={n.to} value={n.to}>{n.label}</option>)}
        </select>
        <button className="btn quiet" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}

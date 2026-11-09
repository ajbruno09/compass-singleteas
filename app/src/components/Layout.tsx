import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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

interface NavItem { to: string; label: string; icon: string; roles: Role[]; group?: string }
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home', roles: ['owner', 'manager', 'store', 'accounts'], group: 'Today' },
  { to: '/indents', label: 'Indents', icon: 'clip', roles: ['owner', 'manager', 'store'], group: 'Today' },
  { to: '/buying', label: 'Buying', icon: 'cart', roles: ['owner', 'store'], group: 'Buying and money' },
  { to: '/receive', label: 'Receive goods', icon: 'truck', roles: ['owner', 'store'], group: 'Buying and money' },
  { to: '/sos', label: 'SOS requests', icon: 'bell', roles: ['owner', 'manager', 'store'], group: 'Today' },
  { to: '/issue', label: 'Issue to counters', icon: 'box', roles: ['owner', 'store'], group: 'Today' },
  { to: '/stockview', label: 'Stock in hand', icon: 'layers', roles: ['owner', 'manager', 'store'], group: 'Stock' },
  { to: '/counts', label: 'Closing counts', icon: 'moon', roles: ['owner', 'manager', 'store'], group: 'Stock' },
  { to: '/items', label: 'Items', icon: 'tag', roles: ['owner', 'manager', 'store'], group: 'Items' },
  { to: '/buying-setup', label: 'Buying setup', icon: 'tag', roles: ['owner', 'manager', 'store', 'accounts'], group: 'Items' },
  { to: '/photos', label: 'Item photos', icon: 'box', roles: ['owner', 'manager'], group: 'Items' },
  { to: '/upload', label: 'Bulk upload', icon: 'layers', roles: ['owner', 'manager', 'store'], group: 'Items' },
  { to: '/production', label: 'Snacks production', icon: 'box', roles: ['owner', 'manager', 'store'], group: 'Kitchen' },
  { to: '/gas', label: 'Gas cylinders', icon: 'box', roles: ['owner', 'manager', 'store'], group: 'Stock' },
  { to: '/recipes', label: 'Recipes', icon: 'scale', roles: ['owner', 'manager', 'store', 'accounts'], group: 'Kitchen' },
  { to: '/inventory', label: 'Plates and glasses', icon: 'box', roles: ['owner', 'manager', 'store'], group: 'Stock' },
  { to: '/maint-requests', label: 'Maintenance requests', icon: 'wrench', roles: ['owner', 'manager', 'store', 'accounts'], group: 'Maintenance' },
  { to: '/maintenance', label: 'Jobs and schedules', icon: 'clock', roles: ['owner', 'manager', 'store'], group: 'Maintenance' },
  { to: '/stock', label: 'Opening stock', icon: 'clip', roles: ['owner', 'store'], group: 'Stock' },
  { to: '/sales', label: 'Daily sales', icon: 'receipt', roles: ['owner', 'manager', 'accounts'], group: 'Buying and money' },
  { to: '/vendors', label: 'Vendors', icon: 'truck', roles: ['owner', 'manager', 'store', 'accounts'], group: 'Buying and money' },
  { to: '/bills', label: 'Bills and payments', icon: 'receipt', roles: ['owner', 'manager', 'accounts'], group: 'Buying and money' },
  { to: '/menu', label: 'Menu items', icon: 'box', roles: ['owner', 'manager', 'store'], group: 'Kitchen' },
  { to: '/notices', label: 'Notices', icon: 'bell', roles: ['owner', 'manager'], group: 'Setup' },
  { to: '/rules', label: 'Rules', icon: 'scale', roles: ['owner', 'manager'], group: 'Setup' },
  { to: '/counters', label: 'Counters', icon: 'box', roles: ['owner'], group: 'Setup' },
  { to: '/reasons', label: 'Indent reasons', icon: 'clip', roles: ['owner'], group: 'Setup' },
  { to: '/scorecard', label: 'Counter record', icon: 'scale', roles: ['owner', 'manager', 'store'], group: 'Reports' },
  { to: '/schedules', label: 'Weekly offs', icon: 'clock', roles: ['owner', 'manager'], group: 'Team' },
  { to: '/people', label: 'People', icon: 'users', roles: ['owner', 'manager'], group: 'Team' }
];

export function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useSession();
  const nav = NAV.filter((n) => profile && n.roles.includes(profile.role));
  const navigate = useNavigate();
  const loc = useLocation();
  const [me, setMe] = useState(false);
  const GROUPS = Array.from(new Set(nav.map((n) => n.group ?? 'Other')));
  const activeGroup = nav.filter((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0]?.group;
  const [shut, setShut] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('compass.navshut') || '[]'); } catch { return []; } });
  const toggle = (g: string) => setShut((x) => { const y = x.includes(g) ? x.filter((v) => v !== g) : [...x, g]; try { localStorage.setItem('compass.navshut', JSON.stringify(y)); } catch { /* ignore */ } return y; });
  const [newReq, setNewReq] = useState(0);
  const isAdmin = !!profile && ['owner', 'manager', 'store', 'accounts'].includes(profile.role);
  useEffect(() => {
    if (!isAdmin) return;
    const go = async () => { const { count } = await supabase.from('maint_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'); setNewReq(count ?? 0); };
    void go();
    const t = window.setInterval(go, 60000);
    window.addEventListener('compass:maint', go);
    return () => { window.clearInterval(t); window.removeEventListener('compass:maint', go); };
  }, [isAdmin, loc.pathname]);
  const badge = (to: string) => (to === '/maint-requests' && newReq > 0 ? <span className="navbadge">{newReq}</span> : null);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main menu">
        <div className="brand"><Brand /></div>
        {GROUPS.map((g) => {
          const items = nav.filter((n) => (n.group ?? 'Other') === g);
          const closed = shut.includes(g) && activeGroup !== g;
          const gb = g === 'Maintenance' && newReq > 0 && closed ? <span className="navbadge">{newReq}</span> : null;
          return (
            <div key={g} className="navgroup">
              {items.length > 1 || g !== 'Today' ? <button className="navhead" onClick={() => toggle(g)} aria-expanded={!closed}><span>{g}</span><span className="row" style={{ gap: 6 }}>{gb}<i className={closed ? 'shut' : ''}>▾</i></span></button> : null}
              {!closed && items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
                  <span className="row" style={{ gap: 10 }}><Icon name={n.icon} />{n.label}</span>{badge(n.to)}
                </NavLink>
              ))}
            </div>
          );
        })}
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
          {GROUPS.map((g) => <optgroup key={g} label={g}>{nav.filter((n) => (n.group ?? 'Other') === g).map((n) => <option key={n.to} value={n.to}>{n.label}{n.to === '/maint-requests' && newReq > 0 ? ` (${newReq})` : ''}</option>)}</optgroup>)}
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

import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { configured } from './lib/supabase';
import { ToastProvider } from './components/Toast';
import { Layout, NAV } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Items } from './pages/Items';
import { Vendors } from './pages/Vendors';
import { Bills } from './pages/Bills';
import { People } from './pages/People';
import { OpeningStock } from './pages/OpeningStock';
import { StaffHome } from './pages/StaffHome';
import { IndentPage } from './pages/Indent';
import { Indents } from './pages/Indents';
import { Buying } from './pages/Buying';
import { Apps } from './pages/Apps';
import { appsFor } from './lib/apps';

const PAGES: Record<string, JSX.Element> = {
  '/': <Dashboard />, '/indents': <Indents />, '/buying': <Buying />, '/items': <Items />, '/stock': <OpeningStock />, '/vendors': <Vendors />, '/bills': <Bills />, '/people': <People />
};

// After signing in, people with more than one app choose which to open. Once per visit.
function Home({ several }: { several: boolean }) {
  let picked = true;
  try { picked = sessionStorage.getItem('compass-picked') === '1'; } catch { /* ignore */ }
  return several && !picked ? <Navigate to="/apps" replace /> : <Dashboard />;
}

function Gate() {
  const { session, profile, loading, signOut } = useSession();
  if (!configured) return <div className="login"><div className="card"><h1>Compass</h1><p>This copy of the app is not connected to its database yet.</p></div></div>;
  if (loading) return <div className="login"><p className="muted">Loading…</p></div>;
  if (!session) return <Login />;
  if (!profile || !profile.active) {
    return (
      <div className="login"><div className="card">
        <h1>Almost there</h1>
        <p>Your account is waiting for the owner to give you access. Ask the owner to add you in Compass.</p>
        <button className="btn secondary" onClick={signOut}>Sign out</button>
      </div></div>
    );
  }
  if (profile.role === 'department' || profile.role === 'closing') {
    return (
      <Routes>
        <Route path="/" element={<StaffHome />} />
        <Route path="/indent" element={<IndentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }
  const allowed = NAV.filter((n) => n.roles.includes(profile.role));
  const several = appsFor(profile.role).length > 1;
  return (
    <Routes>
      <Route path="/apps" element={several ? <Apps /> : <Navigate to="/" replace />} />
      <Route element={<Layout><Outlet /></Layout>}>
        <Route path="/" element={<Home several={several} />} />
        {allowed.filter((n) => n.to !== '/').map((n) => <Route key={n.to} path={n.to} element={PAGES[n.to]} />)}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}

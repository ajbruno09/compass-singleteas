import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { configured } from './lib/supabase';
import { ToastProvider } from './components/Toast';
import { Layout, NAV } from './components/Layout';
import { Login } from './pages/Login';
import { NewPassword } from './pages/NewPassword';
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
import { MenuItems } from './pages/MenuItems';
import { Rules } from './pages/Rules';
import { Notices } from './pages/Notices';
import { Join } from './pages/Join';
import { Upload } from './pages/Upload';
import { Recipes } from './pages/Recipes';
import { Inventory } from './pages/Inventory';
import { Maintenance } from './pages/Maintenance';
import { Receive } from './pages/Receive';
import { Issue } from './pages/Issue';
import { StockView } from './pages/StockView';
import { Counts } from './pages/Counts';
import { CountPage } from './pages/Count';
import { ReceivedPage } from './pages/Received';
import { Setup } from './pages/Setup';
import { LockGate } from './components/BioLock';
import { appsFor } from './lib/apps';

const PAGES: Record<string, JSX.Element> = {
  '/': <Dashboard />, '/indents': <Indents />, '/buying': <Buying />, '/items': <Items />, '/menu': <MenuItems />, '/rules': <Rules />, '/notices': <Notices />, '/stock': <OpeningStock />, '/upload': <Upload />, '/recipes': <Recipes />, '/inventory': <Inventory />, '/maintenance': <Maintenance />, '/receive': <Receive />, '/issue': <Issue />, '/stockview': <StockView />, '/counts': <Counts />, '/vendors': <Vendors />, '/bills': <Bills />, '/people': <People />
};

// After signing in, people with more than one app choose which to open. Once per visit.
function Home({ several }: { several: boolean }) {
  let picked = true;
  try { picked = sessionStorage.getItem('compass-picked') === '1'; } catch { /* ignore */ }
  return several && !picked ? <Navigate to="/apps" replace /> : <Dashboard />;
}

function Gate() {
  const { session, profile, loading, signOut, recovery, loadError, reload } = useSession();
  if (!configured) return <div className="login"><div className="card"><h1>Compass</h1><p>This copy of the app is not connected to its database yet.</p></div></div>;
  if (loading) return <div className="login"><p className="muted">Loading…</p></div>;
  if (session && recovery) return <NewPassword />;
  if (!session) return window.location.pathname === '/join' ? <Join /> : <Login />;
  if (loadError && !profile) {
    return (
      <div className="login"><div className="card">
        <h1>Could not load</h1>
        <p>Compass could not reach the server just now. Please check the internet and try again.</p>
        <button className="btn" onClick={() => { void reload(); }}>Try again</button>
        <button className="btn secondary" onClick={signOut}>Sign out</button>
      </div></div>
    );
  }
  if (!profile || !profile.active) {
    return (
      <div className="login"><div className="card">
        <h1>Almost there</h1>
        <p>Your account is waiting for Admin to give you access. Please contact Admin.</p>
        <button className="btn secondary" onClick={signOut}>Sign out</button>
      </div></div>
    );
  }
  if (!profile.setup_done_at) return <Setup />;
  if (profile.role === 'department' || profile.role === 'closing') {
    return (
      <LockGate><Routes>
        <Route path="/" element={<StaffHome />} />
        <Route path="/indent" element={<IndentPage />} />
        <Route path="/count" element={<CountPage />} />
        <Route path="/received" element={<ReceivedPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></LockGate>
    );
  }
  const allowed = NAV.filter((n) => n.roles.includes(profile.role));
  const several = appsFor(profile.role).length > 1;
  return (
    <LockGate><Routes>
      <Route path="/apps" element={several ? <Apps /> : <Navigate to="/" replace />} />
      <Route element={<Layout><Outlet /></Layout>}>
        <Route path="/" element={<Home several={several} />} />
        {allowed.filter((n) => n.to !== '/').map((n) => <Route key={n.to} path={n.to} element={PAGES[n.to]} />)}
      </Route>
      <Route path="/count" element={<CountPage />} />
      <Route path="/received" element={<ReceivedPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></LockGate>
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

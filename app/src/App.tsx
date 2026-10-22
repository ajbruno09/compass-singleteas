import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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

const PAGES: Record<string, JSX.Element> = {
  '/': <Dashboard />, '/items': <Items />, '/stock': <OpeningStock />, '/vendors': <Vendors />, '/bills': <Bills />, '/people': <People />
};

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
  if (profile.role === 'department' || profile.role === 'closing') return <StaffHome />;
  const allowed = NAV.filter((n) => n.roles.includes(profile.role));
  return (
    <Layout>
      <Routes>
        {allowed.map((n) => <Route key={n.to} path={n.to} element={PAGES[n.to]} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
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

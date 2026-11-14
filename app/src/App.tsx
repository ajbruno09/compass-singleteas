import { useState } from 'react';
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
import { StaffShell } from './components/StaffNav';
import { ClosingHub } from './pages/ClosingHub';
import { MessagesPage } from './pages/Messages';
import { IndentPage } from './pages/Indent';
import { Indents } from './pages/Indents';
import { Buying } from './pages/Buying';
import { Apps } from './pages/Apps';
import { MenuItems } from './pages/MenuItems';
import { Rules } from './pages/Rules';
import { Notices } from './pages/Notices';
import { Join } from './pages/Join';
import { Upload } from './pages/Upload';
import { Photos } from './pages/Photos';
import { Production } from './pages/Production';
import { Gas } from './pages/Gas';
import { Recipes } from './pages/Recipes';
import { Inventory } from './pages/Inventory';
import { Maintenance } from './pages/Maintenance';
import { MaintStaff } from './pages/MaintStaff';
import { MaintRequests } from './pages/MaintRequests';
import { BuyingSetup } from './pages/BuyingSetup';
import { DataCheck } from './pages/DataCheck';
import { StoreLevels } from './pages/StoreLevels';
import { Receive } from './pages/Receive';
import { Issue } from './pages/Issue';
import { SosPage } from './pages/SosPage';
import { Counters } from './pages/Counters';
import { Shelves } from './pages/Shelves';
import { PriceCheck } from './pages/PriceCheck';
import { BillSpend } from './pages/BillSpend';
import { TeamUsage } from './pages/TeamUsage';
import { CounterSales } from './pages/CounterSales';
import { IndentReasons } from './pages/IndentReasons';
import { Scorecard } from './pages/Scorecard';
import { Schedules } from './pages/Schedules';
import { StockView } from './pages/StockView';
import { Counts } from './pages/Counts';
import { CountFrequency } from './pages/CountFrequency';
import { CountPage } from './pages/Count';
import { ReceivedPage } from './pages/Received';
import { Setup } from './pages/Setup';
import { InstallGate, needsInstall, isStandalone, isPhone } from './pages/Install';
import { Welcome, welcomed } from './pages/Welcome';
import { MyCompass } from './pages/MyCompass';
import { ProfilePage } from './pages/Profile';
import { OpenInChrome, inAppBrowser } from './pages/OpenInChrome';
import { OfflineBar } from './components/OfflineBar';
import { KeepReady } from './pages/KeepReady';
import { SalesEntry } from './pages/SalesEntry';
import { LockGate } from './components/BioLock';
import { appsFor } from './lib/apps';

const PAGES: Record<string, JSX.Element> = {
  '/': <Dashboard />, '/indents': <Indents />, '/buying': <Buying />, '/items': <Items />, '/buying-setup': <BuyingSetup />, '/data-check': <DataCheck />, '/keep-ready': <KeepReady />, '/store-levels': <StoreLevels />, '/menu': <MenuItems />, '/rules': <Rules />, '/counters': <Counters />, '/shelves': <Shelves />, '/price-check': <PriceCheck />, '/bill-spend': <BillSpend />, '/team-usage': <TeamUsage />, '/counter-sales': <CounterSales />, '/reasons': <IndentReasons />, '/scorecard': <Scorecard />, '/schedules': <Schedules />, '/notices': <Notices />, '/stock': <OpeningStock />, '/upload': <Upload />, '/recipes': <Recipes />, '/production': <Production />, '/gas': <Gas />, '/photos': <Photos />, '/inventory': <Inventory />, '/maintenance': <Maintenance />, '/maint-requests': <MaintRequests />, '/receive': <Receive />, '/issue': <Issue />, '/sos': <SosPage />, '/stockview': <StockView />, '/counts': <Counts />, '/count-frequency': <CountFrequency />, '/vendors': <Vendors />, '/bills': <Bills />, '/people': <People />, '/sales': <SalesEntry />
};

// After signing in, people with more than one app choose which to open. Once per visit.
function Home({ several }: { several: boolean }) {
  let picked = true;
  try { picked = sessionStorage.getItem('compass-picked') === '1'; } catch { /* ignore */ }
  return several && !picked ? <Navigate to="/apps" replace /> : <Dashboard />;
}

// First time on this account: Welcome, then (on a phone) install to the home screen, then the profile setup.
// The welcome shows to every new person. On a phone browser it always shows. Anywhere else it is skipped only if this person already agreed on this device.
function FirstRun({ uid, owner }: { uid: string; owner: boolean }) {
  const [agreed, setAgreed] = useState(() => (isPhone() && !isStandalone() ? false : welcomed(uid)));
  if (!agreed && !owner) return <Welcome onAgree={() => setAgreed(true)} />;
  return needsInstall(owner) ? <InstallGate /> : <Setup />;
}

function Gate() {
  const { session, profile, loading, signOut, recovery, loadError, reload } = useSession();
  const inApp = inAppBrowser();
  if (inApp) return <OpenInChrome kind={inApp} />;
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
  if (!profile.setup_done_at) return <FirstRun uid={profile.id} owner={profile.role === 'owner'} />;
  if (profile.role === 'department' || profile.role === 'closing') {
    return (
      <LockGate><Routes><Route element={<StaffShell />}>
        <Route path="/" element={<StaffHome />} />
        <Route path="/indent" element={<IndentPage />} />
        <Route path="/closing" element={<ClosingHub />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/count" element={<CountPage />} />
        <Route path="/received" element={<ReceivedPage />} />
        <Route path="/production" element={<Production />} />
        <Route path="/gas" element={<Gas />} />
        <Route path="/maintenance" element={<MaintStaff />} />
        <Route path="/mine" element={<MyCompass />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route></Routes></LockGate>
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
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></LockGate>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <OfflineBar />
          <Gate />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}

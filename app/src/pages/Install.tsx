import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { Brand } from '../components/Brand';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

// Chrome offers the install prompt once, early, while the page loads. Catch it here at start up so the install screen can use it later.
let saved: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); saved = e as InstallEvent; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { saved = null; listeners.forEach((f) => f()); });
}

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const ua = () => navigator.userAgent;
const iPadAsMac = () => navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const isIos = () => /iphone|ipad|ipod/i.test(ua()) || iPadAsMac();
export const isPhone = () => /android/i.test(ua()) || isIos();

// Shown once, before first time setup, on a phone that has not installed Compass yet.
export function needsInstall(isOwner: boolean) { return isPhone() && !isStandalone() && !isOwner; }

export function InstallGate() {
  const { profile, signOut } = useSession();
  const [ev, setEv] = useState<InstallEvent | null>(saved);
  const [state, setState] = useState<'ask' | 'done'>('ask');
  useEffect(() => {
    const f = () => setEv(saved);
    listeners.add(f); f();
    const ok = () => setState('done');
    window.addEventListener('appinstalled', ok);
    return () => { listeners.delete(f); window.removeEventListener('appinstalled', ok); };
  }, []);
  async function install() {
    if (!ev) return;
    await ev.prompt();
    const r = await ev.userChoice;
    if (r.outcome === 'accepted') setState('done');
  }
  const first = (profile?.full_name ?? '').split(' ')[0];

  if (state === 'done') {
    return (
      <div className="setup"><div className="box">
        <Brand />
        <h1>Done{first ? `, ${first}` : ''}</h1>
        <p>Compass is on your phone now. <b>Close this page and open the SToMS icon</b> on your home screen. Sign in there with the same number and PIN.</p>
      </div></div>
    );
  }
  return (
    <div className="setup"><div className="box">
      <Brand />
      <h1>Welcome{first ? `, ${first}` : ''}</h1>
      <p>Compass needs to be on your phone like an app. It takes one tap.</p>
      {isIos() ? (
        <>
          <div style={{ fontSize: 44, textAlign: 'center', animation: 'nudge 0.8s infinite alternate' }} aria-hidden>👇</div>
          <ol className="stack">
            <li>Open this page in <b>Safari</b>.</li>
            <li>Tap the <b>Share</b> button at the bottom (a square with an arrow going up).</li>
            <li>Scroll down. Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            <li>Open the <b>SToMS</b> icon on your home screen and sign in there.</li>
          </ol>
          <button className="btn secondary" onClick={signOut}>Go back</button>
        </>
      ) : ev ? (
        <>
          <button className="btn primary" style={{ fontSize: 18, padding: '16px 20px' }} onClick={install}>Yes, add Compass to my phone</button>
          <button className="btn secondary" onClick={signOut}>No, go back</button>
        </>
      ) : (
        <>
          <p>Tap the <b>three dots</b> at the top right of the browser, then <b>Install app</b> (or <b>Add to Home screen</b>).</p>
          <p className="small muted">If you do not see it, please tell Admin.</p>
          <button className="btn secondary" onClick={signOut}>Go back</button>
        </>
      )}
    </div></div>
  );
}

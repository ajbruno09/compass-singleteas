import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { Brand } from '../components/Brand';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const ua = () => navigator.userAgent;
export const isPhone = () => /android|iphone|ipad|ipod/i.test(ua());
const isIos = () => /iphone|ipad|ipod/i.test(ua());

// Shown once, before first time setup, on a phone that has not installed Compass yet.
export function needsInstall(isOwner: boolean) { return isPhone() && !isStandalone() && !isOwner; }

export function InstallGate({ onSkip }: { onSkip?: () => void }) {
  const { profile, signOut } = useSession();
  const [ev, setEv] = useState<InstallEvent | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEv(e as InstallEvent); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  async function install() { if (!ev) return; setAsked(true); await ev.prompt(); await ev.userChoice; }
  const first = (profile?.full_name ?? '').split(' ')[0];
  return (
    <div className="setup"><div className="box">
      <Brand />
      <h1>Install Compass first{first ? `, ${first}` : ''}</h1>
      <p>Add Compass to your phone so it opens like an app. Do this before anything else, then open the new Compass icon and sign in again.</p>
      {isIos() ? (
        <ol className="stack">
          <li>Open this page in <b>Safari</b>.</li>
          <li>Tap the <b>Share</b> button at the bottom (a square with an arrow).</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Close this page. Open the <b>Compass</b> icon on your home screen and sign in again.</li>
        </ol>
      ) : (
        <>
          {ev && <button className="btn primary" onClick={install} disabled={asked}>{asked ? 'Installing…' : 'Install Compass'}</button>}
          <ol className="stack">
            {!ev && <li>Tap the <b>three dots</b> at the top right of your browser.</li>}
            {!ev && <li>Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.</li>}
            <li>Open the <b>Compass</b> icon on your home screen and sign in again.</li>
          </ol>
        </>
      )}
      <p className="small muted">This page goes away by itself once Compass is opened from the home screen icon.</p>
      <div className="row" style={{ gap: 8 }}>
        {onSkip && <button className="btn secondary" onClick={onSkip}>Skip for now</button>}
        <button className="btn secondary" onClick={signOut}>Sign out</button>
      </div>
    </div></div>
  );
}

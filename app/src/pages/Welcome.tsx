import { useSession } from '../lib/session';
import { Brand } from '../components/Brand';

export const welcomeKey = (uid: string) => `compass-welcome-${uid}`;
export function welcomed(uid: string) { try { return localStorage.getItem(welcomeKey(uid)) === '1'; } catch { return false; } }

// First screen after the very first sign in. One tap on "I agree" and the setup begins.
export function Welcome({ onAgree }: { onAgree: () => void }) {
  const { profile, signOut } = useSession();
  const first = (profile?.full_name ?? '').split(' ')[0];
  function agree() { try { localStorage.setItem(welcomeKey(profile?.id ?? ''), '1'); } catch { /* ignore */ } onAgree(); }
  return (
    <div className="setup"><div className="box">
      <Brand />
      <h1>Hi{first ? `, ${first}` : ''}. Welcome to Compass.</h1>
      <p>Compass is the Single Teas Operations Management System. It is made to make your work easy.</p>
      <p>Here you will:</p>
      <ul className="stack">
        <li>Send your <b>daily indent</b>, to ask for what you need</li>
        <li>Do your <b>daily closing stock</b> and <b>weekly closing stock</b></li>
        <li>Soon, see your <b>sales targets</b> and <b>incentives</b></li>
      </ul>
      <p>Everything is simple, short and in plain English.</p>
      <p>Before you start, you need to set up your profile. It takes only a few minutes.</p>
      <button className="btn primary" style={{ fontSize: 18, padding: '16px 20px' }} onClick={agree}>I agree</button>
      <button className="btn secondary" onClick={signOut}>Not now</button>
    </div></div>
  );
}

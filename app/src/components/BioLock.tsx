import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '../lib/session';
import { bioCheck, bioEnabled, bioOff, bioOn, bioSupported } from '../lib/biolock';
import { selfieFromFile } from '../lib/photo';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';
import { useToast } from './Toast';
import { Icon } from './Icon';

const RELOCK_MS = 2 * 60 * 1000;

// Opens behind the phone's own fingerprint or face check, when the person has turned it on.
export function LockGate({ children }: { children: ReactNode }) {
  const { profile, signOut } = useSession();
  const uid = profile?.id ?? '';
  const [locked, setLocked] = useState(() => !!uid && bioEnabled(uid));
  const [msg, setMsg] = useState('');
  const hiddenAt = useRef(0);
  const trying = useRef(false);

  const unlock = useCallback(async () => {
    if (!uid || trying.current) return;
    trying.current = true; setMsg('');
    try { if (await bioCheck(uid)) setLocked(false); }
    catch { setMsg('Not recognised. Try again, or use your PIN.'); }
    finally { trying.current = false; }
  }, [uid]);

  useEffect(() => { if (uid && bioEnabled(uid)) { setLocked(true); void unlock(); } }, [uid, unlock]);
  useEffect(() => {
    const v = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return; }
      if (uid && bioEnabled(uid) && hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_MS) { setLocked(true); void unlock(); }
    };
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, [uid, unlock]);

  if (!locked) return <>{children}</>;
  return (
    <div className="login"><div className="card" style={{ textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center', maxWidth: 360 }}>
      {profile?.photo ? <img src={profile.photo} alt="" width={96} height={96} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <img src="/logo-mark.png" alt="" width={64} height={64} />}
      <h1 style={{ fontSize: 22 }}>Hello, {profile?.full_name?.split(' ')[0]}</h1>
      <button className="btn primary floor" onClick={() => void unlock()}><Icon name="lock" /> Unlock</button>
      {msg && <p className="banner warn">{msg}</p>}
      <button className="btn quiet" onClick={() => { bioOff(uid); void signOut(); }}>Use my PIN instead</button>
    </div></div>
  );
}

// Small card: "turn on fingerprint or face unlock".
export function QuickUnlock() {
  const { profile } = useSession();
  const toast = useToast();
  const uid = profile?.id ?? '';
  const [ok, setOk] = useState(false);
  const [on, setOn] = useState(false);
  const [hide, setHide] = useState(() => { try { return localStorage.getItem('compass-lock-hide') === '1'; } catch { return false; } });
  useEffect(() => { void bioSupported().then(setOk); setOn(!!uid && bioEnabled(uid)); }, [uid]);
  if (!ok || !profile) return null;
  if (on) return <p className="small muted" style={{ textAlign: 'center' }}>Fingerprint or face unlock is on. <button className="btn quiet" style={{ minHeight: 28 }} onClick={() => { bioOff(uid); setOn(false); toast('Unlock turned off'); }}>Turn off</button></p>;
  if (hide) return null;
  async function enable() {
    try { await bioOn(uid, profile?.full_name || 'SToMS'); setOn(true); toast('Done. Next time you open SToMS, use your fingerprint or face.'); }
    catch (e) { toast(errText(e)); }
  }
  return (
    <section className="card" style={{ display: 'grid', gap: 8 }}>
      <b>Open SToMS with your fingerprint or face</b>
      <p className="small muted">No need to type your PIN again on this phone.</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" onClick={() => void enable()}>Turn on</button>
        <button className="btn quiet" onClick={() => { try { localStorage.setItem('compass-lock-hide', '1'); } catch { /* ignore */ } setHide(true); }}>Not now</button>
      </div>
    </section>
  );
}

// Asks for one face photo, once. It becomes the profile picture.
export function PhotoPrompt() {
  const { profile, reload } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!profile || profile.photo || profile.role === 'owner') return null;
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await selfieFromFile(f);
      const { data: r, error } = await supabase.rpc('set_my_photo', { p_photo: data });
      if (error) throw error;
      if (r !== 'ok') throw new Error(String(r));
      toast('Thank you. Your photo is saved.'); await reload();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return (
    <section className="card" style={{ display: 'grid', gap: 8 }}>
      <b>Please take your photo, only once</b>
      <p className="small muted">It shows as your picture in SToMS and confirms that this is you.</p>
      <label className="btn primary" style={{ cursor: 'pointer', justifySelf: 'start' }}>
        <Icon name="camera" /> {busy ? 'Saving…' : 'Take photo'}
        <input type="file" accept="image/*" capture="user" hidden disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
    </section>
  );
}

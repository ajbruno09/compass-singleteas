import { useEffect, useState, type FormEvent } from 'react';
import { supabase, staffEmail } from '../lib/supabase';
import { errText } from '../lib/format';
import { Brand } from '../components/Brand';

export function Login() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  useEffect(() => { supabase.rpc('get_admin_contact').then(({ data }) => { if (typeof data === 'string') setAdminPhone(data); }); }, []);
  const adminLink = adminPhone ? `https://wa.me/91${adminPhone}?text=${encodeURIComponent(`Hi, I am having trouble signing in to SToMS.${/^[6-9][0-9]{9}$/.test(phone) ? ` My mobile number is ${phone}.` : ''}`)}` : '';

  async function forgot() {
    setError(''); setNote('');
    if (!/^[6-9][0-9]{9}$/.test(phone)) return setError('Type your 10 digit mobile number above first, then tap Forgot PIN.');
    setBusy(true);
    const { error } = await supabase.rpc('request_pin_reset', { p_phone: phone });
    setBusy(false);
    if (error) return setError(errText(error));
    setNote('Done. Admin has been told and will give you a new PIN.');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setNote(''); setBusy(true);
    try {
      if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter your 10 digit mobile number.');
      if (!/^[0-9]{6}$/.test(pin)) throw new Error('Your PIN has 6 digits.');
      const { error } = await supabase.auth.signInWithPassword({ email: staffEmail(phone), password: pin });
      if (error) throw new Error('Mobile number or PIN is wrong. Tap Forgot PIN or contact Admin.');
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-art">
        <div className="in">
          <img src="/logo-mark.png" alt="" width={84} height={84} style={{ borderRadius: 22, boxShadow: "0 0 0 3px rgba(255,255,255,.35)" }} />
          <h1>SToMS</h1>
          <span className="sbadge">SToMS</span>
          <div className="line" />
          <p className="tag">Operations made simple.</p>
        </div>
      </div>
      <div className="signin-form">
        <div className="signin-card">
          <div className="signin-tabs"><span className="on">Sign In</span><a href="/join">Sign Up</a></div>
          <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
            <div>
              <h2>Welcome back</h2>
              <p className="muted" style={{ marginTop: 2 }}>Sign in with your mobile number and PIN.</p>
            </div>
            <label className="field">
              <span>Mobile number</span>
              <input id="phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="10 digits" className="num" style={{ minHeight: 46 }} />
            </label>
            <label className="field">
              <span>PIN</span>
              <input id="pin" className="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••••" style={{ minHeight: 46 }} />
            </label>
            {error && <p className="banner bad" role="alert">{error}</p>}
            {note && <p className="banner ok" role="status">{note}</p>}
            <button className="go" disabled={busy}>{busy ? 'Please wait…' : 'Sign In'}</button>
            <button type="button" className="btn quiet orange" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => void forgot()}>Forgot PIN?</button>
            <p className="small muted">Trouble signing in? {adminLink ? <a href={adminLink} target="_blank" rel="noreferrer">Contact Admin</a> : 'Contact Admin'}</p>
          </form>
          <div className="small muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}><Brand size={22} /></div>
        </div>
      </div>
    </div>
  );
}

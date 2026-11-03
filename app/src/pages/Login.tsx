import { useEffect, useState, type FormEvent } from 'react';
import { supabase, staffEmail } from '../lib/supabase';
import { errText } from '../lib/format';
import { Icon } from '../components/Icon';

type Mode = 'staff' | 'owner' | 'owner-new';

export function Login() {
  const [mode, setMode] = useState<Mode>('staff');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  useEffect(() => { supabase.rpc('get_admin_contact').then(({ data }) => { if (typeof data === 'string') setAdminPhone(data); }); }, []);
  const adminLink = adminPhone ? `https://wa.me/91${adminPhone}?text=${encodeURIComponent(`Hi, I am having trouble signing in to SToMS.${/^[6-9][0-9]{9}$/.test(phone) ? ` My mobile number is ${phone}.` : ''}`)}` : '';

  async function forgot() {
    setError(''); setNote('');
    if (mode === 'staff') {
      if (!/^[6-9][0-9]{9}$/.test(phone)) return setError('Type your 10-digit mobile number above first, then tap Forgot PIN.');
      setBusy(true);
      const { error } = await supabase.rpc('request_pin_reset', { p_phone: phone });
      setBusy(false);
      if (error) return setError(errText(error));
      setNote('Done. Admin has been told and will give you a new PIN.');
    } else {
      if (!email.trim()) return setError('Type your email above first, then tap Forgot password.');
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      setBusy(false);
      if (error) return setError(errText(error));
      setNote('If that email is registered, a link to choose a new password is on its way. Check your inbox and spam.');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setNote(''); setBusy(true);
    try {
      if (mode === 'staff') {
        if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter your 10-digit mobile number.');
        if (!/^[0-9]{6}$/.test(pin)) throw new Error('Your PIN has 6 digits.');
        const { error } = await supabase.auth.signInWithPassword({ email: staffEmail(phone), password: pin });
        if (error) throw new Error('Mobile number or PIN is wrong. Tap Forgot PIN or contact Admin.');
      } else if (mode === 'owner') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        if (password.length < 8) throw new Error('Use at least 8 characters for the owner password.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) setNote('Check your email and tap the confirmation link, then sign in here.');
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <div className="split-form">
        <div className="logo"><img src="/logo-mark.png" alt="" /><b>SToMS</b><span className="small muted">Single Teas Operations Management System</span></div>
        <form onSubmit={submit}>
          <div>
            <h1 style={{ fontSize: 24, lineHeight: '32px' }}>{mode === 'owner-new' ? 'Set up your owner account' : 'Welcome back'}</h1>
            <p className="muted" style={{ marginTop: 4 }}>{mode === 'staff' ? 'Sign in with your mobile number and PIN.' : 'Sign in with your email.'}</p>
          </div>

          {mode === 'staff' ? (
            <>
              <label className="field">
                <span>Mobile number</span>
                <input id="phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="10 digits" className="num" style={{ minHeight: 40 }} />
              </label>
              <label className="field">
                <span>PIN</span>
                <input id="pin" className="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6}
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••••" style={{ minHeight: 40 }} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Email</span>
                <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ minHeight: 40 }} />
              </label>
              <label className="field">
                <span>{mode === 'owner-new' ? 'Choose a password' : 'Password'}</span>
                <input id="password" type="password" autoComplete={mode === 'owner-new' ? 'new-password' : 'current-password'}
                  value={password} onChange={(e) => setPassword(e.target.value)} style={{ minHeight: 40 }} />
              </label>
            </>
          )}

          {error && <p className="banner bad" role="alert">{error}</p>}
          {note && <p className="banner ok" role="status">{note}</p>}

          <button className="btn primary floor" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'owner-new' ? 'Create owner account' : 'Sign in'}
          </button>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            {mode === 'staff'
              ? <button type="button" className="btn quiet" onClick={() => setMode('owner')}>Owner sign in with email</button>
              : <button type="button" className="btn quiet" onClick={() => setMode('staff')}>Staff sign in with mobile</button>}
            {mode === 'owner' && <button type="button" className="btn quiet" onClick={() => setMode('owner-new')}>First time? Set up</button>}
          </div>
          {mode !== 'owner-new' && <button type="button" className="btn quiet" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => void forgot()}>{mode === 'staff' ? 'Forgot PIN?' : 'Forgot password?'}</button>}
          <p className="small muted">Trouble signing in? {adminLink ? <a href={adminLink} target="_blank" rel="noreferrer">Contact Admin</a> : 'Contact Admin'}</p>
          <a className="small" href="/join">New here? Join SToMS</a>
        </form>
        <p className="small muted">Internal use only · Single Teas Operations</p>
      </div>
      <div className="split-art">
        <div className="inner">
          <p className="label" style={{ color: 'inherit' }}>One place for the whole kitchen</p>
          <p className="big">Indents, store and purchases, without the WhatsApp chaos.</p>
          <div style={{ display: 'grid', gap: 14 }}>
            {['Counters send tomorrow\'s indent in under a minute', 'The store sees every request live, with SOS alarms', 'One sign in, then pick the app you need'].map((t) => (
              <div key={t} className="pt"><Icon name="check" /><span>{t}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

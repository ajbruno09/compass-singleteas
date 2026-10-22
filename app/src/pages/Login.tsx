import { useState, type FormEvent } from 'react';
import { supabase, staffEmail } from '../lib/supabase';
import { errText } from '../lib/format';

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setNote(''); setBusy(true);
    try {
      if (mode === 'staff') {
        if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter your 10-digit mobile number.');
        if (!/^[0-9]{6}$/.test(pin)) throw new Error('Your PIN has 6 digits.');
        const { error } = await supabase.auth.signInWithPassword({ email: staffEmail(phone), password: pin });
        if (error) throw new Error('Mobile number or PIN is wrong. Ask the owner to reset your PIN if you forgot it.');
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
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ gap: 10 }}>
          <img src="/icon.svg" alt="" width={40} height={40} />
          <div>
            <h1 style={{ fontSize: 26, lineHeight: '30px' }}>Compass</h1>
            <p className="small muted">Single Teas operations</p>
          </div>
        </div>

        {mode === 'staff' ? (
          <>
            <label className="field">
              <span>Mobile number</span>
              <input id="phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="10 digits" className="num" />
            </label>
            <label className="field">
              <span>PIN</span>
              <input id="pin" className="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Email</span>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>{mode === 'owner-new' ? 'Choose a password' : 'Password'}</span>
              <input id="password" type="password" autoComplete={mode === 'owner-new' ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} />
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
        <img src="/single-teas-logo.png" alt="Single Teas" width={44} height={44} style={{ justifySelf: 'center', opacity: 0.9 }} />
      </form>
    </div>
  );
}

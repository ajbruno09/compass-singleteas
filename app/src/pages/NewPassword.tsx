import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';

// Shown after the owner opens the password reset link from email.
export function NewPassword() {
  const { clearRecovery } = useSession();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (pw.length < 8) return setError('Use at least 8 characters.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(errText(error));
    clearRecovery();
  }
  return (
    <div className="login"><form className="card" onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
      <h1>Choose a new password</h1>
      <p className="muted">Pick something you will remember. You will use it with your email to sign in.</p>
      <label className="field"><span>New password</span><input id="newpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      {error && <p className="banner bad" role="alert">{error}</p>}
      <button className="btn primary floor" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    </form></div>
  );
}

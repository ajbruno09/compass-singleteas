import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { errText } from '../lib/format';

const weak = (p: string) => /^(\d)\1{5}$/.test(p) || p === '123456' || p === '654321' || p === '012345';

// Choose a new 6 digit PIN, typed twice. Used in first time setup and in My profile.
export function PinFields({ onDone, label = 'Save PIN' }: { onDone: () => void; label?: string }) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setError('');
    if (!/^[0-9]{6}$/.test(pin)) return setError('Your PIN must be 6 digits.');
    if (weak(pin)) return setError('That PIN is too easy to guess. Choose another.');
    if (pin !== again) return setError('The two PINs do not match.');
    setBusy(true);
    const { error: e } = await supabase.auth.updateUser({ password: pin });
    setBusy(false);
    if (e) return setError(errText(e));
    setPin(''); setAgain('');
    onDone();
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label className="field"><span>New PIN</span><input className="num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" style={{ minHeight: 46 }} /></label>
      <label className="field"><span>Type it again</span><input className="num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" style={{ minHeight: 46 }} /></label>
      {error && <p className="banner bad" role="alert">{error}</p>}
      <button className="btn primary big" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

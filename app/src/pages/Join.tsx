import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { selfieFromFile } from '../lib/photo';
import { errText } from '../lib/format';
import { Icon } from '../components/Icon';

// Self sign up for staff: name, mobile and one selfie. The owner approves and hands over the first code.
export function Join() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selfie, setSelfie] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return; setError('');
    try { setSelfie(await selfieFromFile(f)); } catch (e) { setError(errText(e)); }
  }
  async function send() {
    setError('');
    if (name.trim().length < 2) return setError('Please enter your name.');
    if (!/^[6-9][0-9]{9}$/.test(phone)) return setError('Enter your 10 digit mobile number.');
    if (!selfie) return setError('Please take a clear photo of your face.');
    setBusy(true);
    const { data, error } = await supabase.rpc('submit_signup', { p_name: name, p_phone: phone, p_locs: [], p_selfie: selfie });
    setBusy(false);
    if (error) return setError(errText(error));
    if (data !== 'ok') return setError(String(data));
    setDone(true);
  }

  if (done) return (
    <div className="login"><div className="card" style={{ display: 'grid', gap: 12, maxWidth: 380, textAlign: 'center' }}>
      <img src="/icon.svg" alt="" width={56} height={56} style={{ justifySelf: 'center' }} />
      <h1 style={{ fontSize: 22 }}>Thank you, {name.split(' ')[0]}</h1>
      <p>Your request is with the owner. Once approved, you will get your first code. Use it to sign in the first time.</p>
      <a className="btn secondary" href="/">Back to sign in</a>
    </div></div>
  );
  return (
    <div className="login"><div className="card" style={{ display: 'grid', gap: 14, maxWidth: 380, width: '100%' }}>
      <div className="logo"><img src="/icon.svg" alt="" /><b>Compass</b><span className="small muted">Single Teas</span></div>
      <h1 style={{ fontSize: 22 }}>Join Compass</h1>
      <p className="muted">Fill this once. The owner will approve you and give you your first code.</p>
      <label className="field"><span>Your name</span><input id="j-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} style={{ minHeight: 44 }} /></label>
      <label className="field"><span>Mobile number</span><input id="j-phone" className="num" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="10 digits" style={{ minHeight: 44 }} /></label>
      <div className="field"><span>Your photo (one clear photo of your face)</span>
        <div className="row" style={{ gap: 12 }}>
          {selfie ? <img src={selfie} alt="Your photo" width={88} height={88} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <div className="avatar" style={{ width: 88, height: 88 }}><Icon name="camera" size={28} /></div>}
          <label className="btn secondary" style={{ cursor: 'pointer' }}><Icon name="camera" /> {selfie ? 'Take again' : 'Take photo'}<input type="file" accept="image/*" capture="user" hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
        </div>
      </div>
      {error && <p className="banner bad" role="alert">{error}</p>}
      <button className="btn primary floor" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send to the owner'}</button>
      <a className="small muted" href="/">Already have a login? Sign in</a>
    </div></div>
  );
}

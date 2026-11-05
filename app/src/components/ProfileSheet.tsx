import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { selfieFromFile } from '../lib/photo';
import { bioEnabled, bioOff, bioOn, bioSupported } from '../lib/biolock';
import { usePush } from './PushSetup';
import { PinFields } from './PinFields';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { useToast } from './Toast';

// My profile: change the photo, PIN, fingerprint unlock, alerts and language whenever needed.
export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { profile, reload } = useSession();
  const toast = useToast();
  const push = usePush();
  const uid = profile?.id ?? '';
  const [ok, setOk] = useState(false);
  const [on, setOn] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void bioSupported().then(setOk); setOn(!!uid && bioEnabled(uid)); }, [uid]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await selfieFromFile(f);
      const { data: r, error } = await supabase.rpc('set_my_photo', { p_photo: data });
      if (error) throw error;
      if (r !== 'ok') throw new Error(String(r));
      toast('Photo saved'); await reload();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  async function setLang(l: string) {
    const { error } = await supabase.rpc('set_my_language', { p_lang: l });
    if (error) return toast(errText(error));
    await reload(); toast('Language saved');
  }

  return (
    <Sheet title="My profile" onClose={onClose} footer={<button className="btn secondary" onClick={onClose}>Close</button>}>
      <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
        {profile?.photo ? <img src={profile.photo} alt="" width={72} height={72} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <span className="avatar" style={{ width: 72, height: 72, fontSize: 28 }}>{(profile?.full_name || '?')[0]}</span>}
        <div><b>{profile?.full_name}</b><p className="small muted">{profile?.phone}</p>
          <label className="btn secondary" style={{ cursor: 'pointer', marginTop: 6 }}><Icon name="camera" /> {busy ? 'Saving…' : 'Retake photo'}
            <input type="file" accept="image/*" capture="user" hidden disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} /></label></div>
      </div>
      <section className="card" style={{ display: 'grid', gap: 10 }}>
        <b>PIN</b>
        {showPin ? <PinFields onDone={() => { setShowPin(false); toast('Your PIN is changed'); }} /> : <button className="btn secondary" style={{ justifySelf: 'start' }} onClick={() => setShowPin(true)}>Change my PIN</button>}
      </section>
      {ok && <section className="card row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div><b>Fingerprint or face unlock</b><p className="small muted">{on ? 'On for this phone' : 'Off'}</p></div>
        {on ? <button className="btn secondary" onClick={() => { bioOff(uid); setOn(false); }}>Turn off</button>
          : <button className="btn primary" onClick={async () => { try { await bioOn(uid, profile?.full_name || 'Compass'); setOn(true); } catch (e) { toast(errText(e)); } }}>Turn on</button>}
      </section>}
      <section className="card row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div><b>Alerts</b><p className="small muted">{push.state === 'on' ? 'On for this phone' : push.state === 'blocked' ? 'Blocked in the phone settings' : push.state === 'needs-install' ? 'Add Compass to your Home Screen first' : push.state === 'unsupported' ? 'Not available here' : 'Off'}</p></div>
        {push.state === 'off' && <button className="btn primary" disabled={push.busy} onClick={() => void push.turnOn()}>Turn on</button>}
      </section>
      <section className="card" style={{ display: 'grid', gap: 8 }}>
        <b>Language</b>
        <div className="row" style={{ gap: 8 }}>
          <button className={'btn ' + (profile?.extra_language === 'hi' ? 'secondary' : 'primary')} onClick={() => void setLang('')}>English</button>
          <button className={'btn ' + (profile?.extra_language === 'hi' ? 'primary' : 'secondary')} onClick={() => void setLang('hi')}>हिंदी</button>
        </div>
      </section>
      <p className="small muted">Compass · SToMS v{__APP_VERSION__}</p>
    </Sheet>
  );
}

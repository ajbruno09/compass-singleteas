import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { selfieFromFile } from '../lib/photo';
import { bioEnabled, bioOn, bioSupported } from '../lib/biolock';
import { usePush } from '../components/PushSetup';
import { PinFields } from '../components/PinFields';
import { Brand } from '../components/Brand';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

const STEPS = ['Your photo', 'Your own PIN', 'Fingerprint or face', 'Alerts', 'Language'];

// First time setup. Everyone does these steps once, in this order, before they see anything else.
export function Setup() {
  const { profile, reload, signOut } = useSession();
  const toast = useToast();
  const push = usePush();
  const uid = profile?.id ?? '';
  const [i, setI] = useState(0);
  const [pinDone, setPinDone] = useState(false);
  const [bioOk, setBioOk] = useState<boolean | null>(null);
  const [unlockOn, setUnlockOn] = useState(false);
  const [lang, setLang] = useState(profile?.extra_language === 'hi' ? 'hi' : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void bioSupported().then(setBioOk); setUnlockOn(!!uid && bioEnabled(uid)); }, [uid]);

  const photoDone = !!profile?.photo;
  const unlockDone = bioOk === false || unlockOn;
  const alertsDone = ['on', 'blocked', 'unsupported', 'needs-install'].includes(push.state);
  const done = [photoDone, pinDone, unlockDone, alertsDone, true];
  const canNext = done[i];

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await selfieFromFile(f);
      const { data: r, error } = await supabase.rpc('set_my_photo', { p_photo: data });
      if (error) throw error;
      if (r !== 'ok') throw new Error(String(r));
      await reload();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  async function unlock() {
    setBusy(true);
    try { await bioOn(uid, profile?.full_name || 'Compass'); setUnlockOn(true); } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  async function finish() {
    setBusy(true);
    const { error } = await supabase.rpc('complete_setup', { p_lang: lang });
    setBusy(false);
    if (error) return toast(errText(error));
    await reload();
  }

  return (
    <div className="setup"><div className="box">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <Brand size={26} />
        <button className="btn quiet" onClick={signOut}>Sign out</button>
      </div>
      <div>
        <p className="small muted">Step {i + 1} of {STEPS.length}</p>
        <div className="bar" aria-hidden><i style={{ width: `${((i + (canNext ? 1 : 0.4)) / STEPS.length) * 100}%` }} /></div>
        <h1 style={{ fontSize: 24, marginTop: 10 }}>{STEPS[i]}</h1>
      </div>

      {i === 0 && (
        <div style={{ display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center' }}>
          {profile?.photo ? <img src={profile.photo} alt="" width={132} height={132} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <span className="avatar" style={{ width: 132, height: 132, fontSize: 48 }}>{(profile?.full_name || '?')[0]}</span>}
          <p className="muted">Take a clear photo of your face. It is your picture in Compass and shows that this is you.</p>
          <label className="btn primary big" style={{ cursor: 'pointer' }}>
            <Icon name="camera" /> {busy ? 'Saving…' : photoDone ? 'Retake photo' : 'Take photo'}
            <input type="file" accept="image/*" capture="user" hidden disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
        </div>
      )}

      {i === 1 && (pinDone
        ? <p className="banner ok">Done. Use your new PIN from now on. Remember it, and do not share it.</p>
        : <><p className="muted">Choose a PIN that only you know. You will use it with your mobile number to sign in.</p><PinFields onDone={() => { setPinDone(true); toast('Your PIN is saved'); }} /></>)}

      {i === 2 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {bioOk === null && <p className="muted">Checking this phone…</p>}
          {bioOk === false && <p className="banner">This phone or computer cannot do fingerprint or face unlock, so there is nothing to set here. Tap Next.</p>}
          {bioOk && (unlockOn
            ? <p className="banner ok">Done. Next time, open Compass with your fingerprint or face.</p>
            : <><p className="muted">Open Compass with your fingerprint or face, with no need to type your PIN again on this phone.</p><button className="btn primary big" disabled={busy} onClick={() => void unlock()}>{busy ? 'Please wait…' : 'Turn on'}</button></>)}
        </div>
      )}

      {i === 3 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {push.state === 'checking' && <p className="muted">Checking this phone…</p>}
          {push.state === 'on' && <p className="banner ok">Done. Alerts will reach you even when Compass is closed.</p>}
          {push.state === 'off' && <><p className="muted">Turn on alerts so the store, SOS and indent reminders reach you even when Compass is closed.</p><button className="btn primary big" disabled={push.busy} onClick={() => void push.turnOn()}>{push.busy ? 'Please wait…' : 'Turn on alerts'}</button></>}
          {push.state === 'blocked' && <p className="banner warn">Alerts are blocked on this phone. Open the phone settings, allow notifications for Compass, and then open Compass again. You can continue for now.</p>}
          {push.state === 'needs-install' && <p className="banner">On an iPhone, open this page in Safari, tap Share, then Add to Home Screen, and open Compass from there to get alerts. You can continue for now.</p>}
          {push.state === 'unsupported' && <p className="banner">This device cannot show alerts. You can continue.</p>}
        </div>
      )}

      {i === 4 && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p className="muted">Choose the language for your screens.</p>
          <button className={'btn big ' + (lang === '' ? 'primary' : 'secondary')} onClick={() => setLang('')}>English</button>
          <button className={'btn big ' + (lang === 'hi' ? 'primary' : 'secondary')} onClick={() => setLang('hi')}>हिंदी (Hindi)</button>
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: 'space-between' }}>
        <button className="btn quiet" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
        {i < STEPS.length - 1
          ? <button className="btn primary big" disabled={!canNext} onClick={() => setI(i + 1)}>Next</button>
          : <button className="btn primary big" disabled={busy} onClick={() => void finish()}>{busy ? 'Please wait…' : 'Finish'}</button>}
      </div>
    </div></div>
  );
}

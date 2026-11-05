import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { usePush } from './PushSetup';
import { bioEnabled, bioOn, bioSupported } from '../lib/biolock';
import { alarmUnlocked, testBeep, unlockAlarm } from '../lib/alarm';
import { errText } from '../lib/format';
import { BellRing, Check, Fingerprint, Siren } from 'lucide-react';
import { useToast } from './Toast';

interface Chip { key: string; icon: string; label: string; on: boolean; hint: string; act?: () => void; busy?: boolean }

// One neat row that shows what is switched on for this phone, and lets you switch on what is not.
export function StatusStrip() {
  const { profile } = useSession();
  const toast = useToast();
  const push = usePush();
  const uid = profile?.id ?? '';
  const [bioOk, setBioOk] = useState(false);
  const [bio, setBio] = useState(false);
  const [armed, setArmed] = useState(alarmUnlocked());
  const [busy, setBusy] = useState(false);
  useEffect(() => { void bioSupported().then(setBioOk); setBio(!!uid && bioEnabled(uid)); }, [uid]);
  if (!profile) return null;
  const watching = ['store', 'owner', 'manager'].includes(profile.role);

  const chips: Chip[] = [];
  if (push.state !== 'unsupported' && push.state !== 'checking')
    chips.push(push.state === 'on'
      ? { key: 'alerts', icon: 'bell', label: 'Alerts', on: true, hint: 'Alerts are on for this phone' }
      : push.state === 'blocked'
        ? { key: 'alerts', icon: 'bell', label: 'Alerts blocked', on: false, hint: 'Allow notifications for SToMS in the phone settings', act: () => toast('Open the phone settings and allow notifications for SToMS') }
        : push.state === 'needs-install'
          ? { key: 'alerts', icon: 'bell', label: 'Alerts', on: false, hint: 'On an iPhone: Share, then Add to Home Screen', act: () => toast('Open in Safari, tap Share, then Add to Home Screen') }
          : { key: 'alerts', icon: 'bell', label: 'Turn on alerts', on: false, hint: 'Get alerts even when SToMS is closed', act: () => void push.turnOn(), busy: push.busy });
  if (bioOk)
    chips.push(bio
      ? { key: 'bio', icon: 'finger', label: 'Fingerprint', on: true, hint: 'Fingerprint or face unlock is on' }
      : { key: 'bio', icon: 'finger', label: 'Turn on fingerprint', on: false, hint: 'Open SToMS with your fingerprint or face', busy, act: async () => { setBusy(true); try { await bioOn(uid, profile.full_name || 'SToMS'); setBio(true); } catch (e) { toast(errText(e)); } finally { setBusy(false); } } } as Chip);
  if (watching)
    chips.push(armed
      ? { key: 'sos', icon: 'siren', label: 'SOS sound', on: true, hint: 'SOS siren is on. Tap to test the sound', act: () => testBeep() }
      : { key: 'sos', icon: 'siren', label: 'Turn on SOS sound', on: false, hint: 'Tap once so the SOS siren can ring on this phone', act: () => { setArmed(unlockAlarm()); testBeep(); window.dispatchEvent(new Event('compass-armed')); } });
  if (!chips.length) return null;
  return (
    <div className="statusstrip" role="group" aria-label="This phone">
      {chips.map((c) => (
        <button key={c.key} className={'stat ' + (c.on ? 'on' : 'off') + (c.key === 'sos' ? ' sos' : '')} title={c.hint} disabled={c.busy || (!c.act)} onClick={c.act} aria-label={c.hint}>
          {c.icon === 'bell' ? <BellRing size={18} strokeWidth={2} /> : c.icon === 'finger' ? <Fingerprint size={18} strokeWidth={2} /> : <Siren size={18} strokeWidth={2} />}<span>{c.busy ? 'Please wait…' : c.label}</span>{c.on ? <Check size={15} strokeWidth={2.6} /> : null}
        </button>
      ))}
    </div>
  );
}

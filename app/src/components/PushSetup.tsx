import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { errText } from '../lib/format';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function publicKey(): Promise<string> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/send-push';
  const r = await fetch(base, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string } });
  return ((await r.json()) as { key: string }).key;
}

async function save(profileId: string, sub: PushSubscription) {
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    profile_id: profileId, endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '', user_agent: navigator.userAgent.slice(0, 200), last_seen: new Date().toISOString()
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

// One tap on each phone. After that, alerts arrive even when Compass is closed.
export type PushState = 'checking' | 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-install';
export function usePush() {
  const { profile } = useSession();
  const toast = useToast();
  const [state, setState] = useState<PushState>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    if (isIos() && !standalone()) { setState('needs-install'); return; }
    if (!supported()) { setState('unsupported'); return; }
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') {
        try { await save(profile.id, sub); const { data } = await supabase.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).eq('profile_id', profile.id).limit(1); setState(data && data.length ? 'on' : 'off'); } catch { setState('off'); }
      } else setState('off');
    }).catch(() => setState('off'));
  }, [profile]);

  async function turnOn() {
    if (!profile) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const key = await publicKey();
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      await save(profile.id, sub);
      setState('on'); toast('Alerts are on for this phone');
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return { state, busy, turnOn };
}

export function PushSetup() {
  const { state, busy, turnOn } = usePush();
  if (state === 'checking' || state === 'on') return state === 'on' ? <p className="small muted row" style={{ gap: 6 }}><Icon name="bell" size={16} /> Alerts are on for this phone.</p> : null;
  if (state === 'needs-install') return <p className="banner">To get alerts on an iPhone, open this page in Safari, tap Share, then Add to Home Screen, and open Compass from there.</p>;
  if (state === 'unsupported') return null;
  if (state === 'blocked') return <p className="banner warn">Alerts are blocked for Compass on this phone. Allow notifications for Compass in the phone settings.</p>;
  return <button className="banner warn alarmbar" disabled={busy} onClick={turnOn}><Icon name="bell" /> Tap here to turn on alerts, so Compass can reach you even when it is closed</button>;
}

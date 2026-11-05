import { useState } from 'react';
import { useSession } from '../lib/session';
import { Brand } from '../components/Brand';

export const welcomeKey = (uid: string) => `compass-welcome-${uid}`;
export const welcomeLangKey = (uid: string) => `compass-welcome-lang-${uid}`;
export function welcomed(uid: string) { try { return localStorage.getItem(welcomeKey(uid)) === '1'; } catch { return false; } }
export function welcomeLang(uid: string): '' | 'hi' { try { return localStorage.getItem(welcomeLangKey(uid)) === 'hi' ? 'hi' : ''; } catch { return ''; } }

const TEXT = {
  en: {
    hi: (n: string) => `Hi${n ? `, ${n}` : ''}. Welcome to SToMS.`,
    intro: 'SToMS is the Single Teas Operations Management System. It is made to make your work easy.',
    here: 'Here you will:',
    l1: ['Send your ', 'daily indent', ', to ask for what you need'],
    l2: ['Do your ', 'daily closing stock', ' and ', 'weekly closing stock'],
    l3: ['Soon, see your ', 'sales targets', ' and ', 'incentives'],
    simple: 'Everything is simple, short and in plain English.',
    lang: 'You can choose Hindi or English, whichever you like. You can change it any time.',
    setup: 'Before you start, you need to set up your profile. It takes only a few minutes.',
    agree: 'I agree', no: 'Not now'
  },
  hi: {
    hi: (n: string) => `नमस्ते${n ? `, ${n}` : ''}। SToMS में आपका स्वागत है।`,
    intro: 'SToMS, Single Teas का Operations Management System है। इसे आपके काम को आसान बनाने के लिए बनाया गया है।',
    here: 'यहाँ आप:',
    l1: ['अपनी ज़रूरत का सामान माँगने के लिए ', 'रोज़ का indent', ' भेजेंगे'],
    l2: ['', 'रोज़ का closing stock', ' और ', 'हफ़्ते का closing stock', ' करेंगे'],
    l3: ['जल्द ही अपने ', 'sales target', ' और ', 'incentive', ' देखेंगे'],
    simple: 'सब कुछ आसान, छोटा और सीधी भाषा में है।',
    lang: 'आप हिंदी या English, जो अच्छी लगे चुन सकते हैं। इसे कभी भी बदल सकते हैं।',
    setup: 'शुरू करने से पहले आपको अपनी profile set up करनी होगी। इसमें बस कुछ मिनट लगते हैं।',
    agree: 'मैं सहमत हूँ', no: 'अभी नहीं'
  }
} as const;

// First screen after the very first sign in. Language can be picked right here. One tap on "I agree" and setup begins.
export function Welcome({ onAgree }: { onAgree: () => void }) {
  const { profile, signOut } = useSession();
  const uid = profile?.id ?? '';
  const [lang, setLang] = useState<'' | 'hi'>(welcomeLang(uid));
  const first = (profile?.full_name ?? '').split(' ')[0];
  const x = TEXT[lang === 'hi' ? 'hi' : 'en'];
  function pick(l: '' | 'hi') { setLang(l); try { localStorage.setItem(welcomeLangKey(uid), l); } catch { /* ignore */ } }
  function agree() { try { localStorage.setItem(welcomeKey(uid), '1'); } catch { /* ignore */ } onAgree(); }
  const line = (parts: readonly string[]) => parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : p));
  return (
    <div className="setup"><div className="box">
      <Brand />
      <div className="langsw" role="group" aria-label="Language" style={{ justifySelf: 'end' }}>
        <button aria-pressed={lang === 'hi'} onClick={() => pick('hi')}>हिंदी</button>
        <button aria-pressed={lang === ''} onClick={() => pick('')}>English</button>
      </div>
      <h1>{x.hi(first)}</h1>
      <p>{x.intro}</p>
      <p>{x.here}</p>
      <ul className="stack">
        <li>{line(x.l1)}</li>
        <li>{line(x.l2)}</li>
        <li>{line(x.l3)}</li>
      </ul>
      <p>{x.simple}</p>
      <p>{x.lang}</p>
      <p>{x.setup}</p>
      <button className="btn primary" style={{ fontSize: 18, padding: '16px 20px' }} onClick={agree}>{x.agree}</button>
      <button className="btn secondary" onClick={signOut}>{x.no}</button>
    </div></div>
  );
}

import { useState } from 'react';
import { Brand } from '../components/Brand';

// Links opened from WhatsApp, Facebook or Instagram open inside that app's own small browser, where installing the app and
// fingerprint do not work. This screen asks the person to open the same link in their real browser.
export function inAppBrowser(): 'android' | 'ios' | null {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  if (standalone) return null;
  const named = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|Twitter|LinkedInApp/i.test(ua);
  if (/android/i.test(ua)) return named || /; wv\)/.test(ua) ? 'android' : null;
  if (/iphone|ipad|ipod/i.test(ua)) return named || !/Safari\//.test(ua) ? 'ios' : null;
  return null;
}

export function OpenInChrome({ kind }: { kind: 'android' | 'ios' }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;
  const intent = `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;package=com.android.chrome;end`;
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* ignore */ } }
  return (
    <div className="login"><div className="card" style={{ display: 'grid', gap: 12 }}>
      <Brand />
      <h1>Please open in your browser</h1>
      <p>This page is open inside another app (like WhatsApp). Compass works properly only in your phone's browser.</p>
      {kind === 'android' ? (
        <>
          <a className="btn primary big" href={intent} style={{ textAlign: 'center', textDecoration: 'none' }}>Open in Chrome</a>
          <p className="small muted">If that does not work: tap the <b>three dots</b> at the top right, then tap <b>Open in Chrome</b> (or <b>Open in browser</b>).</p>
        </>
      ) : (
        <p>Tap the <b>three dots</b> or the <b>compass icon</b> at the bottom right, then tap <b>Open in Safari</b>.</p>
      )}
      <button className="btn secondary" onClick={copy}>{copied ? 'Link copied. Paste it in your browser' : 'Copy link'}</button>
    </div></div>
  );
}

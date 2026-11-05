import { useEffect, useState } from 'react';

// Shown at the top when the phone has no internet, so nobody thinks something was sent when it was not.
export function OfflineBar() {
  const [off, setOff] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const a = () => setOff(true), b = () => setOff(false);
    window.addEventListener('offline', a); window.addEventListener('online', b);
    return () => { window.removeEventListener('offline', a); window.removeEventListener('online', b); };
  }, []);
  if (!off) return null;
  return <div role="alert" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#B3261E', color: '#fff', padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>No internet. Nothing you do now will be sent. Please check your connection.</div>;
}

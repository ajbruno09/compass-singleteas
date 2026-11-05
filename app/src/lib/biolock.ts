// Fingerprint or face unlock for this phone. It is a lock on the app (the phone's own check), so people
// do not have to type anything. The sign in itself stays remembered on the phone.
const key = (uid: string) => `compass-lock-${uid}`;
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rnd = () => crypto.getRandomValues(new Uint8Array(32));

export async function bioSupported(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}
export function bioEnabled(uid: string): boolean { try { return !!localStorage.getItem(key(uid)); } catch { return false; } }
export function bioOff(uid: string) { try { localStorage.removeItem(key(uid)); } catch { /* ignore */ } }
export async function bioOn(uid: string, name: string): Promise<void> {
  const cred = (await navigator.credentials.create({ publicKey: {
    challenge: rnd(), rp: { name: 'SToMS' },
    user: { id: new TextEncoder().encode(uid), name, displayName: name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000
  } })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Not set up.');
  try { localStorage.setItem(key(uid), b64(cred.rawId)); } catch { throw new Error('This phone would not save the setting.'); }
}
export async function bioCheck(uid: string): Promise<boolean> {
  let id = ''; try { id = localStorage.getItem(key(uid)) ?? ''; } catch { /* ignore */ }
  if (!id) return true;
  const got = await navigator.credentials.get({ publicKey: {
    challenge: rnd(), allowCredentials: [{ id: unb64(id), type: 'public-key', transports: ['internal'] }], userVerification: 'required', timeout: 60000
  } });
  return !!got;
}

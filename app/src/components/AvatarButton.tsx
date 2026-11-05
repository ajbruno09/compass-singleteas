import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';

// The person's own round photo (or first letter), shown on every screen. Tap to open My profile.
export function AvatarButton({ size = 36 }: { size?: number }) {
  const { profile } = useSession();
  const nav = useNavigate();
  return (
    <button className="btn quiet" style={{ padding: 0, minHeight: 0, borderRadius: '50%' }} onClick={() => nav('/profile')} aria-label="My profile">
      {profile?.photo
        ? <img src={profile.photo} alt="" width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
        : <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.45 }}>{(profile?.full_name || '?')[0]}</span>}
    </button>
  );
}

import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { ProfileBody } from '../components/ProfileSheet';
import { Icon } from '../components/Icon';
import { AvatarButton } from '../components/AvatarButton';

// My profile as a full page: photo, name, counters, PIN, fingerprint, alerts, language, sign out.
export function ProfilePage() {
  const nav = useNavigate();
  const { signOut } = useSession();
  return (
    <div className="phone">
      <div className="phone-head">
        <button className="btn quiet" onClick={() => nav('/')}><Icon name="back" /> Back</button>
        <b>My profile</b>
        <AvatarButton />
      </div>
      <div className="stack"><ProfileBody /></div>
      <button className="btn secondary" style={{ marginTop: 12 }} onClick={signOut}><Icon name="out" /> Sign out</button>
    </div>
  );
}

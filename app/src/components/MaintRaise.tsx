import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { errText } from '../lib/format';
import { useToast } from './Toast';
import { Icon } from './Icon';

export const MAINT_CATS = ['Burner and gas', 'Kitchen exhaust', 'Plumbing and water', 'Electrical', 'Refrigeration', 'Equipment', 'Pest control', 'Civil work', 'Other'];
const OTHER_PLACES = ['Washroom', 'Main kitchen', 'Dining area', 'Outside'];
const URG: [string, string, string][] = [['wait', 'Can wait', 'Fix when convenient'], ['today', 'Today', 'Please fix today'], ['urgent', 'Urgent', 'Stops work, or unsafe']];

// Phone photos are big. Shrink to about 1280px so uploads are quick on mobile data.
async function shrink(f: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
    const b: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    return b ?? f;
  } catch { return f; }
}

export function MaintRaise({ onDone }: { onDone: () => void }) {
  const { myLocations } = useSession();
  const toast = useToast();
  const [cat, setCat] = useState('');
  const [where, setWhere] = useState(myLocations[0]?.name ?? '');
  const [note, setNote] = useState('');
  const [urg, setUrg] = useState('');
  const [files, setFiles] = useState<{ blob: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const places = [...myLocations.map((l) => l.name), ...OTHER_PLACES];
  const locId = myLocations.find((l) => l.name === where)?.id ?? null;
  const need = [!cat && 'what is wrong', !where && 'where', !note.trim() && !files.length && 'a line or a photo', !urg && 'how urgent'].filter(Boolean) as string[];
  const addPics = (list: FileList | null) => {
    if (!list) return;
    const add = Array.from(list).slice(0, 3 - files.length).map((f) => ({ blob: f, url: URL.createObjectURL(f) }));
    setFiles((x) => [...x, ...add].slice(0, 3));
  };
  async function send() {
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const f of files) {
        const b = await shrink(f.blob);
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await supabase.storage.from('maint-photos').upload(path, b, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
        paths.push(path);
      }
      const { error } = await supabase.rpc('raise_maint_request', { p_category: cat, p_where: where, p_location: locId, p_note: note.trim(), p_urgency: urg, p_photos: paths });
      if (error) throw error;
      toast('Request sent');
      window.dispatchEvent(new Event('compass:maint'));
      onDone();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <div><div className="label">1. What is wrong?</div>
        <div className="sosgrid" style={{ marginTop: 6 }}>{MAINT_CATS.map((c) => <button key={c} className="sosopt" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div></div>
      <div><div className="label">2. Where?</div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>{places.map((p) => <button key={p} className="sosopt" style={{ minHeight: 40, fontSize: 14 }} aria-pressed={where === p} onClick={() => setWhere(p)}>{p}</button>)}</div></div>
      <div><div className="label">3. Tell us a little</div>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: back burner will not light" style={{ width: '100%', marginTop: 6 }} /></div>
      <div><div className="label">4. Photos (up to 3)</div>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          {files.map((f, i) => (
            <div key={f.url} style={{ position: 'relative' }}>
              <img src={f.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />
              <button className="btn quiet" aria-label="Remove photo" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -8, right: -8, background: '#1d2a25', color: '#fff', borderRadius: '50%', width: 22, height: 22, minHeight: 0, padding: 0 }}><Icon name="close" size={12} /></button>
            </div>
          ))}
          {files.length < 3 && <label className="btn secondary" style={{ cursor: 'pointer' }}><Icon name="camera" /> {files.length ? 'Add another' : 'Take a photo'}
            <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addPics(e.target.files); e.target.value = ''; }} /></label>}
        </div></div>
      <div><div className="label">5. How urgent?</div>
        <div className="sosgrid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginTop: 6 }}>{URG.map(([k, l]) => <button key={k} className={'sosopt' + (k === 'urgent' ? ' reason' : '')} aria-pressed={urg === k} onClick={() => setUrg(k)}>{l}</button>)}</div>
        {urg && <div className="small muted" style={{ marginTop: 4 }}>{URG.find((u) => u[0] === urg)?.[2]}</div>}</div>
      <button className="btn primary" disabled={busy || need.length > 0} onClick={send}>{busy ? 'Sending...' : 'Send request'}</button>
      {need.length > 0 && <div className="small muted" style={{ textAlign: 'center' }}>Still needed: {need.join(', ')}</div>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface NoticeFile { path: string; name: string; size: number; type: string }

const kb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const kind = (f: { name: string; type?: string }) => {
  const e = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (f.type?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif'].includes(e)) return { t: 'IMG', c: '#7A5AB8', img: true };
  if (e === 'pdf') return { t: 'PDF', c: '#B02A1E', img: false };
  if (['xls', 'xlsx', 'csv'].includes(e)) return { t: 'XLS', c: '#1B6A4D', img: false };
  if (['doc', 'docx'].includes(e)) return { t: 'DOC', c: '#1D4F91', img: false };
  return { t: e.slice(0, 3).toUpperCase() || 'FILE', c: '#6E7A75', img: false };
};

// Files that came with a notice. Tap opens the file in a new tab; pictures show a small preview.
export function NoticeFiles({ files }: { files?: NoticeFile[] | null }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = files ?? [];
    if (!list.length) return;
    let live = true;
    void Promise.all(list.map(async (f) => { const { data } = await supabase.storage.from('notice-files').createSignedUrl(f.path, 3600); return [f.path, data?.signedUrl ?? ''] as const; }))
      .then((p) => { if (live) setUrls(Object.fromEntries(p)); });
    return () => { live = false; };
  }, [files]);
  if (!files?.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {files.map((f) => {
        const k = kind(f); const u = urls[f.path];
        return (
          <a key={f.path} href={u || undefined} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!u) e.preventDefault(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line2, #D3DAD6)', borderRadius: 10, padding: 8, textDecoration: 'none', color: 'inherit', background: '#fff' }}>
            {k.img && u ? <img src={u} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} /> : <span style={{ width: 44, height: 44, borderRadius: 8, background: k.c, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>{k.t}</span>}
            <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</b><span className="small muted">{kb(f.size)} · tap to open</span></span>
          </a>);
      })}
    </div>
  );
}

export { kind as fileKind, kb as fileSize };

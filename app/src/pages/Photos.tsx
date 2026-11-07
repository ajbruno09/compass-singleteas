import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { errText } from '../lib/format';

interface It { id: number; name: string; photo_path: string | null }
interface Pic { key: string; name: string; blob: Blob; ext: string; url: string; itemId: number | 'skip' | 'ambiguous' | ''; sure: boolean }
const EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]/g, '');

export function Photos() {
  const toast = useToast();
  const [items, setItems] = useState<It[]>([]);
  const [pics, setPics] = useState<Pic[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => { const { data } = await supabase.from('items').select('id, name, photo_path').order('name'); setItems((data as It[]) ?? []); };
  useEffect(() => { void load(); }, []);
  const byKey = useMemo(() => { const m = new Map<string, It[]>(); for (const i of items) { const k = norm(i.name); m.set(k, [...(m.get(k) ?? []), i]); } return m; }, [items]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  async function pick(files: FileList | null) {
    if (!files || !files.length) return;
    setMsg(''); setBusy(true);
    const found: { name: string; blob: Blob; ext: string }[] = []; const skip: string[] = [];
    for (const f of Array.from(files)) {
      if (/\.zip$/i.test(f.name)) {
        const JSZip = (await import('jszip')).default;
        const z = await JSZip.loadAsync(f);
        for (const e of Object.values(z.files)) {
          if (e.dir) continue;
          const base = e.name.split('/').pop() ?? e.name;
          if (e.name.startsWith('__MACOSX') || base.startsWith('.')) continue;
          const ext = (base.split('.').pop() ?? '').toLowerCase();
          if (!EXT[ext]) { skip.push(base); continue; }
          found.push({ name: base, blob: new Blob([await e.async('arraybuffer')], { type: EXT[ext] }), ext });
        }
      } else {
        const ext = (f.name.split('.').pop() ?? '').toLowerCase();
        if (!EXT[ext]) { skip.push(f.name); continue; }
        found.push({ name: f.name, blob: f, ext });
      }
    }
    const next: Pic[] = found.map((p) => {
      const k = norm(p.name); const hit = byKey.get(k);
      let itemId: Pic['itemId'] = ''; let sure = false;
      if (hit && hit.length === 1) { itemId = hit[0].id; sure = true; }
      else if (hit && hit.length > 1) itemId = 'ambiguous';
      else {
        const cands = items.filter((i) => { const ik = norm(i.name); return k.length > 3 && (ik.startsWith(k) || k.startsWith(ik)); });
        if (cands.length === 1) itemId = cands[0].id;
      }
      return { key: p.name + Math.random(), name: p.name, blob: p.blob, ext: p.ext, url: URL.createObjectURL(p.blob), itemId, sure };
    });
    setPics(next); setSkipped(skip); setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  const ready = pics.filter((p) => typeof p.itemId === 'number' && (replace || !itemById.get(p.itemId as number)?.photo_path));
  const heldBack = pics.filter((p) => typeof p.itemId === 'number' && !replace && itemById.get(p.itemId as number)?.photo_path);
  const unsure = pics.filter((p) => typeof p.itemId !== 'number' || !p.sure);
  const dupTargets = (() => { const c: Record<number, number> = {}; for (const p of ready) c[p.itemId as number] = (c[p.itemId as number] ?? 0) + 1; return new Set(Object.keys(c).filter((k) => c[Number(k)] > 1).map(Number)); })();

  async function save() {
    const todo = ready.filter((p) => !dupTargets.has(p.itemId as number));
    if (!todo.length) { setMsg('Nothing to save yet.'); return; }
    setBusy(true); let done = 0; const fail: string[] = [];
    const queue = [...todo];
    const worker = async () => {
      for (;;) {
        const p = queue.shift(); if (!p) return;
        try {
          const id = p.itemId as number; const path = `${id}/${Date.now()}.${p.ext === 'jpeg' ? 'jpg' : p.ext}`;
          const up = await supabase.storage.from('item-photos').upload(path, p.blob, { upsert: true, contentType: EXT[p.ext] });
          if (up.error) throw up.error;
          const { error } = await supabase.from('items').update({ photo_path: path }).eq('id', id);
          if (error) throw error;
          done += 1; setProg(`Saving ${done} of ${todo.length}…`);
        } catch (e) { fail.push(`${p.name}: ${errText(e)}`); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setBusy(false); setProg('');
    const ok = new Set(todo.map((p) => p.key)); fail.forEach(() => undefined);
    setMsg(`Saved ${done} photo${done === 1 ? '' : 's'}.${fail.length ? ` ${fail.length} failed: ${fail.slice(0, 3).join('; ')}` : ''}`);
    toast(`Saved ${done} photos`);
    setPics((cur) => cur.filter((p) => !ok.has(p.key) || fail.some((f) => f.startsWith(p.name))));
    void load();
  }

  const withPhoto = items.filter((i) => i.photo_path).length;
  return (
    <>
      <div className="pagehead"><div><p className="label">Masters</p><h1>Item photos</h1><p className="muted small" style={{ marginTop: 2 }}>{withPhoto} of {items.length} items have a photo. Drop in a zip folder or images. Each file is matched to the item with the same name, and you check it before anything is saved.</p></div></div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <input ref={fileRef} type="file" multiple accept=".zip,image/*" onChange={(e) => void pick(e.target.files)} disabled={busy} />
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace photos that items already have</label>
      </div>
      {pics.length > 0 && (
        <>
          <div className="card" style={{ display: 'grid', gap: 4 }}>
            <b>{pics.length} photos read</b>
            <span className="small">Ready to save: <b>{ready.filter((p) => !dupTargets.has(p.itemId as number)).length}</b>{heldBack.length > 0 && <> · Already have a photo, left alone: <b>{heldBack.length}</b></>} · Need your choice: <b>{unsure.filter((p) => typeof p.itemId !== 'number').length}</b></span>
            {skipped.length > 0 && <span className="small muted">Skipped, not a JPG, PNG or WebP: {skipped.slice(0, 5).join(', ')}{skipped.length > 5 ? ` and ${skipped.length - 5} more` : ''}</span>}
            {dupTargets.size > 0 && <span className="small" style={{ color: 'var(--bad)' }}>Two photos point to the same item ({Array.from(dupTargets).map((i) => itemById.get(i)?.name).join(', ')}). Fix one of them below.</span>}
          </div>
          <div className="stack">
            {[...pics].sort((a, b) => Number(a.sure) - Number(b.sure)).map((p) => (
              <div key={p.key} className="card row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'center' }}>
                <img src={p.url} alt="" width={56} height={56} style={{ borderRadius: 8, objectFit: 'cover', background: '#fff' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <select value={String(p.itemId)} onChange={(e) => { const v = e.target.value; setPics((cur) => cur.map((x) => x.key === p.key ? { ...x, itemId: v === 'skip' || v === '' || v === 'ambiguous' ? (v as Pic['itemId']) : Number(v), sure: v !== '' && v !== 'ambiguous' } : x)); }} style={{ width: '100%' }}>
                    <option value="">{p.itemId === 'ambiguous' ? 'Several items share this name, choose one' : 'Choose the item…'}</option>
                    <option value="skip">Skip this photo</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.photo_path ? ' (has photo)' : ''}</option>)}
                  </select>
                </div>
                <span className={'chip ' + (typeof p.itemId === 'number' ? (p.sure ? 'done' : 'late') : p.itemId === 'skip' ? 'off' : 'flag')}>{typeof p.itemId === 'number' ? (p.sure ? 'Matched' : 'Check') : p.itemId === 'skip' ? 'Skip' : 'Choose'}</span>
              </div>
            ))}
          </div>
          <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingBottom: 8, display: 'grid', gap: 6 }}>
            {prog && <span className="small muted">{prog}</span>}
            <button className="btn primary" style={{ minHeight: 48 }} disabled={busy || ready.length === 0} onClick={() => void save()}>{busy ? 'Working…' : `Save ${ready.filter((p) => !dupTargets.has(p.itemId as number)).length} photos`}</button>
          </div>
        </>
      )}
      {msg && <p className="banner" role="status">{msg}</p>}
    </>
  );
}

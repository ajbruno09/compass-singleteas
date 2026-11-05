import { useEffect, useRef, useState } from 'react';
import pico from '../lib/pico';
import { selfieFromFile } from '../lib/photo';
import { Icon } from './Icon';

type Tone = 'bad' | 'warn' | 'ok';
interface Props { busy?: boolean; onPhoto: (dataUrl: string) => void | Promise<void>; onError?: (m: string) => void }

const W = 240; // width of the small picture the face finder looks at
const need = 3; // good looks in a row before the photo is taken by itself

// Live camera with a face shaped ring. The ring is red or amber until the face sits right, then glows green and the photo is taken.
// The face finder runs on the phone only. If the camera is blocked or not available, the normal photo button is shown instead.
export function FaceCam({ busy, onPhoto, onError }: Props) {
  const vid = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'start' | 'cam' | 'fallback'>('start');
  const [msg, setMsg] = useState('Starting the camera…');
  const [tone, setTone] = useState<Tone>('warn');
  const [finder, setFinder] = useState(false);
  const [done, setDone] = useState(false);
  const [late, setLate] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const last = useRef<{ cx: number; cy: number; s: number; w: number; h: number } | null>(null);
  const taken = useRef(false);

  async function grab() {
    const v = vid.current; if (!v || !v.videoWidth || taken.current) return;
    taken.current = true;
    const f = last.current;
    const vw = v.videoWidth, vh = v.videoHeight; const side0 = Math.min(vw, vh);
    let side = side0, cx = vw / 2, cy = vh / 2;
    if (f) { const k = vw / f.w; side = Math.min(side0, f.s * k * 2.1); cx = f.cx * k; cy = f.cy * k; }
    cx = Math.min(Math.max(cx, side / 2), vw - side / 2); cy = Math.min(Math.max(cy, side / 2), vh - side / 2);
    const c = document.createElement('canvas'); c.width = 320; c.height = 320;
    const g = c.getContext('2d'); if (!g) { taken.current = false; return; }
    g.drawImage(v, cx - side / 2, cy - side / 2, side, side, 0, 0, 320, 320);
    let out = '';
    for (const q of [0.72, 0.6, 0.5]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 110000) { out = d; break; } }
    if (!out) { taken.current = false; onError?.('The photo is too large. Try again.'); return; }
    setDone(true);
    window.setTimeout(() => { void onPhoto(out); }, 650);
  }

  useEffect(() => {
    let stop = false; let timer = 0; let streak = 0; let lateTimer = 0;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setMode('fallback'); setMsg('This phone cannot show the camera here. Use the button below.'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = vid.current; if (!v) return;
        v.srcObject = s; await v.play().catch(() => undefined);
        setMode('cam'); setMsg('Look at the camera'); lateTimer = window.setTimeout(() => setLate(true), 8000);
      } catch (e) {
        const n = (e as { name?: string }).name;
        setMode('fallback'); setMsg(n === 'NotAllowedError' ? 'The camera is blocked. Allow the camera for this page in the phone settings, or use the button below.' : 'The camera could not start. Use the button below.');
        return;
      }
      let classify: ((r: number, c: number, s: number, p: Uint8Array, l: number) => number) | null = null;
      let memory: ((d: number[][]) => number[][]) | null = null;
      try {
        const buf = await (await fetch('/face/facefinder.bin')).arrayBuffer();
        classify = pico.unpack_cascade(new Int8Array(buf)); memory = pico.instantiate_detection_memory(5); setFinder(true);
      } catch { setFinder(false); setMsg('Fit your face in the ring, then tap Take photo'); }
      if (!classify || !memory || stop) return;
      const cv = document.createElement('canvas'); const ctx = cv.getContext('2d', { willReadFrequently: true });
      timer = window.setInterval(() => {
        const v = vid.current; if (!v || !ctx || !v.videoWidth || taken.current) return;
        const H = Math.round(W * v.videoHeight / v.videoWidth); cv.width = W; cv.height = H;
        ctx.drawImage(v, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data; const gray = new Uint8Array(W * H); let sum = 0;
        for (let i = 0; i < W * H; i++) { const y = (2 * px[i * 4] + 7 * px[i * 4 + 1] + px[i * 4 + 2]) / 10; gray[i] = y; sum += y; }
        const mean = sum / (W * H); const min = Math.min(W, H);
        let dets = pico.run_cascade({ pixels: gray, nrows: H, ncols: W, ldim: W }, classify!, { shiftfactor: 0.1, scalefactor: 1.1, minsize: Math.round(min * 0.2), maxsize: Math.round(min * 1.0) });
        dets = pico.cluster_detections(memory!(dets), 0.2).filter((d: number[]) => d[3] > 50);
        const best = dets.sort((a: number[], b: number[]) => b[3] - a[3])[0];
        let good = false;
        if (mean < 55) { setTone('warn'); setMsg('It is too dark. Face the light'); }
        else if (mean > 220) { setTone('warn'); setMsg('Too much light behind you. Turn a little'); }
        else if (!best) { setTone('bad'); setMsg('Look at the camera, with your face inside the ring'); }
        else {
          const [r, c, s] = best; last.current = { cx: c, cy: r, s, w: W, h: H };
          const ratio = s / min; const dx = Math.abs(c - W / 2) / min; const dy = Math.abs(r - H / 2) / min;
          if (ratio < 0.34) { setTone('warn'); setMsg('Come a little closer'); }
          else if (ratio > 0.74) { setTone('warn'); setMsg('Move back a little'); }
          else if (dx > 0.14 || dy > 0.17) { setTone('warn'); setMsg('Move to the middle of the ring'); }
          else { good = true; setTone('ok'); setMsg('Perfect. Hold still'); }
        }
        streak = good ? streak + 1 : 0;
        if (streak >= need) { window.clearInterval(timer); void grab(); }
      }, 220);
    })();
    return () => { stop = true; window.clearInterval(timer); window.clearTimeout(lateTimer); stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  if (mode === 'fallback') {
    return (
      <div className="facecam">
        <p className="muted" role="status">{msg}</p>
        <label className="btn primary big" style={{ cursor: 'pointer' }}>
          <Icon name="camera" /> {busy ? 'Saving…' : 'Take photo'}
          <input type="file" accept="image/*" capture="user" hidden disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await onPhoto(await selfieFromFile(f)); } catch (er) { onError?.((er as Error).message); } }} />
        </label>
      </div>
    );
  }
  return (
    <div className="facecam">
      <div className={`facering ${done ? 'ok' : tone}${done ? ' done' : ''}`} aria-hidden>
        <video ref={vid} playsInline muted />
        {!done && tone !== 'ok' && <i className="scan" />}
        {done && <span className="checkpop">✓</span>}
      </div>
      <p className={`facehint ${tone}`} role="status" aria-live="polite">{done ? 'Got it' : msg}</p>
      {mode === 'cam' && !done && <button className="btn secondary" disabled={busy || (finder && !late && tone !== 'ok')} onClick={() => void grab()}>{late && tone !== 'ok' ? 'Take photo anyway' : 'Take photo'}</button>}
    </div>
  );
}

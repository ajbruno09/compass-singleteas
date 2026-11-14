import { supabase } from './supabase';

export interface BillLine { name: string; item_id: number | null; qty: number | null; unit: string | null; rate: number | null; amount: number | null }
export interface BillRead { bill_number: string | null; bill_date: string | null; vendor: string | null; total: number | null; unclear: string[]; lines?: BillLine[] }

// Shrinks a phone photo so it uploads fast and costs little to read.
async function shrink(file: File): Promise<{ b64: string; type: string }> {
  if (file.type === 'application/pdf') {
    const buf = new Uint8Array(await file.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), type: 'application/pdf' };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open the photo.')); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { b64: c.toDataURL('image/jpeg', 0.82).split(',')[1], type: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}

export async function readBill(files: File[], vendor = '', items: { id: number; name: string; unit: string }[] = []): Promise<BillRead> {
  const pages = await Promise.all(files.slice(0, 3).map(shrink));
  const { data: sess } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke('read-bill', { body: { pages, vendor, items }, headers: sess.session ? { Authorization: `Bearer ${sess.session.access_token}` } : undefined });
  if (error) {
    let msg = 'Could not read the bill.';
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data as BillRead;
}

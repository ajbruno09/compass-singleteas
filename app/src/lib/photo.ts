// Turns a phone photo into a small square face picture (about 20 to 40 KB) that is safe to store.
export async function selfieFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open the photo.')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const size = 320;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d'); if (!g) throw new Error('Could not process the photo.');
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    for (const q of [0.72, 0.6, 0.5]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 110000) return d; }
    throw new Error('The photo is too large. Try again.');
  } finally { URL.revokeObjectURL(url); }
}

// A small square picture (about 5 to 10 KB) for lists, made from a full size photo.
export async function thumbFromBlob(blob: Blob, size = 160): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open the photo.')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d'); if (!g) throw new Error('Could not process the photo.');
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo.'))), 'image/jpeg', 0.75));
  } finally { URL.revokeObjectURL(url); }
}
export const thumbPath = (p: string) => `t/${p.replace(/\.[^.]+$/, '')}.jpg`;

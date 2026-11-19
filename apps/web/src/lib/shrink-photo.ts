/** A phone photo made small enough to send or keep: longest side `max` px, JPEG. Falls back to the file as it is when the browser cannot draw it. */
export async function shrinkPhoto(file: File, max = 1600): Promise<string> {
  const asDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read')); r.readAsDataURL(b); });
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d');
    if (!g) throw new Error('canvas');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) throw new Error('blob');
    return await asDataUrl(blob);
  } catch {
    return asDataUrl(file);
  }
}

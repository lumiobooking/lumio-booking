/**
 * A 64-bit "difference hash" of a picture, computed in the browser.
 *
 * The server's wrong-salon check (api uploads/media-guard) compares it across
 * salons: the same photo uploaded to two shops matches even after it was
 * resized or re-encoded, which the exact SHA-256 of the bytes would miss.
 * Best effort — anything that cannot be decoded returns null and the upload
 * goes on with the exact-file check only.
 */

/** 9×8 grayscale → 64 bits: is each pixel brighter than the one to its right? */
export function dhashFromGray(gray: ArrayLike<number>): string | null {
  if (gray.length < 72) return null;
  let hex = '';
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) {
      const i = row * 9 + col;
      byte = (byte << 1) | (gray[i] > gray[i + 1] ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function grayOf(src: CanvasImageSource): number[] | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const g: number[] = [];
  for (let i = 0; i < d.length; i += 4) g.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  return g;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('decode'));
    img.src = url;
  });
}

/** From a data: URL or an object URL. */
export async function phashOfUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const g = grayOf(await loadImage(url));
    return g ? dhashFromGray(g) : null;
  } catch { return null; }
}

/** From a picked image file. */
export async function phashOfFile(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  const u = URL.createObjectURL(file);
  try { return await phashOfUrl(u); } finally { URL.revokeObjectURL(u); }
}

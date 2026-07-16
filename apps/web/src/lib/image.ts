// Client-side image shrinker. Everything a salon uploads — service photos, logos,
// staff avatars, tip QR images — runs through here so a heavy original never reaches
// the API or the database. The system stays light no matter what the user picks.

export interface CompressOpts {
  /** Longest edge in px (for square mode, the square's side). */
  maxSide?: number;
  /** Hard cap on the returned data-URL length (~1.37 × bytes). We keep shrinking
   *  until the output is under this. */
  maxChars?: number;
  /** Starting JPEG quality (ignored for PNG). */
  quality?: number;
  mime?: 'image/jpeg' | 'image/png';
  /** Center-crop to a square (avatars / QR). */
  square?: boolean;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode failed'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function render(img: HTMLImageElement, maxSide: number, quality: number, mime: string, square: boolean): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  if (square) {
    const size = Math.max(1, Math.min(maxSide, Math.max(img.width, img.height)));
    const side = Math.min(img.width, img.height);
    canvas.width = size; canvas.height = size;
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  } else {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    canvas.width = w; canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
  }
  return canvas.toDataURL(mime, quality);
}

/**
 * Resize + compress a picked image until it fits `maxChars`. Gives up quality first,
 * then pixels, with a hard floor so it always returns something even for extreme
 * inputs. Large uploads are silently made small — the user never has to think about it.
 */
export async function compressImageToFit(file: File, opts: CompressOpts = {}): Promise<string> {
  const mime = opts.mime ?? 'image/jpeg';
  const square = opts.square ?? false;
  const maxChars = opts.maxChars ?? 120_000;
  let side = opts.maxSide ?? 512;
  let quality = opts.quality ?? 0.82;
  const img = await loadImage(file);
  let out = render(img, side, quality, mime, square);
  let guard = 0;
  while (out.length > maxChars && guard < 14) {
    if (mime === 'image/jpeg' && quality > 0.5) quality -= 0.1;
    else side = Math.max(48, Math.round(side * 0.82));
    out = render(img, side, quality, mime, square);
    guard++;
  }
  return out;
}

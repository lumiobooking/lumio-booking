/**
 * A wallet's own QR picture (a screenshot from MoMo / ZaloPay), shrunk in the
 * browser to a small PNG data URL so it can be kept with the settings — no
 * image host, no link to paste. Browser only.
 */
export const QR_IMAGE_MAX_PX = 360;
export const QR_IMAGE_MAX_CHARS = 240_000;

export function shrinkQrImage(file: File, max = QR_IMAGE_MAX_PX): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) { reject(new Error('NOT_IMAGE')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('READ_FAILED'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k));
        const h = Math.max(1, Math.round(img.height * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        if (!g) { reject(new Error('NO_CANVAS')); return; }
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.imageSmoothingEnabled = false;
        g.drawImage(img, 0, 0, w, h);
        let out = c.toDataURL('image/png');
        if (out.length > QR_IMAGE_MAX_CHARS) out = c.toDataURL('image/jpeg', 0.9);
        if (out.length > QR_IMAGE_MAX_CHARS) { reject(new Error('TOO_BIG')); return; }
        resolve(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

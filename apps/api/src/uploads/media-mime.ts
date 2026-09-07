/**
 * What a media file IS, decided once, the same way everywhere.
 *
 * Three places used to guess on their own and two of them guessed wrong:
 * a phone that hands over a clip with an empty `File.type`, and a hosting
 * that serves an .mp4 as `text/plain`, both ended up as a "document" in
 * Drive — a file the folder shows with a blue page icon and cannot play.
 * The rule here: believe a declared type only when it is an image or a
 * video; otherwise read the extension; otherwise fall back to what the
 * caller knows the file to be.
 */

export const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/x-m4v': 'm4v', 'video/3gpp': '3gp',
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heic',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', qt: 'video/quicktime',
  webm: 'video/webm', '3gp': 'video/3gpp',
};

/** `image/jpeg; charset=binary` → `image/jpeg`; anything else lowercased and trimmed. */
export function cleanMime(raw: unknown): string {
  return String(raw ?? '').split(';')[0].trim().toLowerCase();
}

export function isMediaMime(mime: string): boolean {
  return /^(image|video)\/[a-z0-9.+-]+$/.test(mime);
}

/** The extension of a filename or URL, without the dot; null when there is none. */
export function extOf(nameOrUrl: unknown): string | null {
  const s = String(nameOrUrl ?? '').split(/[?#]/)[0];
  const m = /\.([a-z0-9]{2,5})$/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The type to store a file under.
 *
 *   declared — what the sender said (`File.type`, a Content-Type header)
 *   name     — the filename or URL it came with
 *   kind     — what the caller already knows it to be
 *
 * Returns '' when nothing says image or video, so a caller can refuse.
 */
export function resolveMime(opts: { declared?: unknown; name?: unknown; kind?: 'image' | 'video' | null }): string {
  const declared = cleanMime(opts.declared);
  if (isMediaMime(declared)) return declared;
  const ext = extOf(opts.name);
  if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (opts.kind === 'video') return 'video/mp4';
  if (opts.kind === 'image') return 'image/jpeg';
  return '';
}

export function kindOfMime(mime: string): 'image' | 'video' | null {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return null;
}

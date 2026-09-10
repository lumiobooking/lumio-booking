/**
 * A Google Drive link, turned into a file the platforms can fetch.
 *
 * A share link is a web page. Meta and TikTok fetch it and get Google's
 * viewer, not the clip — so the planner refuses Drive links on a post. But
 * a 400 MB clip does not go through the browser upload either. The way
 * through is for the SERVER to pull the file out of Drive and put it on the
 * public host, streaming, so a phone never holds the bytes and the API
 * never holds them all at once.
 *
 * Two doors into Drive, tried in order: the agency's own Drive account
 * (works for anything shared with it, and for the agency's own folders),
 * then the public "anyone with the link" download. A file behind neither
 * is a file the person has to share first, and the error says so.
 */

/** The file id inside any of the share-link shapes Drive hands out. */
export function driveFileIdFrom(url: string): string | null {
  const u = String(url ?? '').trim();
  if (!/drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com/i.test(u)) return null;
  const m = u.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || u.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || u.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/** True for a link this importer can try — not every Drive page is a file. */
export function isDriveLink(url: string): boolean {
  return driveFileIdFrom(url) !== null;
}

/** The public download address for a file shared "anyone with the link". */
export function drivePublicDownloadUrl(id: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

export const IMPORT_VIDEO_MAX = 1024 * 1024 * 1024; // 1 GB — Instagram Reels' ceiling; TikTok takes more but nobody needs it
export const IMPORT_IMAGE_MAX = 12 * 1024 * 1024;

/** What the file turned out to be, and whether the import may go ahead. */
export function importCheck(meta: { mime: string | null; size: number | null; name: string | null }): { kind: 'image' | 'video'; problem: string | null } {
  const mime = (meta.mime ?? '').toLowerCase().split(';')[0].trim();
  const name = meta.name ?? '';
  const byExt = /\.(mp4|mov|m4v|webm)$/i.test(name) ? 'video' : /\.(jpe?g|png|gif|webp)$/i.test(name) ? 'image' : null;
  const kind: 'image' | 'video' | null = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : byExt;
  if (!kind) {
    return {
      kind: 'video',
      problem: /text\/html/.test(mime)
        ? 'Link Google Drive này chưa mở công khai. Trong Drive: Chia sẻ → "Bất kỳ ai có đường liên kết" (Người xem), hoặc chia sẻ cho tài khoản Drive của Lumio, rồi dán lại.'
        : `File trên Drive không phải ảnh/video (${mime || name || 'không rõ loại'}).`,
    };
  }
  const cap = kind === 'video' ? IMPORT_VIDEO_MAX : IMPORT_IMAGE_MAX;
  if (meta.size !== null && meta.size > cap) {
    return { kind, problem: kind === 'video'
      ? `Video nặng ${(meta.size / 1048576).toFixed(0)} MB — tối đa 1 GB (giới hạn Instagram Reels). Xuất lại 1080p H.264.`
      : `Ảnh nặng ${(meta.size / 1048576).toFixed(1)} MB — tối đa 12 MB.` };
  }
  return { kind, problem: null };
}

export interface ImportJob {
  id: string;
  tenantId: string;
  state: 'running' | 'done' | 'error';
  /** Bytes moved so far, and the total when Drive said it. */
  loaded: number;
  size: number | null;
  url: string | null;
  kind: 'image' | 'video' | null;
  error: string | null;
  startedAt: number;
}

/** What the screen polls. Percent is null until the size is known. */
export function jobView(j: ImportJob) {
  return {
    id: j.id,
    state: j.state,
    pct: j.size ? Math.min(99, Math.round((j.loaded / j.size) * 100)) : null,
    loadedMb: Math.round(j.loaded / 1048576),
    sizeMb: j.size ? Math.round(j.size / 1048576) : null,
    url: j.url,
    kind: j.kind,
    error: j.error,
  };
}

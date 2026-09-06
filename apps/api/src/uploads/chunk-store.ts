import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Where an upload waits while it arrives in pieces.
 *
 * WHY PIECES
 *
 * A shop sends a thirty-second clip from a phone on a car-park connection. As
 * one request, a drop at 90% is a restart from zero, and the person has to sit
 * there holding the phone to find out. In 4MB pieces the same drop costs one
 * piece, and the phone can put the rest through later — after the screen
 * locked, after the app was closed, after the night — without asking anyone
 * to pick the files again. The client keeps its own list of what went; this
 * side answers "which pieces do you already have" so the two can agree.
 *
 * Pieces live in the process's temp directory, under the tenant, under an id
 * the client made up. The disk is not durable across a redeploy and does not
 * have to be: a lost piece is re-sent, and anything older than a day is
 * swept. Nothing here is the file of record — that is storage, written by
 * `finish` once every piece is in.
 */
export const CHUNK_MAX = 8 * 1024 * 1024;       // no single piece bigger than this
export const PIECES_MAX = 64;                    // 64 × 4MB = 256MB, well past the clip cap
const TTL_MS = 24 * 60 * 60 * 1000;

const ROOT = path.join(os.tmpdir(), 'lumio-uploads');
const safe = (s: string) => String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

function dirOf(tenantId: string, uploadId: string): string | null {
  const t = safe(tenantId); const u = safe(uploadId);
  if (!t || !u || u.length < 8) return null;
  return path.join(ROOT, t, u);
}

export async function putChunk(tenantId: string, uploadId: string, index: number, buf: Buffer): Promise<void> {
  const dir = dirOf(tenantId, uploadId);
  if (!dir) throw new Error('bad id');
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${index}.part`);
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, path.join(dir, String(index))); // a half-written piece is never "present"
}

/** Indexes already on disk, so the client can skip them. */
export async function haveChunks(tenantId: string, uploadId: string): Promise<number[]> {
  const dir = dirOf(tenantId, uploadId);
  if (!dir) return [];
  try {
    const names = await fs.readdir(dir);
    return names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
  } catch { return []; }
}

/** All pieces in order, as one buffer, or null if any is missing. */
export async function assemble(tenantId: string, uploadId: string, total: number): Promise<Buffer | null> {
  const dir = dirOf(tenantId, uploadId);
  if (!dir) return null;
  const have = new Set(await haveChunks(tenantId, uploadId));
  for (let i = 0; i < total; i += 1) if (!have.has(i)) return null;
  const parts: Buffer[] = [];
  for (let i = 0; i < total; i += 1) parts.push(await fs.readFile(path.join(dir, String(i))));
  return Buffer.concat(parts);
}

export async function dropChunks(tenantId: string, uploadId: string): Promise<void> {
  const dir = dirOf(tenantId, uploadId);
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Remove abandoned uploads. Called from the scheduler; cheap when there is nothing. */
export async function sweepChunks(now = Date.now()): Promise<number> {
  let removed = 0;
  let tenants: string[] = [];
  try { tenants = await fs.readdir(ROOT); } catch { return 0; }
  for (const t of tenants) {
    const tdir = path.join(ROOT, t);
    let ups: string[] = [];
    try { ups = await fs.readdir(tdir); } catch { continue; }
    for (const u of ups) {
      const dir = path.join(tdir, u);
      try {
        const st = await fs.stat(dir);
        if (now - st.mtimeMs > TTL_MS) { await fs.rm(dir, { recursive: true, force: true }); removed += 1; }
      } catch { /* gone already */ }
    }
  }
  return removed;
}

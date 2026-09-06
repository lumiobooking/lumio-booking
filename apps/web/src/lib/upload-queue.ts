'use client';

import { useEffect, useState } from 'react';
import { apiFetch, apiUploadForm, ApiError } from './api';

/**
 * The shop's outbox.
 *
 * WHAT THIS IS FOR
 *
 * A shop picks four clips at ten at night and should be able to put the phone
 * down. The old send was one request per file, alive only while the page was
 * open and the screen was on: lock the phone at 80% and the whole file went
 * again, and nobody knew until morning.
 *
 * So the files go into a queue first — in the browser's own database, as the
 * File objects themselves — and a runner works through it: each file in 4MB
 * pieces, each piece a request of its own, each piece ticked off as it lands.
 * Whatever interrupts it (screen off, app closed, a tunnel) costs at most one
 * piece; the next time the page is open the runner asks the server which
 * pieces it has and carries on from there. The person never picks the files
 * twice and never sits watching a bar.
 *
 * WHAT IT CANNOT DO, HONESTLY
 *
 * A web page cannot upload while it is closed. On a phone, the runner keeps
 * going as long as the app is open in front — and it holds a screen wake-lock
 * so the phone does not lock itself and stop it. Close the app, and the
 * remaining pieces wait for the next open. Where the browser offers Background
 * Fetch (Chrome on Android) the pieces are handed to the browser and continue
 * with the app closed; iPhones do not have that, and no web app can pretend
 * otherwise.
 *
 * WHAT IT REPORTS
 *
 * One number for the whole outbox — bytes landed over bytes queued — so the
 * bar never jumps backwards when a second batch is added, plus per-batch
 * state for the card that started it.
 */

export type Target = { suggestionId: string } | { shop: true; note: string };

export interface QueuedFile {
  id: string;
  batchId: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  /** Number of 4MB pieces. */
  total: number;
  /** Pieces the server has confirmed. */
  sent: number[];
  status: 'queued' | 'uploading' | 'done' | 'failed';
  url?: string;
  kind?: 'image' | 'video';
  error?: string;
  createdAt: number;
}

export interface Batch {
  id: string;
  target: Target;
  fileIds: string[];
  status: 'pending' | 'done' | 'failed';
  error?: string;
  createdAt: number;
  doneAt?: number;
}

export interface BatchView extends Batch {
  files: QueuedFile[];
  /** 0-100 over the batch's bytes. */
  pct: number;
  bytesSent: number;
  bytesTotal: number;
}

export interface QueueSnapshot {
  running: boolean;
  online: boolean;
  batches: BatchView[];
  pending: BatchView[];
  pct: number;
  bytesSent: number;
  bytesTotal: number;
  /** A batch finished since the last time the snapshot was read. */
  lastDone: Batch | null;
}

export const CHUNK = 4 * 1024 * 1024;
const DB = 'lumio-outbox';
const MAX_RETRY = 6;

// ---- storage ----------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const files = db.createObjectStore('files', { keyPath: 'id' });
      files.createIndex('batchId', 'batchId');
      db.createObjectStore('batches', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: 'files' | 'batches', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => { db.close(); resolve((r as IDBRequest<T> | undefined)?.result as T); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

const allFiles = () => tx<QueuedFile[]>('files', 'readonly', (s) => s.getAll()).catch(() => [] as QueuedFile[]);
const allBatches = () => tx<Batch[]>('batches', 'readonly', (s) => s.getAll()).catch(() => [] as Batch[]);
const putFile = (f: QueuedFile) => tx<IDBValidKey>('files', 'readwrite', (s) => s.put(f));
const putBatch = (b: Batch) => tx<IDBValidKey>('batches', 'readwrite', (s) => s.put(b));
const delFile = (id: string) => tx<undefined>('files', 'readwrite', (s) => s.delete(id));
const delBatch = (id: string) => tx<undefined>('batches', 'readwrite', (s) => s.delete(id));

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

// ---- the queue ----------------------------------------------------------------------

let listeners: ((s: QueueSnapshot) => void)[] = [];
let running = false;
let wanted = false;          // a run was asked for while one was going
let tokenGetter: (() => string | null) | null = null;
let lastDone: Batch | null = null;
let cache: { files: QueuedFile[]; batches: Batch[] } = { files: [], batches: [] };
let liveBytes: Record<string, number> = {}; // bytes of the piece in flight, per file
let wakeLock: { release: () => Promise<void> } | null = null;

function view(files: QueuedFile[], batches: Batch[]): QueueSnapshot {
  const byBatch = new Map<string, QueuedFile[]>();
  for (const f of files) byBatch.set(f.batchId, [...(byBatch.get(f.batchId) ?? []), f]);
  const sentBytes = (f: QueuedFile) => (f.status === 'done' ? f.size : Math.min(f.size, f.sent.length * CHUNK + (liveBytes[f.id] ?? 0)));
  const views: BatchView[] = batches
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((b) => {
      const fs = byBatch.get(b.id) ?? [];
      const bytesTotal = fs.reduce((n, f) => n + f.size, 0) || 1;
      const bytesSent = fs.reduce((n, f) => n + sentBytes(f), 0);
      return { ...b, files: fs, bytesTotal, bytesSent, pct: Math.min(100, Math.round((bytesSent / bytesTotal) * 100)) };
    });
  const pending = views.filter((b) => b.status === 'pending');
  const bytesTotal = pending.reduce((n, b) => n + b.bytesTotal, 0);
  const bytesSent = pending.reduce((n, b) => n + b.bytesSent, 0);
  return {
    running, online: typeof navigator === 'undefined' ? true : navigator.onLine,
    batches: views, pending, bytesTotal, bytesSent,
    pct: bytesTotal ? Math.min(100, Math.round((bytesSent / bytesTotal) * 100)) : 0,
    lastDone,
  };
}

async function refresh(): Promise<QueueSnapshot> {
  const [files, batches] = await Promise.all([allFiles(), allBatches()]);
  cache = { files, batches };
  const s = view(files, batches);
  for (const l of listeners) l(s);
  return s;
}

function emit() {
  const s = view(cache.files, cache.batches);
  for (const l of listeners) l(s);
}

/** Put files in the outbox. Returns at once; the runner does the rest. */
export async function enqueue(files: File[], target: Target): Promise<Batch> {
  const batch: Batch = { id: uid(), target, fileIds: [], status: 'pending', createdAt: Date.now() };
  for (const f of files) {
    const q: QueuedFile = {
      id: uid(), batchId: batch.id, name: f.name, type: f.type || 'application/octet-stream', size: f.size, blob: f,
      total: Math.max(1, Math.ceil(f.size / CHUNK)), sent: [], status: 'queued', createdAt: Date.now(),
    };
    await putFile(q);
    batch.fileIds.push(q.id);
  }
  await putBatch(batch);
  await refresh();
  void runQueue();
  return batch;
}

/** Forget a batch that failed for good (or was sent by other means). */
export async function discardBatch(batchId: string): Promise<void> {
  const files = await allFiles();
  for (const f of files) if (f.batchId === batchId) await delFile(f.id);
  await delBatch(batchId);
  await refresh();
}

/** Try the failed ones again — the person pressed the button, or the network came back. */
export async function retryFailed(): Promise<void> {
  const [files, batches] = await Promise.all([allFiles(), allBatches()]);
  for (const f of files) if (f.status === 'failed') await putFile({ ...f, status: 'queued', error: undefined });
  for (const b of batches) if (b.status === 'failed') await putBatch({ ...b, status: 'pending', error: undefined });
  await refresh();
  void runQueue();
}

// ---- the runner -----------------------------------------------------------------------

async function holdScreen() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (wl && !wakeLock) wakeLock = await wl.request('screen');
  } catch { /* not allowed, not supported — the upload still runs while the screen is on */ }
}
async function releaseScreen() {
  try { await wakeLock?.release(); } catch { /* already released */ }
  wakeLock = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One file, piece by piece, resuming from whatever the server already has. */
async function uploadFile(f: QueuedFile, token: string, askServer = true): Promise<QueuedFile> {
  let file: QueuedFile = { ...f, status: 'uploading' };
  await putFile(file);
  // Ask what already landed: a previous run may have got further than we wrote
  // down. Not after a MISSING_CHUNKS retry — the server's own list is fresher
  // than anything a cached GET could say.
  if (askServer) {
    try {
      const st = await apiFetch<{ have: number[]; result: { url?: string; kind?: 'image' | 'video'; error?: string } | null }>(`/uploads/media/chunk/${encodeURIComponent(file.id)}?t=${Date.now()}`, { token });
      // Already made on a previous run whose answer never reached us.
      if (st.result?.url && st.result.kind) {
        file = { ...file, status: 'done', url: st.result.url, kind: st.result.kind };
        await putFile(file);
        return file;
      }
      file = { ...file, sent: Array.from(new Set([...file.sent, ...(st.have ?? [])])).sort((a, b) => a - b) };
    } catch { /* fine — we send what we think is missing and the server tells us */ }
  }

  let failures = 0;
  for (let i = 0; i < file.total; i += 1) {
    if (file.sent.includes(i)) continue;
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ApiError('offline', 0, null);
    const part = file.blob.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK));
    const form = new FormData();
    form.append('uploadId', file.id);
    form.append('index', String(i));
    form.append('chunk', part, `${i}.part`);
    try {
      const r = await apiUploadForm<{ have: number[] }>('/uploads/media/chunk', form, token, (loaded) => { liveBytes[file.id] = loaded; emit(); });
      liveBytes[file.id] = 0;
      file = { ...file, sent: Array.from(new Set([...file.sent, i, ...(r.have ?? [])])).sort((a, b) => a - b) };
      await putFile(file);
      cache.files = cache.files.map((x) => (x.id === file.id ? file : x));
      emit();
      failures = 0;
    } catch (e) {
      liveBytes[file.id] = 0;
      failures += 1;
      const status = e instanceof ApiError ? e.status : 0;
      // A 4xx is our mistake and will not fix itself; a 0/5xx is the road.
      if ((status >= 400 && status < 500) || failures > MAX_RETRY) throw e;
      await sleep(Math.min(30_000, 1000 * 2 ** failures));
      i -= 1; // same piece again
    }
  }
  // Every piece is in: ask for the file to be made. A photo comes back made;
  // a clip comes back "pending" while the server pushes it to storage, and we
  // ask every few seconds until the answer is written. Nothing here waits on
  // one long request — that is the wait the proxy used to cut.
  try {
    type Fin = { pending?: true; url?: string; kind?: 'image' | 'video'; error?: string };
    let r = await apiFetch<Fin>('/uploads/media/finish', {
      method: 'POST', token, body: { uploadId: file.id, total: file.total, mime: file.type, name: file.name },
    });
    for (let waited = 0; r.pending && waited < 10 * 60_000; waited += 4000) {
      await sleep(4000);
      const st = await apiFetch<{ have: number[]; result: Fin | null }>(`/uploads/media/chunk/${encodeURIComponent(file.id)}?t=${Date.now()}`, { token });
      if (st.result) r = st.result;
    }
    if (r.pending) throw new ApiError('Máy chủ chưa xử lý xong, thử lại sau', 0, null);
    if (r.error || !r.url || !r.kind) throw new ApiError(r.error || 'Không tải lên được', 400, r);
    file = { ...file, status: 'done', url: r.url, kind: r.kind };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const m = /MISSING_CHUNKS:([\d,]*)/.exec(msg);
    if (m) {
      // The server lost pieces (a redeploy). Trust its list and go again.
      file = { ...file, sent: m[1] ? m[1].split(',').filter(Boolean).map(Number) : [], status: 'queued' };
      await putFile(file);
      if (!askServer) throw e; // twice in a row: something else is wrong, stop looping
      return uploadFile(file, token, false);
    }
    throw e;
  }
  await putFile(file);
  return file;
}

/** Deliver a finished batch to what it was for. */
async function deliver(b: Batch, files: QueuedFile[], token: string): Promise<void> {
  const media = b.fileIds
    .map((id) => files.find((f) => f.id === id))
    .filter((f): f is QueuedFile => Boolean(f?.url && f.kind))
    .map((f) => ({ url: f.url!, kind: f.kind! }));
  if ('suggestionId' in b.target) {
    await apiFetch(`/content/suggestions/${encodeURIComponent(b.target.suggestionId)}/done`, { method: 'POST', token, body: { media } });
  } else {
    await apiFetch('/content/suggestions/shop-send', { method: 'POST', token, body: { note: b.target.note, media } });
  }
}

/**
 * Work through the outbox. Safe to call any time from anywhere; a second call
 * during a run just asks for another pass afterwards.
 */
export async function runQueue(): Promise<void> {
  if (running) { wanted = true; return; }
  const token = tokenGetter?.() ?? null;
  if (!token) return;
  running = true;
  emit();
  try {
    await holdScreen();
    let pass = 0;
    do {
      wanted = false;
      pass += 1;
      const s = await refresh();
      for (const b of s.pending) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        const files = b.files;
        let ok = true;
        for (const f of files) {
          if (f.status === 'done') continue;
          if (f.status === 'failed') { ok = false; continue; }
          try {
            const done = await uploadFile(f, token);
            cache.files = cache.files.map((x) => (x.id === done.id ? done : x));
          } catch (e) {
            ok = false;
            const failed: QueuedFile = { ...f, status: 'failed', error: e instanceof Error ? e.message : 'failed' };
            await putFile(failed);
            cache.files = cache.files.map((x) => (x.id === failed.id ? failed : x));
            emit();
            if (typeof navigator !== 'undefined' && !navigator.onLine) break;
          }
        }
        if (!ok) continue;
        try {
          await deliver(b, await allFiles(), token);
          const done: Batch = { ...b, status: 'done', doneAt: Date.now() };
          await putBatch(done);
          // Bytes are no longer needed; the record stays a while so the card can say "sent".
          for (const id of b.fileIds) await delFile(id);
          lastDone = done;
          await refresh();
        } catch (e) {
          await putBatch({ ...b, status: 'failed', error: e instanceof Error ? e.message : 'failed' });
          await refresh();
        }
      }
      // Done batches older than a day: gone.
      for (const b of (await allBatches())) if (b.status === 'done' && Date.now() - (b.doneAt ?? 0) > 86_400_000) await delBatch(b.id);
    } while (wanted && pass < 5);
  } finally {
    running = false;
    await releaseScreen();
    await refresh();
  }
}

/**
 * Wire the runner to the page: run on load, when the tab comes back, when the
 * network comes back, and re-take the wake-lock after the screen was off.
 * Idempotent; every page that can start an upload calls it.
 */
let installed = false;
export function installOutbox(getToken: () => string | null): void {
  tokenGetter = getToken;
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const kick = () => { void runQueue(); };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (running) void holdScreen(); kick(); }
  });
  kick();
}

/** Live view of the outbox, for the bar and the cards. */
export function useOutbox(): QueueSnapshot {
  const [snap, setSnap] = useState<QueueSnapshot>(() => view(cache.files, cache.batches));
  useEffect(() => {
    listeners.push(setSnap);
    void refresh();
    return () => { listeners = listeners.filter((l) => l !== setSnap); };
  }, []);
  return snap;
}

/** Take the "just finished" note, once. */
export function takeLastDone(): Batch | null {
  const b = lastDone; lastDone = null; return b;
}

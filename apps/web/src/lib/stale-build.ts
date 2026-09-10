/**
 * A tab that outlived a deploy.
 *
 * Next names every chunk by its content hash. A deploy replaces them all,
 * and a tab opened BEFORE it still holds the old runtime — the moment it
 * navigates to a page whose chunk it has not loaded yet, it asks the server
 * for a file that no longer exists and throws "Loading chunk 3185 failed".
 * Nothing is broken; the page is simply older than the site. "Try again"
 * (React's reset) cannot fix it — the old runtime asks for the old file
 * again — and every salon that had Lumio open during a deploy saw this.
 *
 * The fix is a full reload, once. Once, guarded by sessionStorage, so a
 * chunk that is truly missing does not become a reload loop.
 */

const KEY = 'lumio_stale_reload';

export function isStaleBuild(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ''} ${e?.message ?? ''}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(text);
}

/** Reload once for a stale build. Returns true when a reload was started. */
export function reloadOnceForStaleBuild(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(window.sessionStorage.getItem(KEY) || 0);
    // A second stale error within a minute of the last reload is not staleness.
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage blocked: still reload, just without the guard */ }
  window.location.reload();
  return true;
}

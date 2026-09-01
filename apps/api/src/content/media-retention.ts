/**
 * Deleting uploaded media once it has done its job.
 *
 * THE FACT THIS RESTS ON
 *
 * Facebook and Instagram FETCH the file at publish time and keep their own copy.
 * Once a post is live, the URL Lumio served it from can disappear and the post
 * is unaffected. So Lumio does not need to store a salon's pictures for ever —
 * only from the moment they are uploaded until the moment the post goes out.
 *
 * Without this, storage grows for ever and in one direction: a hundred salons
 * posting thirty times a month is roughly one and a half gigabytes a month,
 * arriving every month, never leaving. With it, the store holds only what is
 * still waiting to publish plus a safety margin, and stops growing.
 *
 * WHAT IT WILL NOT TOUCH, AND WHY EACH RULE IS HERE
 *
 * 1. Anything not published yet. A salon planning a month ahead uploads on the
 *    1st for a post on the 30th; deleting on a schedule measured from UPLOAD
 *    would erase the picture before it was ever used. Retention is measured
 *    from the moment the post published, never from when the file arrived.
 *
 * 2. Anything that is not ours. A salon linking to their own website gets that
 *    link left alone — we did not put the file there and it is not ours to
 *    remove. Only URLs under our own public base are candidates.
 *
 * 3. A file another post still needs. The same picture can be used twice. If
 *    any post that is not yet safely past retention still points at it, it
 *    stays. Cheaper to keep one file than to break one post.
 */

export interface RetentionPost {
  id: string;
  status: string;
  postedAt: Date | null;
  mediaPurgedAt: Date | null;
  mediaUrls: string[];
}

export interface PurgePlan {
  /** Files safe to delete from storage. */
  urls: string[];
  /** Posts to mark as purged, so the screen shows a placeholder not a broken image. */
  postIds: string[];
}

/**
 * How long a published post's pictures stay.
 *
 * Long enough that the month's calendar and Instagram grid still render their
 * own thumbnails while anybody is likely to look at them, and short enough that
 * the store does not grow without limit. The platforms themselves stopped
 * needing the file the instant they fetched it.
 */
export const DEFAULT_RETENTION_DAYS = 30;

/** Is this file one WE put in storage? A salon's own link is not ours to delete. */
export function isOurs(url: string, publicBase: string | null | undefined): boolean {
  const base = (publicBase ?? '').replace(/\/+$/, '');
  if (!base) return false;
  return (url ?? '').trim().startsWith(`${base}/`);
}

export function planPurge(
  posts: RetentionPost[],
  publicBase: string | null | undefined,
  now: Date,
  retentionDays = DEFAULT_RETENTION_DAYS,
): PurgePlan {
  if (!publicBase) return { urls: [], postIds: [] };
  const cutoff = now.getTime() - retentionDays * 86_400_000;

  const expired = (posts ?? []).filter((p) =>
    p.status === 'posted'
    && !p.mediaPurgedAt
    && p.postedAt !== null
    && p.postedAt.getTime() <= cutoff);
  if (!expired.length) return { urls: [], postIds: [] };

  // Every URL still spoken for by a post that is NOT past retention — anything
  // unpublished, anything published recently, anything in any other state.
  const stillNeeded = new Set<string>();
  const expiredIds = new Set(expired.map((p) => p.id));
  for (const p of posts ?? []) {
    if (expiredIds.has(p.id)) continue;
    for (const u of p.mediaUrls ?? []) stillNeeded.add(u);
  }

  const urls = new Set<string>();
  for (const p of expired) {
    for (const u of p.mediaUrls ?? []) {
      if (!isOurs(u, publicBase)) continue;
      if (stillNeeded.has(u)) continue;
      urls.add(u);
    }
  }

  return {
    urls: [...urls],
    // Every expired post is marked, including one whose media was all external
    // or already shared: the mark means "this row has been through retention",
    // and leaving it unmarked would make the sweep reconsider it for ever.
    postIds: expired.map((p) => p.id),
  };
}

/**
 * The storage path inside our own bucket, from a public URL.
 *
 * Returns null for anything that is not ours — an FTP delete built from an
 * arbitrary URL is a way to delete somebody else's file, so the check is here
 * rather than at the call site where it can be forgotten.
 */
export function storagePathOf(url: string, publicBase: string | null | undefined): string | null {
  if (!isOurs(url, publicBase)) return null;
  const base = (publicBase ?? '').replace(/\/+$/, '');
  const rel = url.trim().slice(base.length + 1);
  // No traversal, no absolute paths, no query strings — the uploader writes
  // "<tenant>/<uuid>.<ext>" and nothing else should ever be accepted here.
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5}$/.test(rel)) return null;
  return rel;
}

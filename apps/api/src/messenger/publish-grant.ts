/**
 * What Facebook did with the PUBLISHING permissions the last time a Page was
 * connected — and therefore whether reconnecting can help.
 *
 * WHY ONE WARNING WAS THREE DIFFERENT PROBLEMS
 *
 * "This connection cannot publish — reconnect and tick every box" was shown for
 * every token that lacked pages_manage_posts. But a token lacks it for three
 * reasons that need three different fixes, and only one of them is a reconnect:
 *
 *   declined   — the person unticked it in the dialog. Reconnect and tick. ✓
 *   not-asked  — we put it in the dialog and Facebook did not show it. That is
 *                the Meta app: the permission has no Advanced Access, and the
 *                person connecting has no role on the app, so Meta drops the box
 *                silently. Reconnecting a hundred times changes nothing. ✗
 *   not-requested — the dialog never contained it (FB_SCOPE_PUBLISH=0). Also
 *                not the salon's problem. ✗
 *
 * Telling somebody to reconnect a Page when reconnecting cannot work is how a
 * fix message stops being believed — and then the day it IS the fix, nobody
 * tries it. So the outcome is recorded at connect time, from /me/permissions on
 * the user token, and the queue screen names the actual cause.
 */

export type ScopeState = 'granted' | 'declined' | 'not-asked' | 'not-requested';

export interface PublishGrant {
  at: string;
  /** Per publishing scope: what the last connect did with it. */
  scopes: Record<string, ScopeState>;
}

export interface PermissionRow { permission: string; status: string }

/**
 * Classify each publishing scope from the /me/permissions answer.
 *
 * A scope missing from the list was never put in front of the person — either
 * because we did not request it (`requested` false) or because Meta removed it
 * from the dialog. Those two look identical to the person and are told apart
 * here only because we know what we asked for.
 */
export function publishGrantFrom(
  perms: PermissionRow[] | null | undefined,
  requested: { fb: boolean; ig: boolean },
  at: string = new Date().toISOString(),
): PublishGrant {
  const rows = new Map((perms ?? []).map((p) => [String(p.permission), String(p.status)]));
  const state = (scope: string, asked: boolean): ScopeState => {
    if (!asked) return 'not-requested';
    const s = rows.get(scope);
    if (s === 'granted') return 'granted';
    if (s === 'declined') return 'declined';
    return 'not-asked';
  };
  return {
    at,
    scopes: {
      pages_manage_posts: state('pages_manage_posts', requested.fb),
      instagram_content_publish: state('instagram_content_publish', requested.ig),
    },
  };
}

export type GapCause = 'declined' | 'not-offered' | 'not-requested' | 'stale' | 'unknown';

/**
 * Why the stored token lacks these scopes, and whether a reconnect can fix it.
 *
 * `missing` is what the Page token does not carry (from debug_token, the
 * authority on what the token can DO). `grant` is what the last connect
 * recorded (the authority on what Facebook OFFERED). The two together answer
 * the only question the person has: is this mine to fix?
 */
export function explainPublishGap(
  missing: string[],
  grant: PublishGrant | null | undefined,
): { cause: GapCause; reconnectHelps: boolean } {
  if (!missing.length) return { cause: 'unknown', reconnectHelps: false };
  if (!grant) return { cause: 'unknown', reconnectHelps: true };
  const states = missing.map((m) => grant.scopes[m] ?? 'not-asked');
  // The worst news wins: one scope Meta will not offer is enough to make a
  // reconnect pointless, whatever happened to the others.
  if (states.includes('not-requested')) return { cause: 'not-requested', reconnectHelps: false };
  if (states.includes('not-asked')) return { cause: 'not-offered', reconnectHelps: false };
  if (states.includes('declined')) return { cause: 'declined', reconnectHelps: true };
  // Facebook says granted, the token says no: the token on file predates the
  // grant (a page picked from the stash, a heal that did not reach this row).
  return { cause: 'stale', reconnectHelps: true };
}

/**
 * ONE TAB, ONE SALON.
 *
 * A Lumio Support employee sets up several salons at once, each in its own
 * tab. The salon session used to live in localStorage — which every tab of
 * the site shares — so entering salon B in one tab silently turned every
 * other tab into salon B the next time it loaded a page. And pages load all
 * the time: every "Connect Google / Facebook / TikTok / Gmail" round trip
 * comes back through a fresh page. The employee, looking at a tab opened for
 * salon A, connected A's Facebook page, scheduled A's posts and set A's mail
 * into whichever salon had been entered last. Posts and mails crossed salons.
 *
 * A salon session now lives in sessionStorage: per tab, kept across OAuth
 * redirects within that tab, gone when the tab closes. The employee's own
 * agency login stays in localStorage, untouched, so leaving a salon needs no
 * re-login and a new tab always starts at the agency list — never inside a
 * salon it was not opened for.
 */
export const SUPPORT_SESSION_KEY = 'lumio_support_session';
export const AUTH_KEY = 'lumio_auth';
/** Where the old code parked the agency login while a salon session held localStorage. */
const LEGACY_HOME_KEY = 'lumio_agency_home';

export interface StoredSession { accessToken: string; user: { supportSession?: boolean; tenantId?: string | null; [k: string]: unknown } }

const parse = (raw: string | null): StoredSession | null => {
  if (!raw) return null;
  try { const v = JSON.parse(raw) as StoredSession; return v && typeof v.accessToken === 'string' && v.user ? v : null; } catch { return null; }
};

/**
 * The session this tab should run as: its own salon session first, else the
 * login shared by every tab. A salon session left in localStorage by the old
 * code is moved out of the shared slot on first sight, and the agency login
 * it had parked is put back — so one update cannot leave a browser stuck
 * inside a salon.
 */
export function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const own = parse(window.sessionStorage.getItem(SUPPORT_SESSION_KEY));
    if (own) return own;
  } catch { /* storage blocked: fall through */ }
  try {
    const shared = parse(window.localStorage.getItem(AUTH_KEY));
    if (shared?.user?.supportSession) {
      // Legacy: a salon session in the shared slot. Keep it for THIS tab only.
      try { window.sessionStorage.setItem(SUPPORT_SESSION_KEY, JSON.stringify(shared)); } catch { /* ignore */ }
      const home = window.localStorage.getItem(LEGACY_HOME_KEY);
      if (home) window.localStorage.setItem(AUTH_KEY, home); else window.localStorage.removeItem(AUTH_KEY);
      window.localStorage.removeItem(LEGACY_HOME_KEY);
      return shared;
    }
    return shared;
  } catch { return null; }
}

/** Enter a salon in THIS tab. The agency login in localStorage is left alone. */
export function enterSupportSession(session: StoredSession): void {
  try { window.sessionStorage.setItem(SUPPORT_SESSION_KEY, JSON.stringify(session)); } catch { /* private mode */ }
  try { window.localStorage.removeItem('lumio_active_branch'); } catch { /* ignore */ }
}

/** Leave the salon this tab was in. Other tabs are untouched. */
export function leaveSupportSession(): void {
  try { window.sessionStorage.removeItem(SUPPORT_SESSION_KEY); } catch { /* ignore */ }
  try {
    // A legacy browser may still hold the parked agency login: restore it.
    const home = window.localStorage.getItem(LEGACY_HOME_KEY);
    if (home) { window.localStorage.setItem(AUTH_KEY, home); window.localStorage.removeItem(LEGACY_HOME_KEY); }
    else if (parse(window.localStorage.getItem(AUTH_KEY))?.user?.supportSession) window.localStorage.removeItem(AUTH_KEY);
  } catch { /* ignore */ }
}

/** Sign out everywhere: the tab's salon session and the shared login. */
export function clearAllSessions(): void {
  try { window.sessionStorage.removeItem(SUPPORT_SESSION_KEY); } catch { /* ignore */ }
  try { window.localStorage.removeItem(AUTH_KEY); window.localStorage.removeItem(LEGACY_HOME_KEY); } catch { /* ignore */ }
}

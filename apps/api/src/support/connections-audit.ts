/**
 * WHICH SALON HOLDS WHICH ACCOUNT — read in one pass for the agency list.
 *
 * When a Facebook Page, a Google location, a TikTok account or a Gmail
 * mailbox ends up under the wrong salon, every scheduled post and every mail
 * from then on goes out in the wrong name — and nobody can see it, because
 * each salon's own screen only shows its own connections, which look fine on
 * their own. This puts the names side by side, one row per salon, so a page
 * called "Glow Nails" sitting under "Lily Spa" is visible at a glance.
 *
 * Pure: the rows come from the caller, the shape is decided here and tested.
 */
export interface ConnectionsRow {
  fbPage: string | null;
  igUser: string | null;
  google: string | null;
  googleEmail: string | null;
  tiktok: string | null;
  mail: string | null;
}

export interface ConnectionSources {
  pages: { tenantId: string; pageName: string | null; pageId: string; igUsername: string | null }[];
  settings: { tenantId: string; key: string; value: unknown }[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** One row per tenant id, from the raw rows. A salon with nothing connected gets all nulls. */
export function connectionsByTenant(src: ConnectionSources): Map<string, ConnectionsRow> {
  const out = new Map<string, ConnectionsRow>();
  const row = (id: string) => {
    let r = out.get(id);
    if (!r) { r = { fbPage: null, igUser: null, google: null, googleEmail: null, tiktok: null, mail: null }; out.set(id, r); }
    return r;
  };
  for (const p of src.pages) {
    const r = row(p.tenantId);
    // Several pages under one salon is itself the smell: list them all.
    const name = str(p.pageName) ?? p.pageId;
    r.fbPage = r.fbPage ? `${r.fbPage}, ${name}` : name;
    if (p.igUsername) r.igUser = r.igUser ? `${r.igUser}, @${p.igUsername}` : `@${p.igUsername}`;
  }
  for (const s of src.settings) {
    const v = obj(s.value);
    const r = row(s.tenantId);
    if (s.key === 'googleReviews' && v.connected === true) {
      r.google = str(v.locationTitle) ?? (str(v.locationId) ? `location ${v.locationId}` : 'connected');
      r.googleEmail = str(v.connectedEmail);
    } else if (s.key === 'tiktok' && v.connected === true) {
      const c = obj(v.creator);
      const u = str(v.username) ?? str(c.username);
      r.tiktok = u ? `@${u}` : (str(v.displayName) ?? str(c.displayName) ?? 'connected');
    } else if (s.key === 'notifications') {
      const g = obj(v.gmail); const smtp = obj(v.smtp); const brevo = obj(v.brevo);
      const svc = str(v.mailService);
      if (svc === 'gmail' || (svc !== 'off' && str(g.refreshToken))) r.mail = str(g.senderEmail) ?? 'gmail';
      else if (svc === 'smtp' || (svc !== 'off' && str(smtp.user))) r.mail = str(smtp.fromEmail) ?? str(smtp.user);
      else if (svc === 'brevo' || (svc !== 'off' && str(brevo.apiKey))) r.mail = str(brevo.fromEmail) ?? 'brevo';
    }
  }
  return out;
}

/**
 * The same account under two salons. Facebook Pages are unique by id
 * already (the picker refuses a taken page), so this looks at the rest:
 * a Google location, a TikTok account or a mailbox that two rows share.
 */
export function sharedConnections(rows: Map<string, ConnectionsRow>): { kind: 'google' | 'tiktok' | 'mail'; value: string; tenantIds: string[] }[] {
  const seen = new Map<string, string[]>();
  for (const [id, r] of rows) {
    for (const kind of ['google', 'tiktok', 'mail'] as const) {
      const v = r[kind];
      if (!v || v === 'connected' || v === 'gmail' || v === 'brevo') continue;
      const k = `${kind}:${v.toLowerCase()}`;
      seen.set(k, [...(seen.get(k) ?? []), id]);
    }
  }
  return [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([k, ids]) => {
    const i = k.indexOf(':');
    return { kind: k.slice(0, i) as 'google' | 'tiktok' | 'mail', value: k.slice(i + 1), tenantIds: ids };
  });
}

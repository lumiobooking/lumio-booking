/** Thẻ khách — the pure line under the client's name in the technician's sheet. */

/** The one-line "who is this" under the name. Pure — exported for the spec. */
export function regularLine(c: { firstVisit: boolean; visits: number; withMe: number; lastVisit: string | null; lastWithMe: string | null }, vi: boolean, fmt: (iso: string) => string = (x) => x): string {
  if (c.firstVisit) return vi ? 'Khách mới — lần đầu đến tiệm' : 'New client — first visit';
  const last = c.lastVisit ? (vi ? ` · lần cuối ${fmt(c.lastVisit)}` : ` · last ${fmt(c.lastVisit)}`) : '';
  if (c.withMe === 0) return vi ? `Khách quen · ${c.visits} lần${last} · lần đầu với bạn` : `Regular · ${c.visits} visits${last} · first time with you`;
  return vi ? `Khách quen · ${c.visits} lần${last} · ${c.withMe} lần với bạn` : `Regular · ${c.visits} visits${last} · ${c.withMe} with you`;
}


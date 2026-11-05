/**
 * ONE MESSAGE PER PARTY.
 *
 * A party ("me and four friends") is one appointment per person, sharing a
 * groupId. Every one of them used to send its own "New booking" email, owner
 * SMS and push. A party of five reached the owner as five emails and five
 * texts a second apart (4 Nov 2026, MT. Hawthorn), and the person who booked
 * read a confirmation that named only her own service.
 *
 * Now each member of a party only (re)arms a short timer for its group; when
 * the party has stopped growing, ONE confirmation goes to the person who
 * booked and ONE notice to the salon, listing everybody. This file holds the
 * pure parts: who the contact is and what the summary says.
 */

/**
 * Wait this long after the last member is written before telling anyone. The
 * desk posts a party one person at a time, each with its own technician pick:
 * MT. Hawthorn's party of five took 18 s, up to 6 s between two guests.
 */
export const GROUP_NOTICE_DELAY_MS = 15_000;

export interface GroupMember {
  id: string;
  createdAt?: Date | string;
  priceCents: number;
  /** The visit's extra lines (extra services and add-ons), as stored on the appointment. */
  addons?: unknown;
  customer: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null;
  service: { name: string } | null;
  assignedStaff?: { firstName: string; lastName?: string | null } | null;
}

/** The party's contact: the member who left a phone or email (the person who booked); else the first one written. */
export function groupLead<T extends GroupMember>(members: T[]): T | null {
  if (!members.length) return null;
  return members.find((m) => !!(m.customer?.phone || m.customer?.email)) ?? members[0];
}

export interface GroupSummary {
  size: number;
  /** Replaces the service line: "Group of 5 · Manicure & Pedicure, Gel X". */
  service: string;
  /** One line per person: "Anna: Manicure & Pedicure — Lisa · Mai: Gel X". Lead first. */
  lineup: string;
  totalCents: number;
}

export function groupSummary(members: GroupMember[], vi: boolean): GroupSummary {
  const lead = groupLead(members);
  const ordered = lead ? [lead, ...members.filter((m) => m !== lead)] : members;
  const services = [...new Set(ordered.map((m) => (m.service?.name ?? '').trim()).filter(Boolean))];
  const head = vi ? `Nhóm ${ordered.length} người` : `Group of ${ordered.length}`;
  const lineup = ordered.map((m, i) => {
    const who = (m.customer?.firstName ?? '').trim() || (vi ? `Khách ${i + 1}` : `Guest ${i + 1}`);
    const tech = m.assignedStaff ? `${m.assignedStaff.firstName}`.trim() : '';
    const extras = (Array.isArray(m.addons) ? (m.addons as Array<{ name?: unknown } | null>) : [])
      .map((l) => (l && typeof l.name === 'string' ? l.name.trim() : '')).filter(Boolean);
    return `${who}: ${m.service?.name ?? ''}${extras.length ? ` + ${extras.join(', ')}` : ''}${tech ? ` — ${tech}` : ''}`;
  }).join(' · ');
  return {
    size: ordered.length,
    service: `${head} · ${services.join(', ')}`.slice(0, 200),
    lineup,
    totalCents: ordered.reduce((s, m) => s + (Number.isFinite(m.priceCents) ? m.priceCents : 0), 0),
  };
}

/**
 * Person by person, what the email and the text list: the main service with
 * its technician, every extra SERVICE with the technician on that line, and
 * the add-ons. `staffNames` resolves the extra lines' technician ids (one
 * query for the whole party, done by the caller). Lead first. Pure.
 */
export function visitPeople(
  members: GroupMember[],
  staffNames: Map<string, string>,
  vi: boolean,
): Array<{ name: string; lines: Array<{ service: string; tech?: string }>; addons?: string }> {
  const lead = groupLead(members);
  const ordered = lead ? [lead, ...members.filter((m) => m !== lead)] : members;
  return ordered.map((m, i) => {
    const extra = (Array.isArray(m.addons) ? (m.addons as Array<Record<string, unknown> | null>) : []).filter(Boolean) as Array<Record<string, unknown>>;
    const main = m.assignedStaff ? `${m.assignedStaff.firstName} ${m.assignedStaff.lastName ?? ''}`.trim() : '';
    const lines = [
      { service: m.service?.name ?? '', ...(main ? { tech: main } : {}) },
      ...extra.filter((l) => l.kind === 'service').map((l) => {
        const t = l.staffMemberId ? staffNames.get(String(l.staffMemberId)) : '';
        return { service: String(l.name ?? ''), ...(t ? { tech: t } : {}) };
      }),
    ].filter((l) => l.service);
    const addons = extra.filter((l) => l.kind !== 'service').map((l) => String(l.name ?? '')).filter(Boolean).join(', ');
    const name = (`${m.customer?.firstName ?? ''} ${m.customer?.lastName ?? ''}`).trim() || (vi ? `Khách ${i + 1}` : `Guest ${i + 1}`);
    return { name, lines, ...(addons ? { addons } : {}) };
  });
}

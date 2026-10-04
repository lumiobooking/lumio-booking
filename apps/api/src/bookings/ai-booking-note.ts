/**
 * THE LINE ON THE CALENDAR THAT SAYS WHAT THE AI HEARD.
 *
 * A booking the hotline or the chat bot made used to land on the calendar as
 * a name and a service, and nothing else — not which door it came through,
 * not the phone it came from, not that the customer asked for Kim, not that
 * she said "please no acrylic smell". The desk opened it and had to guess.
 *
 * One note, same shape on every channel, written in the salon's own language:
 *
 *   ☎️ AI Hotline · 📞 +1 512 555 0101 · Thợ yêu cầu: Kim · Nhóm 3: Anna, Lisa, Mai
 *   Khách dặn: "no acrylic smell"
 */
export type AiChannel = 'hotline' | 'messenger' | 'instagram' | 'web' | 'zalo';

export interface AiNoteInput {
  channel: AiChannel;
  lang: 'vi' | 'en';
  /** The number the customer gave or called from. */
  phone?: string | null;
  /** The technician the customer asked for, by first name. */
  techName?: string | null;
  /** Everybody in the party, the booker first. Length 1 = not a group. */
  partyNames?: string[];
  /** The customer's own words: a request, an allergy, "running 10 min late". */
  request?: string | null;
  /** The services for THIS person, when the booking carries more than the primary. */
  services?: string[];
}

const CHANNEL: Record<AiChannel, { vi: string; en: string; icon: string }> = {
  hotline: { vi: 'AI Hotline', en: 'AI Hotline', icon: '☎️' },
  messenger: { vi: 'AI Messenger', en: 'AI Messenger', icon: '💬' },
  instagram: { vi: 'AI Instagram', en: 'AI Instagram', icon: '💬' },
  web: { vi: 'AI chat website', en: 'AI web chat', icon: '💬' },
  zalo: { vi: 'AI Zalo', en: 'AI Zalo', icon: '💬' },
};

export function aiBookingNote(n: AiNoteInput): string {
  const vi = n.lang === 'vi';
  const ch = CHANNEL[n.channel] ?? CHANNEL.messenger;
  const head: string[] = [`${ch.icon} ${vi ? ch.vi : ch.en}`];
  if (n.phone) head.push(`📞 ${n.phone}`);
  if (n.services && n.services.length > 1) head.push(`${vi ? 'Dịch vụ' : 'Services'}: ${n.services.join(' + ')}`);
  if (n.techName) head.push(`${vi ? 'Thợ yêu cầu' : 'Asked for'}: ${n.techName}`);
  const party = (n.partyNames ?? []).filter(Boolean);
  if (party.length > 1) head.push(`${vi ? 'Nhóm' : 'Group of'} ${party.length}: ${party.join(', ')}`);
  const lines = [head.join(' · ')];
  const req = String(n.request ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (req) lines.push(`${vi ? 'Khách dặn' : 'Customer says'}: "${req}"`);
  return lines.join('\n');
}

/** The salon's own language for notes the desk reads, from its market. */
export function noteLangForMarket(market?: string | null): 'vi' | 'en' {
  return String(market ?? '').toUpperCase() === 'VN' ? 'vi' : 'en';
}

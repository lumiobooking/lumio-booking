/**
 * What the bot must never forget — and why it kept forgetting.
 *
 * A real consultation was lost to this: the customer had given their shop
 * name, their phone and their city, the bot had SAVED all of it as a sales
 * lead… and then asked for it again three messages later. Four faults, one
 * symptom:
 *
 *  1. The lead row was WRITE-ONLY. record_lead wrote name/phone/shop/city to
 *     the database and nothing ever read it back into the prompt. The most
 *     reliable memory in the system — structured, exact, no AI involved — was
 *     invisible to the very agent that wrote it.
 *  2. Long-term memory depended on the SAME Anthropic key the bot thinks with.
 *     When that key ran dry, distillation returned early and the turns falling
 *     out of the short window were lost forever — silently, with no retry.
 *  3. The distiller trusted a summary captured BEFORE it ran. Two messages in
 *     quick succession (people type in bursts) meant the second distillation
 *     overwrote the first with a stale base.
 *  4. Twelve turns of short-term memory is six exchanges — a sales chat about
 *     packages passes that before anyone says a price.
 *
 * This module holds the two pure decisions: how a lead becomes prompt text,
 * and how memory survives when the AI distiller cannot run.
 */

import type { ReplyLang } from '../common/reply-language';

export interface LeadFacts {
  name?: string | null;
  phone?: string | null;
  salonName?: string | null;
  city?: string | null;
  interest?: string | null;
  note?: string | null;
  createdAt?: Date | string | null;
}

/**
 * The customer's own words, already banked, rendered as an unmissable block.
 *
 * Deterministic on purpose: this is a database row, not a model's recollection,
 * so it works even when the AI's memory pipeline is broken or unpaid.
 */
export function leadDossier(lead: LeadFacts | null | undefined, lang: ReplyLang | null = null): string {
  if (!lead) return '';
  const rows: string[] = [];
  const en = lang === 'en';
  const add = (viLabel: string, enLabel: string, v: string | null | undefined) => {
    const s = String(v ?? '').trim();
    if (s) rows.push(`- ${en ? enLabel : viLabel}: ${s}`);
  };
  add('Tên khách', 'Customer name', lead.name);
  add('Số điện thoại', 'Phone number', lead.phone);
  add('Tên tiệm / doanh nghiệp', 'Business name', lead.salonName);
  add('Thành phố / khu vực', 'City / area', lead.city);
  add('Đang quan tâm', 'Interested in', lead.interest);
  add('Ghi chú', 'Notes', lead.note);
  if (!rows.length) return '';
  // This block is the LAST thing before the customer's message, so it is also
  // the loudest hint about what language to answer in. Written in Vietnamese
  // for everyone, it pulled English conversations into Vietnamese; it now
  // follows the customer.
  if (en) {
    return '\nWHAT THIS CUSTOMER HAS ALREADY TOLD US (saved in the system — THIS IS FACT; never ask again for anything listed here, just use it):\n'
      + rows.join('\n')
      + '\nIf the customer now gives something DIFFERENT, the new answer wins — update it silently, never ask which one is right.';
  }
  return '\nTHÔNG TIN KHÁCH ĐÃ CUNG CẤP (đã lưu trong hệ thống — ĐÂY LÀ SỰ THẬT, không được hỏi lại bất kỳ mục nào dưới đây; dùng thẳng khi cần):\n'
    + rows.join('\n')
    + '\nNếu khách đưa thông tin MỚI khác với trên, thông tin mới thắng — cập nhật im lặng, không hỏi khách cái nào đúng.';
}

/** Does the dossier already answer this question? Used to pin the rule in tests. */
export function dossierHas(lead: LeadFacts | null | undefined, field: keyof LeadFacts): boolean {
  return Boolean(lead && String(lead[field] ?? '').trim());
}

/**
 * Memory that cannot be lost, even with no AI available.
 *
 * When the distiller cannot run (no key, no credit, API down), the turns about
 * to fall out of the window are folded into the profile RAW — trimmed, tagged,
 * capped. Ugly prose in the profile is infinitely better than a bot that asks
 * a customer for their phone number twice.
 */
export function rawMemoryFallback(prev: string | null | undefined, dropped: { role: string; content: unknown }[], cap = 2000): string {
  const lines = (dropped ?? [])
    .map((t) => {
      const who = t.role === 'user' ? 'KHÁCH' : 'SHOP';
      const body = String(t.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return body ? `- ${who}: ${body}` : '';
    })
    .filter(Boolean);
  if (!lines.length) return String(prev ?? '');
  const head = String(prev ?? '').trim();
  const merged = [head, '(ghi thô — chưa chưng cất)', ...lines].filter(Boolean).join('\n');
  // Keep the TAIL when trimming: the newest facts are the ones a live
  // conversation needs, and the oldest were already summarised once.
  return merged.length <= cap ? merged : merged.slice(merged.length - cap);
}

/**
 * THE SALON'S OWN CUSTOMER, for the booking bot.
 *
 * The lead dossier above fixed write-only memory for the SALES bot. The
 * booking bot had the same fault and no fix: save_contact and create_booking
 * wrote a Customer row and stamped the thread with its id, and nothing read
 * either back — so a returning customer was asked for their name and phone
 * on every visit, and "when is my appointment?" meant asking for the phone
 * again to look it up. This block is that record, straight from the
 * database, in the customer's language.
 */
export interface KnownCustomer {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Upcoming, soonest first: "Gel manicure · Fri 3 Oct, 2:00 PM · with Ivy". */
  upcoming?: { service: string; when: string; staff?: string | null }[];
  /** The most recent finished visit, if any. */
  lastVisit?: { service: string; when: string } | null;
  visits?: number | null;
  /** The name the platform shows for this person (Facebook profile), when no record exists yet. */
  displayName?: string | null;
}

export function customerDossier(c: KnownCustomer | null | undefined, lang: ReplyLang | null = null): string {
  if (!c) return '';
  const en = lang === 'en';
  const rows: string[] = [];
  const add = (viLabel: string, enLabel: string, v: string | null | undefined) => {
    const s = String(v ?? '').trim();
    if (s) rows.push(`- ${en ? enLabel : viLabel}: ${s}`);
  };
  const name = [c.firstName, c.lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
  add('Tên khách', 'Customer name', name || c.displayName);
  add('Số điện thoại', 'Phone number', c.phone);
  add('Email', 'Email', c.email);
  if (c.upcoming?.length) {
    add('Lịch hẹn sắp tới', 'Upcoming appointment(s)', c.upcoming.map((a) => `${a.service} · ${a.when}${a.staff ? (en ? ` · with ${a.staff}` : ` · thợ ${a.staff}`) : ''}`).join(' | '));
  }
  if (c.lastVisit) add('Lần ghé gần nhất', 'Last visit', `${c.lastVisit.service} · ${c.lastVisit.when}`);
  if (c.visits && c.visits > 1) add('Số lần đã ghé', 'Visits so far', String(c.visits));
  if (!rows.length) return '';
  if (en) {
    return '\nKNOWN CUSTOMER — the salon\'s own record of this person (from the database; THIS IS FACT). Never ask for anything listed here; use it. To book, you still need only what is MISSING from this list plus the service and time. If they ask about their appointment, the upcoming one is right here — do not ask for their phone number to look it up:\n'
      + rows.join('\n')
      + '\nIf they now give a different name or phone, the new one wins — update silently, never ask which is right.';
  }
  return '\nKHÁCH ĐÃ CÓ HỒ SƠ — dữ liệu của chính tiệm về người này (từ database; ĐÂY LÀ SỰ THẬT). Không hỏi lại bất kỳ mục nào dưới đây; dùng thẳng. Để đặt lịch chỉ cần hỏi thứ CÒN THIẾU trong danh sách này cộng với dịch vụ và giờ. Khách hỏi về lịch hẹn thì lịch sắp tới ở ngay đây — không hỏi số điện thoại để tra:\n'
    + rows.join('\n')
    + '\nNếu khách đưa tên hoặc số mới khác với trên, thông tin mới thắng — cập nhật im lặng, không hỏi khách cái nào đúng.';
}

/**
 * What a customer sent that is not words.
 *
 * A photo of a nail design, a screenshot of a competitor's price list, a
 * picture of a broken set — a good share of what reaches a salon's inbox
 * is a picture with no caption at all. The webhook used to drop those on
 * the floor (`if (!text) continue`), so the customer saw "seen" and nothing
 * else, which reads as being ignored. Now every attachment becomes a turn
 * with a placeholder the model can read, and a photo is handed to the model
 * to look at.
 *
 * Meta and Zalo describe attachments differently; both are read here into
 * one shape so the brain has a single idea of "the customer sent a file".
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'location' | 'other';

export interface InboundMedia {
  kind: MediaKind;
  /** Public (signed, short-lived) URL when the platform gives one. */
  url: string | null;
}

/** Meta's `message.attachments` on a Messenger / Instagram webhook event. */
export function metaAttachments(message: unknown): InboundMedia[] {
  const m = message as { attachments?: unknown } | null | undefined;
  const list = Array.isArray(m?.attachments) ? m!.attachments : [];
  const out: InboundMedia[] = [];
  for (const raw of list) {
    const a = raw as { type?: unknown; payload?: { url?: unknown; sticker_id?: unknown; coordinates?: unknown } } | null;
    if (!a) continue;
    const type = String(a.type ?? '').toLowerCase();
    const url = typeof a.payload?.url === 'string' && /^https?:\/\//i.test(a.payload.url) ? a.payload.url : null;
    if (type === 'image') out.push({ kind: a.payload?.sticker_id != null ? 'sticker' : 'image', url });
    else if (type === 'video') out.push({ kind: 'video', url });
    else if (type === 'audio') out.push({ kind: 'audio', url });
    else if (type === 'file') out.push({ kind: 'file', url });
    else if (type === 'location') out.push({ kind: 'location', url: null });
    else if (type === 'fallback' || type === 'template') continue; // link previews, our own cards
    else out.push({ kind: 'other', url });
  }
  return out;
}

/**
 * Zalo names the event by what was sent: user_send_image, user_send_sticker,
 * user_send_gif, user_send_video, user_send_audio, user_send_file,
 * user_send_location. Images arrive as `message.attachments[].payload.url`.
 */
export function zaloAttachments(eventName: string, message: unknown): InboundMedia[] {
  const ev = String(eventName ?? '');
  const m = message as { attachments?: unknown } | null | undefined;
  const list = Array.isArray(m?.attachments) ? m!.attachments : [];
  const urlOf = (raw: unknown) => {
    const a = raw as { payload?: { url?: unknown; thumbnail?: unknown } } | null;
    const u = a?.payload?.url ?? a?.payload?.thumbnail;
    return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
  };
  const kind: MediaKind | null =
    ev === 'user_send_image' ? 'image'
      : ev === 'user_send_sticker' || ev === 'user_send_gif' ? 'sticker'
        : ev === 'user_send_video' ? 'video'
          : ev === 'user_send_audio' ? 'audio'
            : ev === 'user_send_file' ? 'file'
              : ev === 'user_send_location' ? 'location'
                : null;
  if (!kind) return [];
  if (!list.length) return [{ kind, url: null }];
  return list.map((raw) => ({ kind, url: urlOf(raw) }));
}

/** The photo URLs the model may look at — pictures only, never stickers. */
export function imageUrls(media: InboundMedia[], max = 3): string[] {
  return media.filter((m) => m.kind === 'image' && m.url).map((m) => m.url as string).slice(0, max);
}

/**
 * What the turn says when there were no words. Bracketed so the model and
 * the person reading the inbox both see it as a stage direction, not as
 * something the customer typed.
 */
export function describeMedia(media: InboundMedia[]): string {
  if (!media.length) return '';
  const n = (k: MediaKind) => media.filter((m) => m.kind === k).length;
  const parts: string[] = [];
  if (n('image')) parts.push(n('image') === 1 ? 'gửi 1 ảnh' : `gửi ${n('image')} ảnh`);
  if (n('video')) parts.push('gửi video');
  if (n('audio')) parts.push('gửi tin nhắn thoại');
  if (n('file')) parts.push('gửi file');
  if (n('sticker')) parts.push('gửi sticker');
  if (n('location')) parts.push('gửi vị trí');
  if (n('other')) parts.push('gửi tệp đính kèm');
  return `[Khách ${parts.join(', ')}]`;
}

/**
 * How the model should treat a picture, added to the system prompt only on
 * turns that carry one. The instinct to avoid is the confident guess: a
 * model that names a price for a design it cannot match to the menu is a
 * model that has just quoted a number the shop did not agree to.
 */
export function visionRule(): string {
  return `
The customer's latest message includes one or more PHOTOS, attached above. Look at them before answering.
- If it is a design or reference (nails, hair, lashes, brows, a dish, a product): describe in one short phrase what you see, say whether the shop offers that kind of work based ONLY on the services and facts you were given, and move to booking (ask for a day/time). If the shop's price list covers it, you may say the price; otherwise say the technician will confirm the price in person — never invent one.
- If it shows the customer's current state (a chipped set, damaged hair, a skin concern): recommend the matching service from the shop's list and offer a time. Do not diagnose; do not promise medical results.
- If it is a payment screenshot, invoice or receipt: thank them, say a staff member will confirm, and stop — do not confirm any payment yourself.
- If it is a screenshot of another shop's prices or a message: answer what they seem to be asking (usually "can you match this?"), honestly and briefly.
- If the photo is unclear or unrelated, say what you can see and ask what they would like.
Never describe a person's body or appearance beyond what the service needs. Keep the reply as short as a text message.`;
}

/**
 * Sticker, voice note, file: nothing to look at, but silence is worse than a
 * short reply. Tell the model what arrived so it can respond in kind.
 */
export function nonImageRule(media: InboundMedia[]): string {
  if (!media.length || media.some((m) => m.kind === 'image')) return '';
  const kinds = Array.from(new Set(media.map((m) => m.kind)));
  const lines: string[] = [];
  if (kinds.includes('sticker')) lines.push('The customer sent a sticker/GIF. React warmly in a few words and continue the conversation where it was; do not ask what the sticker means.');
  if (kinds.includes('audio')) lines.push('The customer sent a voice message you cannot hear. Say so politely and ask them to type it in a line — or offer the phone number if the shop has one.');
  if (kinds.includes('video')) lines.push('The customer sent a video you cannot watch. Say so politely and ask them to describe it in a line, or send a photo instead.');
  if (kinds.includes('file')) lines.push('The customer sent a file you cannot open. Say so politely and ask what it is; a staff member can look at it.');
  if (kinds.includes('location')) lines.push('The customer shared their location. Acknowledge it and continue — if they seem to be asking for directions, give the shop address.');
  return lines.length ? `\n${lines.join('\n')}` : '';
}

/** Anthropic image block media types we can send. */
export function imageMediaType(contentType: string | null | undefined): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
  const t = String(contentType ?? '').toLowerCase().split(';')[0].trim();
  if (t === 'image/jpeg' || t === 'image/jpg') return 'image/jpeg';
  if (t === 'image/png') return 'image/png';
  if (t === 'image/gif') return 'image/gif';
  if (t === 'image/webp') return 'image/webp';
  return null;
}

/** The API refuses images past 5 MB; a phone photo is often more. */
export const IMAGE_MAX_BYTES = 4_500_000;

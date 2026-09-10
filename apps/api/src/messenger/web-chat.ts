/**
 * Website chat — the parts with no opinions.
 *
 * A fourth mouth on the same brain. Messenger, Instagram and Zalo each bring
 * their own transport; the website brings none: the visitor's browser POSTs
 * a line, the brain answers into the thread's history, and the browser reads
 * the history back. There is no token to refresh and no webhook to verify —
 * which is why this file is small, and why the visitor id IS the credential
 * (a random 128-bit value the browser keeps; whoever holds it reads that one
 * conversation, exactly like a session cookie).
 *
 * Conventions:
 *   - messenger_pages row per salon with pageId "web:<tenantId>", so the brain
 *     routes by page id the way it does for every other mouth;
 *   - messenger_threads.senderId = the visitor id;
 *   - Setting key "web_chat" holds the salon's switch and look.
 */

export const WEB_PAGE_PREFIX = 'web:';
export const WEB_CHAT_KEY = 'web_chat';

export function webPageId(tenantId: string): string {
  return `${WEB_PAGE_PREFIX}${tenantId}`;
}

export function isWebPage(pageId: string | null | undefined): boolean {
  return typeof pageId === 'string' && pageId.startsWith(WEB_PAGE_PREFIX);
}

/** The browser mints it; the server only checks the shape. 16–64 url-safe chars. */
export function cleanVisitor(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  return /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null;
}

/** One line from the visitor: trimmed, bounded, never empty. */
export function cleanText(raw: unknown): string | null {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 1000) : null;
}

export interface WebChatConfig {
  enabled: boolean;
  /** Accent colour of the bubble and the visitor's own lines. */
  color: string;
  /** First line the visitor sees before writing. Empty = the widget's own. */
  greeting: string;
  /** Where the bubble sits. */
  position: 'right' | 'left';
}

export const WEB_CHAT_DEFAULTS: WebChatConfig = { enabled: false, color: '#6366f1', greeting: '', position: 'right' };

/** Merge a settings write over what is stored. Unknown keys are dropped, a
 *  colour that is not a colour is dropped, and the switch only moves when the
 *  write says so — a form that saves the greeting must not flip it. */
export function cleanWebChatConfig(dto: Record<string, unknown> | null | undefined, prev?: Partial<WebChatConfig> | null): WebChatConfig {
  const base: WebChatConfig = { ...WEB_CHAT_DEFAULTS, ...(prev ?? {}) };
  const d = dto ?? {};
  if (typeof d.enabled === 'boolean') base.enabled = d.enabled;
  if (typeof d.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.color.trim())) base.color = d.color.trim().toLowerCase();
  if (typeof d.greeting === 'string') base.greeting = d.greeting.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (d.position === 'left' || d.position === 'right') base.position = d.position;
  return base;
}

export interface WidgetTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** A person at the salon wrote it, not the bot. */
  human: boolean;
}

/**
 * The thread's history as the widget shows it: only turns newer than what the
 * browser already has. A turn with no timestamp (written before the column
 * existed) is sent only on a full read, never as "new".
 */
export function turnsSince(
  history: unknown,
  since: string | null | undefined,
): WidgetTurn[] {
  const rows = Array.isArray(history) ? history : [];
  const sinceMs = since ? Date.parse(since) : NaN;
  const out: WidgetTurn[] = [];
  for (const r of rows as { role?: string; content?: unknown; at?: string; manual?: boolean; failed?: boolean }[]) {
    if (!r || (r.role !== 'user' && r.role !== 'assistant')) continue;
    if (r.failed) continue;
    const text = typeof r.content === 'string' ? r.content : '';
    if (!text.trim()) continue;
    const atMs = r.at ? Date.parse(r.at) : NaN;
    if (Number.isFinite(sinceMs)) {
      if (!Number.isFinite(atMs) || atMs <= sinceMs) continue;
    }
    out.push({ role: r.role, text, at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : '', human: Boolean(r.manual) });
  }
  return out;
}

/** The line the salon pastes into its website. */
export function embedSnippet(apiBase: string, slug: string): string {
  return `<script src="${apiBase}/public/chat/widget.js" data-salon="${slug}" async></script>`;
}

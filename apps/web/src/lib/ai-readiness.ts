/**
 * THE AI PAGE, ONE PAGE (17/11/2026) — the rules behind its top block.
 *
 * The owner's three questions, answered before anything else on the page:
 * where is the AI answering, is it ready, what should I do next. "Ready" is
 * six plain checks; each one that fails says what is wrong in the owner's
 * words and where to fix it. Pure rules — components/ai/AiOnePage draws them.
 */

export interface AiNumbers {
  days: number; conversations: number;
  selfHandled: number; selfHandledRate: number | null;
  humanTook: number; booked: number; leads: number; botReplies: number;
  medianSec: number | null; p90Sec: number | null;
  /** Share of the owner's-instruction checks that blocked a reply; null with too few to say. */
  blockRate: number | null;
  /** Customers whose last message nobody has answered, right now. */
  waitingNow: number;
  stoppedAt: Record<string, number>;
  gapsOpen: number;
}
export interface AiOverview {
  v2: boolean; pageKind: 'sales' | 'booking'; aiOn: boolean;
  channels: { messenger: string[]; instagram: string[]; zalo: string[]; web: boolean };
  numbers: AiNumbers;
}

/** Where a failing check sends the owner: a section of the page, or the channels screen. */
export type ReadyGo = 'channels' | 'knowledge' | 'learn' | 'teach' | 'sim';
export interface ReadyItem { k: 'channel' | 'knowledge' | 'rules' | 'gaps' | 'speed' | 'sim'; ok: boolean; vi: string; en: string; go?: ReadyGo; goVi?: string; goEn?: string }

/** A customer should not wait longer than this for a reply. */
export const TARGET_SEC = 5;
/** The owner's own instructions should block fewer replies than this. */
export const TARGET_BLOCK = 0.05;
/** A sample run counts as passed from here (the platform's own bar for a release). */
export const SIM_PASS = 0.85;

const pct = (r: number) => Math.round(r * 100);
const secs = (s: number) => (s >= 10 ? Math.round(s) : Math.round(s * 10) / 10);

export function readiness(o: {
  connected: boolean;
  /** Notes switched on + documents linked. */
  knowledge: number;
  /** Old notes that contradict the documents; null = never checked. */
  conflicts: number | null;
  blockRate: number | null;
  gaps: number | null;
  medianSec: number | null;
  sim: { passed: number; total: number; stale?: boolean } | null;
}): ReadyItem[] {
  const conflicts = o.conflicts ?? 0;
  const blocked = o.blockRate !== null && o.blockRate > TARGET_BLOCK;
  const simOk = !!o.sim && !o.sim.stale && o.sim.total > 0 && o.sim.passed / o.sim.total >= SIM_PASS;
  return [
    o.connected
      ? { k: 'channel', ok: true, vi: 'Đã nối kênh chat', en: 'A chat channel is connected' }
      : { k: 'channel', ok: false, vi: 'Chưa nối kênh nào — AI chưa có nơi để trả lời khách', en: 'No channel connected — the AI has nowhere to answer', go: 'channels', goVi: 'Nối kênh', goEn: 'Connect' },
    o.knowledge > 0
      ? { k: 'knowledge', ok: true, vi: `Có nguồn kiến thức: ${o.knowledge} ghi chú và tài liệu`, en: `Has knowledge: ${o.knowledge} notes and documents` }
      : { k: 'knowledge', ok: false, vi: 'Chưa có kiến thức — AI chưa biết giá, giờ, chính sách', en: 'No knowledge yet — the AI does not know prices, hours or policies', go: 'knowledge', goVi: 'Thêm', goEn: 'Add' },
    conflicts === 0 && !blocked
      ? { k: 'rules', ok: true, vi: 'Dặn dò và ghi chú không mâu thuẫn nhau', en: 'Instructions and notes do not contradict each other' }
      : conflicts > 0
        ? { k: 'rules', ok: false, vi: `${conflicts} ghi chú cũ đang mâu thuẫn với tài liệu${blocked ? ` — ${pct(o.blockRate as number)}% câu trả lời bị chặn và phải viết lại` : ''}`, en: `${conflicts} old notes contradict the documents${blocked ? ` — ${pct(o.blockRate as number)}% of replies are blocked and rewritten` : ''}`, go: 'learn', goVi: 'Gỡ', goEn: 'Fix' }
        : { k: 'rules', ok: false, vi: `${pct(o.blockRate as number)}% câu trả lời bị dặn dò chặn và phải viết lại (nên dưới ${pct(TARGET_BLOCK)}%)`, en: `${pct(o.blockRate as number)}% of replies are blocked by your instructions and rewritten (aim for under ${pct(TARGET_BLOCK)}%)`, go: 'teach', goVi: 'Xem dặn dò', goEn: 'Review' },
    !o.gaps
      ? { k: 'gaps', ok: true, vi: 'Không còn câu hỏi nào chờ dạy', en: 'No questions waiting to be taught' }
      : { k: 'gaps', ok: false, vi: `${o.gaps} câu hỏi AI chưa biết trả lời`, en: `${o.gaps} questions the AI cannot answer yet`, go: 'learn', goVi: 'Dạy', goEn: 'Teach' },
    o.medianSec === null
      ? { k: 'speed', ok: false, vi: 'Chưa đủ câu trả lời để đo tốc độ', en: 'Not enough replies yet to measure speed' }
      : o.medianSec <= TARGET_SEC
        ? { k: 'speed', ok: true, vi: `Khách chờ ${secs(o.medianSec)} giây mỗi câu`, en: `Customers wait ${secs(o.medianSec)}s per reply` }
        : { k: 'speed', ok: false, vi: `Khách chờ ${secs(o.medianSec)} giây mỗi câu (mục tiêu dưới ${TARGET_SEC} giây)`, en: `Customers wait ${secs(o.medianSec)}s per reply (target: under ${TARGET_SEC}s)` },
    simOk
      ? { k: 'sim', ok: true, vi: `Bộ khách mẫu đạt ${o.sim!.passed}/${o.sim!.total}`, en: `Sample customers passed ${o.sim!.passed}/${o.sim!.total}` }
      : !o.sim
        ? { k: 'sim', ok: false, vi: 'Bộ khách mẫu chưa chạy lần nào', en: 'The sample customers have never been run', go: 'sim', goVi: 'Chạy thử', goEn: 'Run' }
        : o.sim.stale
          ? { k: 'sim', ok: false, vi: `Kiến thức đã đổi từ lần chạy bộ khách mẫu trước (đạt ${o.sim.passed}/${o.sim.total})`, en: `Knowledge changed since the last sample run (${o.sim.passed}/${o.sim.total})`, go: 'sim', goVi: 'Chạy lại', goEn: 'Run again' }
          : { k: 'sim', ok: false, vi: `Bộ khách mẫu mới đạt ${o.sim.passed}/${o.sim.total}`, en: `Sample customers passed only ${o.sim.passed}/${o.sim.total}`, go: 'sim', goVi: 'Xem', goEn: 'See' },
  ];
}

export interface AiTile { k: string; vi: string; en: string; value: string; subVi?: string; subEn?: string; tone?: 'good' | 'warn' }

/**
 * The numbers under the status — BY KIND OF PAGE. A page that sells has no
 * appointments: "Booked 0" on the agency's own page was a number about nothing.
 */
export function aiTiles(n: AiNumbers, pageKind: 'sales' | 'booking'): AiTile[] {
  const rate = n.selfHandledRate === null ? '—' : `${pct(n.selfHandledRate)}%`;
  return [
    { k: 'conv', vi: `Cuộc trò chuyện · ${n.days} ngày`, en: `Conversations · ${n.days} days`, value: String(n.conversations) },
    { k: 'self', vi: 'AI tự lo trọn cuộc', en: 'Handled by the AI alone', value: rate, subVi: `${n.selfHandled} cuộc không cần người`, subEn: `${n.selfHandled} needed nobody` },
    { k: 'human', vi: 'Chuyển cho người', en: 'Taken by a person', value: String(n.humanTook) },
    pageKind === 'sales'
      ? { k: 'leads', vi: 'Khách để lại thông tin', en: 'Leads captured', value: String(n.leads), subVi: 'tên, tiệm hoặc số điện thoại', subEn: 'a name, business or phone' }
      : { k: 'booked', vi: 'Lịch đặt từ trò chuyện', en: 'Bookings from chats', value: String(n.booked) },
    { k: 'speed', vi: 'Khách chờ mỗi câu (trung vị)', en: 'Wait per reply (median)', value: n.medianSec === null ? '—' : `${secs(n.medianSec)} giây`, subVi: `mục tiêu dưới ${TARGET_SEC} giây`, subEn: `target: under ${TARGET_SEC}s`, tone: n.medianSec === null ? undefined : n.medianSec <= TARGET_SEC ? 'good' : 'warn' },
    { k: 'block', vi: 'Câu bị dặn dò chặn', en: 'Replies blocked by instructions', value: n.blockRate === null ? '—' : `${pct(n.blockRate)}%`, subVi: `nên dưới ${pct(TARGET_BLOCK)}%`, subEn: `aim for under ${pct(TARGET_BLOCK)}%`, tone: n.blockRate === null ? undefined : n.blockRate <= TARGET_BLOCK ? 'good' : 'warn' },
  ];
}

/** Where the period's conversations ended up — largest first. A conversation can be on two lines. */
export function aiFunnel(n: AiNumbers, pageKind: 'sales' | 'booking'): { k: string; vi: string; en: string; n: number }[] {
  const s = n.stoppedAt ?? {};
  const rows = [
    { k: 'human', vi: 'Chuyển cho người', en: 'Taken by a person', n: n.humanTook },
    { k: 'self', vi: 'AI tự lo trọn cuộc', en: 'Handled by the AI alone', n: n.selfHandled },
    { k: 'general', vi: 'Hỏi rồi rời đi', en: 'Asked, then left', n: Number(s.general) || 0 },
    { k: 'contact', vi: 'Dừng ở bước xin tên và số điện thoại', en: 'Stopped at name and phone', n: Number(s.contact) || 0 },
    ...(pageKind === 'booking' ? [
      { k: 'time', vi: 'Dừng ở bước chọn ngày giờ', en: 'Stopped at choosing a time', n: Number(s.time) || 0 },
      { k: 'confirm', vi: 'Dừng ở bước xác nhận lịch', en: 'Stopped at confirming', n: Number(s.confirm) || 0 },
    ] : []),
    { k: 'noReply', vi: 'Khách nhắn cuối, chưa ai trả lời', en: 'Last message unanswered', n: Math.max(Number(s.noReply) || 0, n.waitingNow) },
  ];
  return rows.filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
}

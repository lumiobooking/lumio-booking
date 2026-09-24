/**
 * Where a shop's message lands, seen from the team's side.
 *
 * Every notice the team gets — bell row, push, badge — carries a link that
 * opens the exact thing the shop wrote on, inside that shop's session. The
 * subject is the content chat's address ('post:<id>', 'general', 'ads',
 * 'week:<key>', 'idea:<id>'); this file is the one place that turns it into a
 * path, so the bell and the push can never disagree about where to go.
 */

export type NoticeKind = 'post' | 'chat' | 'ads' | 'week' | 'idea' | 'files';

export function kindOf(subject: string): NoticeKind {
  if (subject.startsWith('post:')) return 'post';
  if (subject.startsWith('week:')) return 'week';
  if (subject.startsWith('idea:')) return 'idea';
  if (subject === 'ads') return 'ads';
  return 'chat';
}

/** Path inside the salon session that opens this subject, thread unfolded. */
export function linkFor(subject: string): string {
  const k = kindOf(subject);
  const chat = `&chat=${encodeURIComponent(subject)}`;
  switch (k) {
    case 'post': return `/salon/content?tab=queue&post=${encodeURIComponent(subject.slice(5))}`;
    case 'week': return `/salon/content?tab=week${chat}`;
    case 'idea': return `/salon/content?tab=today${chat}`;
    case 'ads': return `/salon/content?tab=ads${chat}`;
    default: return `/salon/content?tab=week${chat}`;
  }
}

/** The agency list URL that steps into a salon and then opens `link`. */
export function agencyLink(tenantId: string, link: string): string {
  return `/agency?open=${encodeURIComponent(tenantId)}&to=${encodeURIComponent(link)}`;
}

/** What the row is called when the subject has no post to name it after. */
export function titleFor(subject: string, vi = true): string {
  switch (kindOf(subject)) {
    case 'chat': return vi ? 'Trao đổi chung' : 'General chat';
    case 'ads': return vi ? 'Quảng cáo' : 'Ads';
    case 'week': return vi ? `Kế hoạch tuần ${subject.slice(5)}` : `Week plan ${subject.slice(5)}`;
    case 'idea': return vi ? 'Ý tưởng' : 'Idea';
    case 'post': return vi ? 'Bài đăng' : 'Post';
    default: return subject;
  }
}

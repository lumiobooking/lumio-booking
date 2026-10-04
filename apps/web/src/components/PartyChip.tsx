'use client';

/**
 * "👥 A · 2/3" — who came in with whom.
 *
 * Friends who book or walk in together each have their own ticket (own
 * services, own technician, own line at the till), so on the floor they
 * looked like strangers. Every ticket of a party now wears the party's
 * letter, and the count says how far along the group is: 2/3 means two of
 * the three are in a chair or done, so the desk knows who is still waiting
 * before the whole party can pay.
 */
import { useLang } from '../lib/i18n';

export interface PartyInfo { tag: string; size: number; waiting: number; serving: number; done: number }

export function partyTitle(g: PartyInfo, vi: boolean): string {
  return vi
    ? `Nhóm ${g.tag} · ${g.size} người · ${g.serving} đang làm · ${g.done} xong · ${g.waiting} chờ`
    : `Party ${g.tag} · ${g.size} people · ${g.serving} in a chair · ${g.done} done · ${g.waiting} waiting`;
}

export function PartyChip({ group, size = 'sm' }: { group: PartyInfo | null | undefined; size?: 'sm' | 'md' }) {
  const { lang } = useLang();
  const vi = lang === 'vi';
  if (!group) return null;
  const along = group.serving + group.done;
  return (
    <span title={partyTitle(group, vi)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, whiteSpace: 'nowrap',
      fontSize: size === 'md' ? 12 : 11, fontWeight: 700, lineHeight: 1,
      padding: size === 'md' ? '3px 8px' : '2px 7px', borderRadius: 999,
      color: 'var(--cc7d2fe)', background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.45)',
    }}>
      👥 {group.tag}{group.size > 1 ? ` · ${along}/${group.size}` : ''}
    </span>
  );
}

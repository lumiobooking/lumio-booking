import { agencyLink, kindOf, linkFor, titleFor } from './team-notices';

describe('team notices: every subject opens somewhere', () => {
  it('a post note opens that post in the queue', () => {
    expect(linkFor('post:abc-1')).toBe('/salon/content?tab=queue&post=abc-1');
    expect(kindOf('post:abc-1')).toBe('post');
  });
  it('the general thread opens on the week tab with the thread unfolded', () => {
    expect(linkFor('general')).toBe('/salon/content?tab=week&chat=general');
    expect(kindOf('general')).toBe('chat');
  });
  it('ads / week / idea go to their own tabs', () => {
    expect(linkFor('ads')).toContain('tab=ads');
    expect(linkFor('week:2026-W39')).toBe('/salon/content?tab=week&chat=week%3A2026-W39');
    expect(linkFor('idea:xyz')).toContain('tab=today');
  });
  it('the agency link steps into the salon first', () => {
    expect(agencyLink('t1', '/salon/content?tab=queue&post=p')).toBe('/agency?open=t1&to=%2Fsalon%2Fcontent%3Ftab%3Dqueue%26post%3Dp');
  });
  it('names the row when there is no post title', () => {
    expect(titleFor('general')).toBe('Trao đổi chung');
    expect(titleFor('week:2026-W39')).toContain('2026-W39');
  });
});

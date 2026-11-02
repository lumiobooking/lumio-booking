import { readFileSync } from 'fs';
import { join } from 'path';
import { stillUp, takenDown } from './post-takedown';

/** "Khi nhân viên đăng bài cho khách bị sai có thể xoá từ hệ thống được không" (2 Nov 2026). */
describe('a published post, taken down', () => {
  const posted = (results: object[]) => ({ status: 'posted', results: results as never });
  it('is still up on the networks not taken down yet (failed ones never count)', () => {
    const p = posted([{ channel: 'facebook', id: '1_2' }, { channel: 'instagram', id: '9', removedAt: '2026-11-02T10:00:00Z' }, { channel: 'tiktok', id: null, error: 'x' }]);
    expect(stillUp(p).map((r) => r.channel)).toEqual(['facebook']);
    expect(takenDown(p)).toBe(false);
  });
  it('is "taken down" once every network it reached is', () => {
    expect(takenDown(posted([{ channel: 'facebook', id: '1', removedAt: 'x' }, { channel: 'google', id: 'a/b', removedAt: 'y' }]))).toBe(true);
    expect(takenDown({ status: 'scheduled', results: [] })).toBe(false);
    expect(takenDown(posted([]))).toBe(false);
  });
  it('the calendar offers it in the right-click menu and per channel in the post, and paints it', () => {
    const studio = readFileSync(join(__dirname, '..', 'components', 'PostStudio.tsx'), 'utf8');
    expect(studio).toMatch(/onTakeDown\(m\.id\)/);
    expect(studio).toMatch(/takenDown\(p\) \? 'removed' : 'posted'/);
    const page = readFileSync(join(__dirname, '..', 'app', 'salon', 'content', 'page.tsx'), 'utf8');
    expect(page).toMatch(/\/content\/posts\/\$\{id\}\/take-down/);
    expect(page).toMatch(/takeDownPost\(live\.id, \[c\]\)/);
    expect(page).toMatch(/onTakeDown=\{queue\.canTakeDown/);
  });
});

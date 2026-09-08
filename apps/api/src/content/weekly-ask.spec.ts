import { weeklyAsk, ASK_KINDS } from './weekly-ask';
import { bi, viOf, enOf } from './i18n';
import type { JobKind } from './weekly-plan';

const labels = [bi('Thứ 2', 'Monday'), bi('Thứ 3', 'Tuesday'), bi('Thứ 4', 'Wednesday'), bi('Thứ 5', 'Thursday')];
const job = (kind: JobKind, dayIndex: number, text: string, id = `${kind}${dayIndex}`) =>
  ({ id, kind, dayIndex, day: labels[dayIndex], text: bi(text, text) });

describe('weeklyAsk', () => {
  it('folds filming and photography into ONE ask, however many rows the plan splits them into', () => {
    // The shop sets the phone up once. Two rows on the agency's board is one
    // errand in the salon, and presenting it as two is what made the screen
    // read like homework.
    const a = weeklyAsk([
      job('film', 0, 'Quay gộp 3 clip trong một buổi (mỗi clip 15-30 giây)'),
      job('photo', 0, 'Chụp 6 ảnh trong cùng buổi quay'),
      job('post', 1, 'Đăng clip 1'),
    ], labels)!;
    expect(a.jobIds).toEqual(['film0', 'photo0']);
    expect(viOf(a.what)).toBe('Quay 3 clip ngắn và 6 tấm ảnh — một buổi, bằng điện thoại. Bên em lo dựng, viết bài và đăng.');
    expect(enOf(a.what)).toMatch(/^3 short clips and 6 photos — one sitting/);
  });

  it('takes the deadline from the day the first post goes out, not from a date somebody picked', () => {
    const a = weeklyAsk([
      job('film', 0, 'Quay 2 clip'),
      job('post', 2, 'Đăng clip 1'),
      job('story', 1, 'Story hậu trường'),
    ], labels)!;
    // Wednesday's post is not the first thing that needs the material — Tuesday's story is.
    expect(a.byDayIndex).toBe(1);
    expect(viOf(a.by)).toBe('trước Thứ 3');
  });

  it('says "today" rather than naming a day when the material is needed now', () => {
    const a = weeklyAsk([job('film', 0, 'Quay 1 clip')], labels)!;
    expect(a.byDayIndex).toBe(0);
    expect(viOf(a.by)).toBe('trong hôm nay');
  });

  it('asks for nothing rather than inventing a chore when the week needs no material', () => {
    expect(weeklyAsk([job('post', 1, 'Đăng lại bài cũ'), job('engage', 2, 'Xin đánh giá')], labels)).toBeNull();
  });

  it('never reaches for work that is the agency\'s', () => {
    // Replying to comments and updating the Google profile are Lumio's, whatever
    // the plan calls them. Only what happens in front of the shop's own camera.
    expect(ASK_KINDS).toEqual(['film', 'photo']);
  });
});

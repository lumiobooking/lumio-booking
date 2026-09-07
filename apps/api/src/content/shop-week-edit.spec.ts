import { shopPatchToDays } from './shop-week-edit';
import { sanitizeDays } from './week-edit';
import { attachBriefs } from './job-brief';
import { bi, viOf } from './i18n';
import type { DayPlan } from './weekly-plan';

const base: DayPlan[] = attachBriefs([
  { weekday: 1, label: bi('Thứ 2', 'Monday'), jobs: [{ kind: 'film', text: bi('Quay 1 clip', 'Film one clip'), why: bi('vắng', 'quiet') }] },
  { weekday: 2, label: bi('Thứ 3', 'Tuesday'), jobs: [{ kind: 'post', text: bi('Đăng clip', 'Post the clip'), why: bi('khách quyết định tối', 'evening') }] },
  { weekday: 3, label: bi('Thứ 4', 'Wednesday'), jobs: [{ kind: 'rest', text: bi('Nghỉ', 'Rest'), why: '' }] },
], {});
const idOf = (di: number, ji: number) => base[di].jobs[ji].id!;

describe('shopPatchToDays', () => {
  it('returns null when the patch changes nothing', () => {
    expect(shopPatchToDays(base, {})).toBeNull();
    expect(shopPatchToDays(base, { jobs: [{ id: idOf(0, 0), text: 'Quay 1 clip' }] })).toBeNull();
  });

  it('rewords a job in place and keeps the rest addressed, so the sanitiser keeps their other language', () => {
    const raw = shopPatchToDays(base, { jobs: [{ id: idOf(0, 0), text: 'Quay 2 clip ngắn' }] })!;
    expect(raw[0].jobs[0]).toMatchObject({ from: '0:0', text: 'Quay 2 clip ngắn' });
    expect(raw[1].jobs[0]).toMatchObject({ from: '1:0', text: base[1].jobs[0].text, why: base[1].jobs[0].why });
    const days = sanitizeDays(raw, base, 'vi');
    expect(viOf(days[0].jobs[0].text)).toBe('Quay 2 clip ngắn');
    // The reasoning is untouched by a shop edit — it never came down, it never goes up.
    expect(viOf(days[1].jobs[0].why)).toBe('khách quyết định tối');
  });

  it('moves a job to another day, drops one, and adds one of the shop\'s own kinds', () => {
    const raw = shopPatchToDays(base, {
      jobs: [{ id: idOf(0, 0), dayIndex: 2 }, { id: idOf(1, 0), remove: true }],
      add: [{ dayIndex: 1, kind: 'photo', text: 'Chụp bộ móng cô dâu' }, { dayIndex: 1, kind: 'post', text: 'sneaky' }],
    })!;
    const days = sanitizeDays(raw, base, 'vi');
    expect(days[2].jobs.map((j) => j.kind)).toEqual(['film']);
    expect(days[1].jobs.map((j) => j.kind)).toEqual(['photo']); // 'post' is not a kind the shop adds
    expect(days[0].jobs.map((j) => j.kind)).toEqual(['rest']);   // emptied day becomes a rest marker
  });

  it('lets the shop rewrite the steps and nothing else on the sheet', () => {
    const raw = shopPatchToDays(base, { jobs: [{ id: idOf(0, 0), steps: ['Cận tay 3 giây', 'Xoay dưới đèn'] }] })!;
    expect(raw[0].jobs[0]).toMatchObject({ from: '0:0', brief: { steps: ['Cận tay 3 giây', 'Xoay dưới đèn'] } });
    expect(raw[0].jobs[0].text).toEqual(base[0].jobs[0].text); // the instruction itself is untouched
  });
});

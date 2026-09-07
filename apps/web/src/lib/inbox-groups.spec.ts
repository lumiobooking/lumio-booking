import { groupInbox, groupSummary, type InboxItem } from './inbox-groups';

const item = (o: Partial<InboxItem>): InboxItem => ({
  id: 'x', tenantId: 't1', salon: 'A-L Wellness', slug: 'al', title: 'Tiệm gửi ảnh/clip', note: null,
  fromShop: false, doneAt: '2026-09-07T10:00:00Z', files: 1, clips: 0, archived: 0, ...o,
});

describe('groupInbox', () => {
  it('folds many things from one salon into one line, newest headline on top', () => {
    const g = groupInbox([
      item({ id: 'a', doneAt: '2026-09-07T09:00:00Z', title: 'older', clips: 1 }),
      item({ id: 'b', doneAt: '2026-09-07T10:00:00Z', title: 'newer', fromShop: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].count).toBe(2);
    expect(g[0].headline).toBe('newer');
    expect(g[0].latest).toBe('2026-09-07T10:00:00Z');
    expect(g[0].clips).toBe(1);
    expect(g[0].fromShop).toBe(true);
  });

  it('puts salons with something untouched before salons where everything is in hand', () => {
    const g = groupInbox([
      item({ id: 'a', tenantId: 't1', salon: 'Busy', doneAt: '2026-09-07T12:00:00Z', working: true, workingByName: 'nam@lumio.vn' }),
      item({ id: 'b', tenantId: 't2', salon: 'Quiet', doneAt: '2026-09-07T08:00:00Z' }),
      item({ id: 'c', tenantId: 't3', salon: 'Fresh', doneAt: '2026-09-07T11:00:00Z' }),
    ]);
    expect(g.map((x) => x.salon)).toEqual(['Fresh', 'Quiet', 'Busy']);
    expect(g[2].workingBy).toEqual(['nam']);
  });

  it('summarises in the words the desk uses, skipping zeros', () => {
    const g = groupInbox([
      item({ id: 'a', clips: 1, files: 1 }),
      item({ id: 'b', files: 2, working: true, workingByName: 'Linh Tran' }),
    ])[0];
    expect(groupSummary(g)).toBe('1 mới · 1 đang làm (Linh) · 1 clip · 2 ảnh');
  });
});

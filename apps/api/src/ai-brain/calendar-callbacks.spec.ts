/**
 * "Khi AI hẹn nhân viên gọi lại thì hiển thị trên mục Calendar luôn để nhân
 * viên nhìn thấy và gọi lại" (2 Nov 2026): the open callbacks, for the desk,
 * on the Calendar — one salon's only.
 */
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AiBrainService } from './ai-brain.service';
import { CalendarCallbacksController } from './calendar-callbacks.controller';
import { capForApiPath } from '../support/support-scope';
import { CAPS_KEY } from '../auth/decorators/caps.decorator';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make() {
  const tasks: Row[] = [
    { id: 'c1', tenantId: 't1', channel: 'voice', reason: 'callback', summary: 'Caller: arms and legs · AI: a staff member will call Audacia back', phone: '+16042794119', name: 'Lisa', createdAt: new Date('2026-11-02T03:07:00Z'), dueAt: null, doneAt: null, customerId: 'cu1', sessionId: 's1' },
    { id: 'c2', tenantId: 't1', channel: 'voice', reason: 'silence', summary: '', phone: '+16042790000', name: null, createdAt: new Date('2026-11-02T03:16:00Z'), dueAt: null, doneAt: new Date(), customerId: null, sessionId: null },
    { id: 'z1', tenantId: 't2', channel: 'voice', reason: 'callback', summary: 'other salon', phone: '+1999', name: 'Zed', createdAt: new Date(), dueAt: null, doneAt: null },
  ];
  const seen: Row[] = [];
  const audits: Row[] = [];
  const match = (r: Row, w: Row) => Object.entries(w).every(([k, v]) => r[k] === v);
  const prisma = {
    aiCallbackTask: {
      findMany: async (a: Row) => { seen.push(a); return tasks.filter((t) => match(t, a.where)).map((t) => (a.select ? Object.fromEntries(Object.keys(a.select).map((k) => [k, t[k]])) : t)); },
      updateMany: async (a: Row) => { seen.push(a); let n = 0; for (const t of tasks) if (match(t, a.where)) { Object.assign(t, a.data); n++; } return { count: n }; },
    },
  };
  const svc = new AiBrainService(prisma as never, { log: async (a: Row) => { audits.push(a); } } as never);
  return { svc, tasks, seen, audits };
}
const desk = (tenantId: string) => ({ userId: `u-${tenantId}`, role: 'STAFF', tenantId }) as never;

describe('callbacks on the Calendar', () => {
  it('the desk sees the open ones of its own salon — oldest first, only what a call back needs', async () => {
    const { svc, seen } = make();
    const list = await svc.deskCallbacks(desk('t1'));
    expect(list.map((x: Row) => x.id)).toEqual(['c1']);
    expect(Object.keys(list[0]).sort()).toEqual(['channel', 'createdAt', 'dueAt', 'id', 'label', 'name', 'phone', 'reason', 'summary']);
    expect(seen[0].where).toEqual({ tenantId: 't1', doneAt: null });
    expect(seen[0].orderBy).toEqual({ createdAt: 'asc' });
  });

  it('"Đã gọi" closes it; another salon cannot close it', async () => {
    const { svc, tasks, audits } = make();
    await expect(svc.doneCallback(desk('t2'), 'c1')).rejects.toThrow(/not found/i);
    expect(tasks[0].doneAt).toBeNull();
    await svc.doneCallback(desk('t1'), 'c1');
    expect(tasks[0].doneAt).toBeInstanceOf(Date);
    expect(audits).toEqual([expect.objectContaining({ tenantId: 't1', userId: 'u-t1', action: 'ai_callback.done', resourceId: 'c1' })]);
  });

  it('is for whoever runs the calendar (not the AI page’s marketing right), and support sessions treat it as client data', () => {
    expect(Reflect.getMetadata(CAPS_KEY, CalendarCallbacksController)).toEqual(['calendar']);
    expect(capForApiPath('/api/calendar-callbacks')).toBe('calendar');
  });

  it('the push notification opens the Calendar with the list open, and the Calendar shows it', () => {
    const svcSrc = readFileSync(join(__dirname, 'ai-brain.service.ts'), 'utf8');
    expect(svcSrc).toMatch(/url: '\/salon\/calendar\?callbacks=1'/);
    const page = readFileSync(join(__dirname, '..', '..', '..', 'web', 'src', 'app', 'salon', 'calendar', 'page.tsx'), 'utf8');
    expect(page.match(/<CallbackStrip token=\{token\} vi=\{vi\} isMobile=\{isMobile\} \/>/g)).toHaveLength(2);
  });
});

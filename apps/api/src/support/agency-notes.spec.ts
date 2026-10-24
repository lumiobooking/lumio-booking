import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { addNote, cleanBody, deleteNote, listNotes, summariesFor, summarize, updateNote, NOTE_MAX, type NoteRow } from './agency-notes';

/** An in-memory agency_notes table — enough to see which salon a read or write lands on. */
function store(tenants = ['salon-a', 'salon-b']) {
  const rows: NoteRow[] = [];
  let seq = 0;
  let clock = Date.parse('2026-10-24T08:00:00Z');
  const match = (r: NoteRow, w: any) => Object.entries(w ?? {}).every(([k, v]: [string, any]) => {
    const val = (r as any)[k];
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(val);
    if (v && typeof v === 'object' && 'not' in v) return v.not === null ? val !== null : val !== v.not;
    return val === v;
  });
  const prisma = {
    tenant: { findFirst: jest.fn(async ({ where }: any) => (tenants.includes(where.id) ? { id: where.id } : null)) },
    user: { findUnique: jest.fn(async ({ where }: any) => (where.id === 'u-lan' ? { firstName: 'Lan', lastName: 'Ngô', email: 'lan@lumio.test' } : null)) },
    agencyNote: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where))),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        clock += 60_000;
        const r: NoteRow = { id: `n${++seq}`, doneAt: null, doneBy: null, pinned: false, authorId: null, authorName: null, ...data, createdAt: new Date(clock), updatedAt: new Date(clock) };
        rows.push(r); return r;
      }),
      update: jest.fn(async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; }),
      delete: jest.fn(async ({ where }: any) => { rows.splice(rows.findIndex((x) => x.id === where.id), 1); return {}; }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { prisma, rows };
}
const lan = { userId: 'u-lan', email: 'lan@lumio.test', role: 'SUPPORT' };
const minh = { userId: 'u-minh', email: 'minh@lumio.test', role: 'SUPPORT' };
const boss = { userId: 'u-boss', email: 'boss@lumio.test', role: 'SUPER_ADMIN' };

describe('agency notes', () => {
  it('tidies the words and refuses empty or too long', () => {
    expect(cleanBody('  gọi lại thứ 6 \n\n\n\n nhớ nha ')).toBe('gọi lại thứ 6\n\nnhớ nha');
    expect(cleanBody('   ')).toBeNull();
    expect(cleanBody(5)).toBeNull();
    expect(() => cleanBody('x'.repeat(NOTE_MAX + 1))).toThrow(BadRequestException);
  });

  it('adds a note on that salon only, names the writer, and audits it', async () => {
    const { prisma } = store();
    const n = await addNote(prisma as never, lan, 'salon-a', { body: 'Chủ tiệm hẹn gọi lại thứ 6', pinned: true });
    expect(n).toMatchObject({ body: 'Chủ tiệm hẹn gọi lại thứ 6', pinned: true, by: 'Lan Ngô', canEdit: true });
    expect((await listNotes(prisma as never, lan, 'salon-a')).open).toHaveLength(1);
    expect((await listNotes(prisma as never, lan, 'salon-b')).open).toHaveLength(0);
    expect((prisma.auditLog.create.mock.calls[0] as any)[0].data).toMatchObject({ tenantId: 'salon-a', action: 'support.note_added', resourceType: 'agency_note' });
  });

  it('falls back to the mail name when the account has no name', async () => {
    const { prisma } = store();
    expect((await addNote(prisma as never, minh, 'salon-a', { body: 'x' })).by).toBe('minh');
  });

  it('refuses an empty note and a salon that does not exist', async () => {
    const { prisma } = store();
    await expect(addNote(prisma as never, lan, 'salon-a', { body: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(addNote(prisma as never, lan, 'salon-x', { body: 'hi' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a note id of one salon cannot be read, changed or deleted through another salon', async () => {
    const { prisma, rows } = store();
    const n = await addNote(prisma as never, lan, 'salon-a', { body: 'riêng tiệm A' });
    await expect(updateNote(prisma as never, lan, 'salon-b', n.id, { pinned: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(updateNote(prisma as never, lan, 'salon-b', n.id, { done: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(deleteNote(prisma as never, lan, 'salon-b', n.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(rows[0]).toMatchObject({ tenantId: 'salon-a', pinned: false, doneAt: null });
  });

  it('anyone on the team pins and closes; only the writer (or super admin) edits and deletes', async () => {
    const { prisma, rows } = store();
    const n = await addNote(prisma as never, lan, 'salon-a', { body: 'Đừng đăng giá cũ' });
    expect((await updateNote(prisma as never, minh, 'salon-a', n.id, { pinned: true })).pinned).toBe(true);
    const done = await updateNote(prisma as never, minh, 'salon-a', n.id, { done: true });
    expect(done.doneAt).toBeInstanceOf(Date);
    expect(done.doneBy).toBe('minh');
    expect(done.canEdit).toBe(false);
    expect((await updateNote(prisma as never, minh, 'salon-a', n.id, { done: false })).doneAt).toBeNull();
    await expect(updateNote(prisma as never, minh, 'salon-a', n.id, { body: 'sửa lén' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(deleteNote(prisma as never, minh, 'salon-a', n.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await updateNote(prisma as never, lan, 'salon-a', n.id, { body: 'Đừng đăng giá cũ (bảng 2025)' })).body).toBe('Đừng đăng giá cũ (bảng 2025)');
    await deleteNote(prisma as never, boss, 'salon-a', n.id);
    expect(rows).toHaveLength(0);
  });

  it('refuses bad changes before touching anything', async () => {
    const { prisma } = store();
    const n = await addNote(prisma as never, lan, 'salon-a', { body: 'x' });
    await expect(updateNote(prisma as never, lan, 'salon-a', n.id, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(updateNote(prisma as never, lan, 'salon-a', n.id, { pinned: 'yes' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(updateNote(prisma as never, lan, 'salon-a', 'nope', { pinned: true })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists open notes pinned-first and done ones apart', async () => {
    const { prisma } = store();
    const a = await addNote(prisma as never, lan, 'salon-a', { body: 'cũ' });
    await addNote(prisma as never, lan, 'salon-a', { body: 'mới' });
    await addNote(prisma as never, lan, 'salon-a', { body: 'quan trọng', pinned: true });
    await updateNote(prisma as never, lan, 'salon-a', a.id, { done: true });
    const v = await listNotes(prisma as never, minh, 'salon-a');
    expect(v.done.map((x) => x.body)).toEqual(['cũ']);
    expect(v.open.map((x) => x.body).sort()).toEqual(['mới', 'quan trọng']);
  });

  it('the list summary: open count, pinned first, per salon, done ones left out', async () => {
    const t = (m: number) => new Date(Date.UTC(2026, 9, 24, 8, m));
    const map = summarize([
      { tenantId: 'salon-a', body: 'newest', pinned: false, authorName: 'Lan', createdAt: t(30), doneAt: null },
      { tenantId: 'salon-a', body: 'pinned older', pinned: true, authorName: 'Minh', createdAt: t(10), doneAt: null },
      { tenantId: 'salon-a', body: 'closed', pinned: true, authorName: 'Minh', createdAt: t(40), doneAt: t(41) },
      { tenantId: 'salon-b', body: 'x'.repeat(300), pinned: false, authorName: null, createdAt: t(5), doneAt: null },
    ]);
    expect(map.get('salon-a')).toMatchObject({ open: 2, pinned: 1, top: { body: 'pinned older', by: 'Minh', pinned: true } });
    expect(map.get('salon-b')!.top!.body.length).toBeLessThanOrEqual(160);
    expect(map.has('salon-c')).toBe(false);
  });

  it('summaries for the list come from one query and survive a failure', async () => {
    const { prisma } = store();
    await addNote(prisma as never, lan, 'salon-b', { body: 'chỉ tiệm B' });
    const m = await summariesFor(prisma as never, ['salon-a', 'salon-b']);
    expect(m.get('salon-b')?.open).toBe(1);
    expect(m.get('salon-a')).toBeUndefined();
    const broken = { agencyNote: { findMany: jest.fn(async () => { throw new Error('down'); }) } };
    expect((await summariesFor(broken as never, ['salon-a'])).size).toBe(0);
  });
});

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * The team's notes on a salon — reminders Lumio staff leave for each other on
 * the agency list ("chủ tiệm hẹn gọi lại thứ 6", "đừng đăng giá cũ").
 *
 * Internal to Lumio: only SUPPORT / SUPER_ADMIN routes read or write them, and
 * no salon-facing endpoint selects the table. Every read and write names the
 * salon (tenantId) AND the note, so a note id from one salon can never touch
 * another salon's note.
 *
 * Who may do what:
 *  - anyone on the team: add, pin / unpin, mark done / reopen;
 *  - the author or a SUPER_ADMIN: change the words, delete.
 */

export const NOTE_MAX = 1000;
const LIST_DONE = 20;

type Actor = { userId?: string | null; email?: string | null; role?: string | null };

export interface NoteRow {
  id: string; tenantId: string; body: string; pinned: boolean;
  authorId: string | null; authorName: string | null;
  doneAt: Date | null; doneBy: string | null; createdAt: Date; updatedAt: Date;
}

/** What the list row shows: how many are open, and the one to read first. */
export interface NotesSummary {
  open: number;
  pinned: number;
  top: { body: string; by: string | null; at: Date; pinned: boolean } | null;
}

export interface NoteView {
  id: string; body: string; pinned: boolean; by: string | null; at: Date; editedAt: Date | null;
  doneAt: Date | null; doneBy: string | null; canEdit: boolean;
}

interface NoteStore {
  tenant: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
  agencyNote: {
    findMany: (a: unknown) => Promise<NoteRow[]>;
    findFirst: (a: unknown) => Promise<NoteRow | null>;
    create: (a: unknown) => Promise<NoteRow>;
    update: (a: unknown) => Promise<NoteRow>;
    delete: (a: unknown) => Promise<unknown>;
  };
  user?: { findUnique: (a: unknown) => Promise<{ firstName: string | null; lastName: string | null; email: string } | null> };
  auditLog: { create: (a: unknown) => Promise<unknown> };
}

/** The words, tidied: trimmed, no runs of blank lines. Empty → null. Too long → refused. */
export function cleanBody(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return null;
  if (s.length > NOTE_MAX) throw new BadRequestException(`Ghi chú tối đa ${NOTE_MAX} ký tự`);
  return s;
}

/** Pinned first, then newest. */
export function noteOrder<T extends { pinned: boolean; createdAt: Date }>(a: T, b: T): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

/** One summary per salon from its OPEN notes. Salons with none are absent. */
export function summarize(rows: Pick<NoteRow, 'tenantId' | 'body' | 'pinned' | 'authorName' | 'createdAt' | 'doneAt'>[]): Map<string, NotesSummary> {
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.doneAt) continue;
    by.set(r.tenantId, [...(by.get(r.tenantId) ?? []), r]);
  }
  const out = new Map<string, NotesSummary>();
  for (const [tenantId, list] of by) {
    const sorted = [...list].sort(noteOrder);
    const t = sorted[0];
    out.set(tenantId, {
      open: list.length,
      pinned: list.filter((x) => x.pinned).length,
      top: { body: t.body.length > 160 ? `${t.body.slice(0, 157)}…` : t.body, by: t.authorName, at: t.createdAt, pinned: t.pinned },
    });
  }
  return out;
}

const isBoss = (u: Actor) => u.role === 'SUPER_ADMIN';
const canEdit = (u: Actor, n: Pick<NoteRow, 'authorId'>) => isBoss(u) || (!!u.userId && n.authorId === u.userId);

export function viewOf(u: Actor, n: NoteRow): NoteView {
  return {
    id: n.id, body: n.body, pinned: n.pinned, by: n.authorName, at: n.createdAt,
    editedAt: n.updatedAt.getTime() - n.createdAt.getTime() > 60_000 ? n.updatedAt : null,
    doneAt: n.doneAt, doneBy: n.doneBy, canEdit: canEdit(u, n),
  };
}

async function mustExist(prisma: NoteStore, tenantId: string) {
  const t = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } }).catch(() => null);
  if (!t) throw new NotFoundException('Salon not found');
}

/** The note — of THIS salon. Another salon's note id reads as not found. */
async function noteOf(prisma: NoteStore, tenantId: string, noteId: string): Promise<NoteRow> {
  if (typeof noteId !== 'string' || !noteId) throw new NotFoundException('Note not found');
  const n = await prisma.agencyNote.findFirst({ where: { id: noteId, tenantId } });
  if (!n) throw new NotFoundException('Note not found');
  return n;
}

async function nameOf(prisma: NoteStore, u: Actor): Promise<string | null> {
  const row = u.userId && prisma.user
    ? await prisma.user.findUnique({ where: { id: u.userId }, select: { firstName: true, lastName: true, email: true } }).catch(() => null)
    : null;
  const full = [row?.firstName, row?.lastName].filter((x) => x && x.trim()).join(' ').trim();
  if (full) return full.slice(0, 80);
  const mail = row?.email ?? u.email ?? null;
  return mail ? mail.split('@')[0].slice(0, 80) : null;
}

async function audit(prisma: NoteStore, u: Actor, tenantId: string, action: string, noteId: string, meta: Record<string, unknown> = {}) {
  await prisma.auditLog.create({
    data: { tenantId, userId: u.userId ?? null, action, resourceType: 'agency_note', resourceId: noteId, metadata: { by: u.email ?? null, ...meta } },
  }).catch(() => undefined);
}

/** Open notes (pinned first, newest next) and the last few done ones. */
export async function listNotes(prisma: NoteStore, u: Actor, tenantId: string): Promise<{ open: NoteView[]; done: NoteView[] }> {
  await mustExist(prisma, tenantId);
  const [open, done] = await Promise.all([
    prisma.agencyNote.findMany({ where: { tenantId, doneAt: null }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 200 }),
    prisma.agencyNote.findMany({ where: { tenantId, doneAt: { not: null } }, orderBy: { doneAt: 'desc' }, take: LIST_DONE }),
  ]);
  return { open: open.map((n) => viewOf(u, n)), done: done.map((n) => viewOf(u, n)) };
}

export async function addNote(prisma: NoteStore, u: Actor, tenantId: string, dto: { body?: unknown; pinned?: unknown } | null | undefined): Promise<NoteView> {
  const body = cleanBody(dto?.body);
  if (!body) throw new BadRequestException('Ghi chú đang trống');
  await mustExist(prisma, tenantId);
  const n = await prisma.agencyNote.create({
    data: { tenantId, body, pinned: dto?.pinned === true, authorId: u.userId ?? null, authorName: await nameOf(prisma, u) },
  });
  await audit(prisma, u, tenantId, 'support.note_added', n.id, { pinned: n.pinned, preview: body.slice(0, 80) });
  return viewOf(u, n);
}

/** {pinned?, done?, body?} — pin and done for anyone on the team; the words for the author. */
export async function updateNote(
  prisma: NoteStore, u: Actor, tenantId: string, noteId: string,
  dto: { body?: unknown; pinned?: unknown; done?: unknown } | null | undefined,
): Promise<NoteView> {
  const d = dto ?? {};
  const data: Record<string, unknown> = {};
  if (d.pinned !== undefined) {
    if (typeof d.pinned !== 'boolean') throw new BadRequestException('pinned phải là true | false');
    data.pinned = d.pinned;
  }
  if (d.done !== undefined) {
    if (typeof d.done !== 'boolean') throw new BadRequestException('done phải là true | false');
    data.doneAt = d.done ? new Date() : null;
    data.doneBy = d.done ? await nameOf(prisma, u) : null;
  }
  if (d.body !== undefined) {
    const body = cleanBody(d.body);
    if (!body) throw new BadRequestException('Ghi chú đang trống');
    data.body = body;
  }
  if (!Object.keys(data).length) throw new BadRequestException('Không có gì để đổi');
  await mustExist(prisma, tenantId);
  const n = await noteOf(prisma, tenantId, noteId);
  if (data.body !== undefined && !canEdit(u, n)) throw new ForbiddenException('Chỉ người viết mới sửa được nội dung ghi chú');
  const next = await prisma.agencyNote.update({ where: { id: n.id }, data });
  const action = data.body !== undefined ? 'support.note_edited' : d.done !== undefined ? (d.done ? 'support.note_done' : 'support.note_reopened') : d.pinned ? 'support.note_pinned' : 'support.note_unpinned';
  await audit(prisma, u, tenantId, action, n.id);
  return viewOf(u, next);
}

export async function deleteNote(prisma: NoteStore, u: Actor, tenantId: string, noteId: string): Promise<{ ok: true }> {
  await mustExist(prisma, tenantId);
  const n = await noteOf(prisma, tenantId, noteId);
  if (!canEdit(u, n)) throw new ForbiddenException('Chỉ người viết mới xoá được ghi chú');
  await prisma.agencyNote.delete({ where: { id: n.id } });
  await audit(prisma, u, tenantId, 'support.note_deleted', n.id, { preview: n.body.slice(0, 80) });
  return { ok: true };
}

/** The list rows' summaries in one query; a failure leaves every row without notes. */
export async function summariesFor(prisma: Pick<NoteStore, 'agencyNote'>, tenantIds: string[]): Promise<Map<string, NotesSummary>> {
  if (!tenantIds.length || !prisma.agencyNote) return new Map();
  const rows = await prisma.agencyNote.findMany({
    where: { tenantId: { in: tenantIds }, doneAt: null },
    select: { tenantId: true, body: true, pinned: true, authorName: true, createdAt: true, doneAt: true },
    take: 10000,
  }).catch(() => [] as NoteRow[]);
  return summarize(rows);
}

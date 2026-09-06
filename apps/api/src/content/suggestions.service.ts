import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { GoogleDriveService } from '../uploads/google-drive.service';
import { UploadsService } from '../uploads/uploads.service';
import { storagePathOf } from './media-retention';
import { SHOP, clientSuggestion, mediaOf, needsTeam, safeLink, suggestionStatus, type MediaRef, type SuggestionRow } from './client-view';

/**
 * One trend, picked by a person, handed to one salon.
 *
 * WHY THIS EXISTS RATHER THAN JUST SHOWING THE SALON THE TREND BOARD
 *
 * The trend board is the method: which hashtag feeds get read, which product
 * rankings, in what order. Handing a salon the board hands it to whoever the
 * owner shares their password with, and the agency's only durable advantage is
 * gone. So the board stays on the team's side and a staff member carries ONE
 * thing across: "film this, this week". The salon gets an instruction it can
 * act on and nothing it could hand to a competitor.
 *
 * WHY IT CLOSES THE LOOP
 *
 * The suggestion is not a message; it is a small piece of work with a state.
 * The salon films it and sends the file back on the same card, which is the
 * whole point — the material arrives attached to the thing that asked for it,
 * rather than as an unlabelled video in a group chat at eleven at night.
 */
@Injectable()
export class SuggestionsService {
  private readonly log = new Logger(SuggestionsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveService,
    private readonly uploads: UploadsService,
  ) {}

  /** Loose access: the model exists on the deploy, not in the local client. */
  private get table() {
    return (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      findFirst: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
    }>).contentSuggestion;
  }

  private tenantId(user: AuthenticatedUser): string {
    const id = user?.tenantId;
    if (!id) throw new BadRequestException('Thiếu tenant.');
    return id;
  }

  private isTeam(user: AuthenticatedUser): boolean {
    return user.role === UserRole.SUPER_ADMIN || Boolean(user.supportSession);
  }

  /**
   * The team hands one over.
   *
   * Team-side only. A salon that could write its own suggestions would be
   * writing into the queue its own staff are measured by, and the point of the
   * card is that somebody at Lumio chose it.
   */
  async create(user: AuthenticatedUser, dto: {
    title?: string; note?: string;
    refUrl?: string; refThumbUrl?: string;
    refCount?: unknown; refCountKind?: unknown; refPublishedAt?: unknown;
    sourceUrl?: string; sourceLabel?: string;
  }) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio gửi đề xuất cho tiệm.');
    const tenantId = this.tenantId(user);
    const title = String(dto?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) throw new BadRequestException('Đề xuất chưa có nội dung.');
    const row = await this.table?.create({
      data: {
        tenantId,
        title,
        note: String(dto?.note ?? '').trim().slice(0, 1000) || null,
        // The brief: one clip the staff member wants the shop to look at. Sent
        // only when they ticked the box, because whether a reference is safe to
        // hand over is a judgement per card, not a blanket rule.
        refUrl: safeLink(dto?.refUrl),
        refThumbUrl: safeLink(dto?.refThumbUrl),
        // The reference's public numbers, so the shop can weigh the brief.
        // Only with a reference: a number without the clip is a rumour.
        refCount: safeLink(dto?.refUrl) && Number.isFinite(Number(dto?.refCount)) && Number(dto?.refCount) >= 0 ? Math.round(Number(dto?.refCount)) : null,
        refCountKind: safeLink(dto?.refUrl) && (dto?.refCountKind === 'views' || dto?.refCountKind === 'likes') ? dto.refCountKind : null,
        refPublishedAt: safeLink(dto?.refUrl) && dto?.refPublishedAt && !Number.isNaN(Date.parse(String(dto.refPublishedAt))) ? new Date(String(dto.refPublishedAt)) : null,
        // Kept for the team's own reading, never rendered on the salon's side.
        sourceUrl: String(dto?.sourceUrl ?? '').trim().slice(0, 500) || null,
        sourceLabel: String(dto?.sourceLabel ?? '').trim().slice(0, 120) || null,
        createdByName: user.email ?? 'Lumio',
        status: 'sent',
      },
    }).catch(() => null) as SuggestionRow | null;
    if (!row) throw new BadRequestException('Chưa gửi được, thử lại giúp em.');
    return { ok: true, id: row.id };
  }

  /**
   * The team's view — and the half of the loop that was missing.
   *
   * A staff member sent a suggestion, the shop filmed it and pressed send, and
   * the files landed in a column nobody looked at. So this leads with the cards
   * WAITING ON THE TEAM: the shop has done its part and somebody has to turn
   * the footage into a post. Everything else is history, and history is
   * capped — an inbox that only grows is one nobody reads by the third week.
   */
  async listForTeam(user: AuthenticatedUser) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio xem được mục này.');
    const rows = await this.rows(this.tenantId(user));
    const shape = (r: SuggestionRow) => ({
      id: r.id,
      title: r.title,
      note: r.note,
      // The team DOES see where it came from — this is their own working note.
      refUrl: safeLink(r.refUrl),
      refThumbUrl: safeLink(r.refThumbUrl),
      refCount: r.refCount ?? null,
      refCountKind: r.refCountKind ?? null,
      sourceUrl: r.sourceUrl,
      sourceLabel: r.sourceLabel,
      createdByName: r.createdByName,
      /** The shop opened this card itself — nobody at Lumio asked for it. */
      fromShop: r.createdByName === SHOP,
      createdAt: r.createdAt,
      status: suggestionStatus(r.status),
      doneAt: r.doneAt,
      media: mediaOf(r.media),
      usedNote: r.usedNote ?? null,
      usedAt: r.usedAt ?? null,
      usedByName: r.usedByName ?? null,
      workingAt: r.workingAt ?? null,
      workingByName: r.workingByName ?? null,
    });
    const ready = rows.filter((r) => suggestionStatus(r.status) === 'done');
    const working = rows.filter((r) => suggestionStatus(r.status) === 'working');
    return {
      /** This salon's folder in the Drive archive, once anything has landed there. */
      driveFolderUrl: await this.drive.folderLink(this.tenantId(user)).catch(() => null),
      /** RECEIVED: the shop sent files and nobody has picked them up. */
      ready: ready.map(shape),
      /** IN PROGRESS: somebody is editing the raw material. */
      working: working.map(shape),
      /** Sent, still waiting on the shop. */
      waitingOnShop: rows.filter((r) => suggestionStatus(r.status) === 'sent').map(shape),
      recent: rows.filter((r) => !needsTeam(r.status) && suggestionStatus(r.status) !== 'sent').slice(0, 60).map(shape),
      readyCount: ready.length + working.length,
      newCount: ready.length,
    };
  }

  /**
   * "I'll take this one." Moves a received card to WORKING under this staff
   * member's name, so the next person to open the inbox sees it is claimed.
   * Reversible with `release`.
   */
  async claim(user: AuthenticatedUser, id: string) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio nhận việc.');
    const tenantId = this.tenantId(user);
    const r = await (this.prisma as unknown as Record<string, { updateMany: (a: unknown) => Promise<{ count: number }> }>)
      .contentSuggestion?.updateMany({
        where: { id, tenantId, status: { in: ['done', 'working'] } },
        data: { status: 'working', workingAt: new Date(), workingByName: user.email ?? 'Lumio' },
      }).catch(() => ({ count: 0 }));
    if (!r || r.count === 0) throw new NotFoundException('Không tìm thấy hoặc thẻ này đã xong.');
    return { ok: true, id };
  }

  /** Back to RECEIVED — picked up by mistake, or handing it to somebody else. */
  async release(user: AuthenticatedUser, id: string) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio.');
    const tenantId = this.tenantId(user);
    const r = await (this.prisma as unknown as Record<string, { updateMany: (a: unknown) => Promise<{ count: number }> }>)
      .contentSuggestion?.updateMany({
        where: { id, tenantId, status: 'working' },
        data: { status: 'done', workingAt: null, workingByName: null },
      }).catch(() => ({ count: 0 }));
    if (!r || r.count === 0) throw new NotFoundException('Thẻ này không ở trạng thái đang làm.');
    return { ok: true, id };
  }

  /**
   * Take back something the team sent and the shop has not answered — the
   * idea was wrong, or it was sent to the wrong salon. Only a card the shop
   * has NOT acted on: once files have arrived the card is the shop's work,
   * and it is put away with a note, never deleted.
   */
  async withdraw(user: AuthenticatedUser, id: string) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio thu hồi được.');
    const tenantId = this.tenantId(user);
    const r = await (this.prisma as unknown as Record<string, { deleteMany: (a: unknown) => Promise<{ count: number }> }>)
      .contentSuggestion?.deleteMany({ where: { id, tenantId, status: { in: ['sent', 'skipped'] } } })
      .catch(() => ({ count: 0 }));
    if (!r || r.count === 0) throw new NotFoundException('Chỉ thu hồi được đề xuất tiệm chưa trả lời.');
    await this.prisma.auditLog.create({
      data: { tenantId, userId: user.userId ?? null, action: 'content.suggestion_withdrawn', resourceType: 'content_suggestion', resourceId: id } as never,
    }).catch(() => undefined);
    return { ok: true, id };
  }

  /**
   * The footage became a post; take the card out of the team's inbox.
   *
   * Team side only, and separate from the shop's `done`: the shop pressing send
   * and the team getting round to it are two different events, and collapsing
   * them is how an inbox stops meaning anything.
   */
  async markUsed(user: AuthenticatedUser, id: string, note?: unknown) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio đánh dấu được.');
    const tenantId = this.tenantId(user);
    const usedNote = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    const r = await (this.prisma as unknown as Record<string, {
      updateMany: (a: unknown) => Promise<{ count: number }>;
    }>).contentSuggestion?.updateMany({
      where: { id, tenantId, status: { in: ['done', 'working'] } },
      data: { status: 'used', usedNote, usedAt: new Date(), usedByName: user.email ?? 'Lumio' },
    }).catch(() => ({ count: 0 }));
    if (!r || r.count === 0) throw new NotFoundException('Không tìm thấy đề xuất này.');
    return { ok: true, id };
  }

  /**
   * The salon's view: rebuilt by `clientSuggestion`, never filtered.
   *
   * Open sent ones first, then the recent history, so the card at the top is
   * always the one waiting on the shop.
   */
  async listForSalon(user: AuthenticatedUser) {
    const rows = await this.rows(this.tenantId(user));
    const open = rows.filter((r) => suggestionStatus(r.status) === 'sent');
    const past = rows.filter((r) => suggestionStatus(r.status) !== 'sent').slice(0, 6);
    return {
      open: open.map(clientSuggestion),
      past: past.map(clientSuggestion),
      waiting: open.length,
    };
  }

  /**
   * Is anybody actually running this salon's marketing?
   *
   * The client screen ships open for every salon (see feature-policy), which is
   * only defensible because it is empty until the agency puts something on it.
   * The week plan is the exception: it is generated for every tenant whether or
   * not anyone is working on it, so showing it unconditionally would hand
   * marketing homework to a shop that bought a booking system and nothing else.
   *
   * Evidence, not a setting: one suggestion sent, or one post scheduled. Both
   * are things only the team creates, so the answer is true exactly when
   * somebody is doing the work.
   */
  async hasAgencyWork(user: AuthenticatedUser): Promise<boolean> {
    const tenantId = this.tenantId(user);
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
    }>;
    const [sug, post] = await Promise.all([
      loose.contentSuggestion?.findFirst({ where: { tenantId, NOT: { createdByName: SHOP } }, select: { id: true } }).catch(() => null),
      loose.scheduledPost?.findFirst({ where: { tenantId }, select: { id: true } }).catch(() => null),
    ]);
    return Boolean(sug || post);
  }

  private async rows(tenantId: string): Promise<SuggestionRow[]> {
    return (await this.table?.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }).catch(() => [])) as SuggestionRow[] ?? [];
  }

  /**
   * The salon says it filmed the thing, and sends what it filmed.
   *
   * Either side may mark it done: the shop when it uploads, the team when the
   * shop sent the file some other way. What must not happen is a card that
   * sits open because the only person who can close it is the one who has
   * already moved on.
   */
  async markDone(user: AuthenticatedUser, id: string, media: unknown) {
    const tenantId = this.tenantId(user);
    const row = await this.table?.findFirst({ where: { id, tenantId }, select: { id: true, media: true } })
      .catch(() => null) as { id: string; media: unknown } | null;
    if (!row) throw new NotFoundException('Không tìm thấy đề xuất này.');
    // Files ADD to whatever is already there: a shop that sends one clip now
    // and two photos this afternoon has sent three files, not two.
    const merged = [...mediaOf(row.media), ...mediaOf(media)].slice(0, 12);
    await this.table?.update({
      where: { id: row.id },
      data: { status: 'done', doneAt: new Date(), media: merged as never, skipReason: null },
    }).catch(() => undefined);
    // The archive copy happens AFTER the shop has its answer. A person on phone
    // data has already waited for one upload; they do not wait for Google too.
    void this.mirror(row.id).catch((e) => this.log.warn(`drive mirror ${row.id}: ${e instanceof Error ? e.message : e}`));
    return { ok: true, id: row.id, media: merged };
  }

  /**
   * The shop sends something nobody asked for.
   *
   * A set of nails worth showing gets done at 4pm on a Tuesday with no card
   * waiting for it. Without this door the photo goes to a group chat, or
   * nowhere. So the shop can send files any time, with a line saying what they
   * are; it lands in the same inbox, the same Drive folder, the same way — a
   * card the shop itself opened and closed in one move.
   *
   * Marked `createdByName: SHOP` so it never counts as the agency having
   * started work on this salon (see `hasAgencyWork`).
   */
  async sendFromShop(user: AuthenticatedUser, dto: { note?: unknown; media?: unknown }) {
    const tenantId = this.tenantId(user);
    const media = mediaOf(dto?.media).slice(0, 12);
    if (!media.length) throw new BadRequestException('Chưa có ảnh hay clip nào.');
    const note = String(dto?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    const row = await this.table?.create({
      data: {
        tenantId,
        title: note.slice(0, 120) || 'Tiệm gửi ảnh/clip',
        note: note.length > 120 ? note : null,
        createdByName: SHOP,
        status: 'done',
        doneAt: new Date(),
        media: media as never,
      },
    }).catch(() => null) as SuggestionRow | null;
    if (!row) throw new BadRequestException('Chưa gửi được, thử lại giúp em.');
    void this.mirror(row.id).catch((e) => this.log.warn(`drive mirror ${row.id}: ${e instanceof Error ? e.message : e}`));
    return { ok: true, id: row.id };
  }

  // ---- the Drive archive -------------------------------------------------------

  /**
   * Copy this suggestion's files into the salon's Drive folder.
   *
   * Idempotent: only entries without a `driveUrl` are copied, and the row is
   * re-read first so two overlapping runs cannot both copy the same clip.
   * Anything that fails stays without a link and is picked up by `sweep`.
   */
  async mirror(id: string): Promise<number> {
    if (!(await this.drive.configured())) return 0;
    const row = await this.table?.findFirst({
      where: { id },
      select: { id: true, tenantId: true, title: true, doneAt: true, createdAt: true, media: true },
    }).catch(() => null) as { id: string; tenantId: string; title: string; doneAt: Date | null; createdAt: Date; media: unknown } | null;
    if (!row) return 0;
    const media = mediaOf(row.media);
    // Drive-first uploads are already there; only legacy FTP entries need a copy.
    const todo = media.filter((m) => !m.driveUrl && !m.driveFileId);
    if (!todo.length) return 0;

    const day = new Date(row.doneAt ?? row.createdAt).toISOString().slice(0, 10);
    const slug = row.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';
    let copied = 0;
    for (const m of todo) {
      const ext = (/\.([a-z0-9]{2,4})(?:\?|#|$)/i.exec(m.url)?.[1] ?? (m.kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
      const n = media.indexOf(m) + 1;
      try {
        const out = await this.drive.mirrorFromUrl(row.tenantId, m.url, `${day}_${slug}_${n}.${ext}`);
        if (out) { m.driveUrl = out.url; copied += 1; }
      } catch (e) {
        this.log.warn(`drive copy failed for ${row.id} #${n}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (copied) {
      await this.table?.update({ where: { id: row.id }, data: { media: media as never } }).catch(() => undefined);
    }
    return copied;
  }

  /**
   * Retry the copies that did not happen — Drive was down, the token was stale,
   * the process restarted mid-upload. Recent rows only, a few at a time; a
   * sweep that tries to catch up on a year in one go is a sweep that times out.
   */
  async sweep(limit = 5): Promise<number> {
    if (!(await this.drive.configured())) return 0;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.table?.findMany({
      where: { status: { in: ['done', 'working', 'used'] }, doneAt: { gte: since } },
      orderBy: { doneAt: 'desc' },
      take: 60,
      select: { id: true, media: true },
    }).catch(() => []) as { id: string; media: unknown }[];
    const pending = rows.filter((r) => mediaOf(r.media).some((m) => !m.driveUrl && !m.driveFileId)).slice(0, limit);
    let total = 0;
    for (const r of pending) total += await this.mirror(r.id).catch(() => 0);
    await this.sweepStaged().catch((e) => this.log.warn(`staged sweep: ${e instanceof Error ? e.message : e}`));
    return total;
  }

  // ---- the hosting holds only what a post is about to fetch --------------------

  /**
   * Put a copy of this card's files on the hosting, so a post can be built
   * from public addresses. Drive is the file of record; the hosting is a
   * loading dock, and the copies are swept a month later (`sweepStaged`).
   * Idempotent: a file already staged keeps its address.
   */
  async stage(user: AuthenticatedUser, id: string): Promise<{ media: MediaRef[] }> {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio dựng bài.');
    const tenantId = this.tenantId(user);
    const row = await this.table?.findFirst({ where: { id, tenantId }, select: { id: true, media: true } })
      .catch(() => null) as { id: string; media: unknown } | null;
    if (!row) throw new NotFoundException('Không tìm thấy đề xuất này.');
    const media = mediaOf(row.media);
    let changed = false;
    for (const m of media) {
      if (m.publicUrl) continue;
      if (!m.driveFileId) { m.publicUrl = m.url; continue; } // legacy: the FTP address is the public one
      try {
        const { bytes, mime } = await this.drive.download(m.driveFileId);
        const out = await this.uploads.uploadFile(tenantId, { buffer: bytes, mimetype: mime || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg') });
        m.publicUrl = out.url;
        m.stagedAt = new Date().toISOString();
        changed = true;
      } catch (e) {
        this.log.warn(`stage ${row.id}: ${e instanceof Error ? e.message : e}`);
        throw new BadRequestException(`Chưa chép được file sang kho đăng bài: ${e instanceof Error ? e.message : 'lỗi'}`);
      }
    }
    if (changed) await this.table?.update({ where: { id: row.id }, data: { media: media as never } }).catch(() => undefined);
    return { media };
  }

  /**
   * Remove staged copies older than a month from the hosting. The posts made
   * from them fetched the file on the day; the archive is on Drive. Legacy
   * entries (FTP was the file of record) are left alone — deleting those
   * would delete the only copy.
   */
  async sweepStaged(limit = 20): Promise<number> {
    const publicBase = await this.uploads.publicBase();
    if (!publicBase) return 0;
    const cutoff = Date.now() - 30 * 86_400_000;
    const rows = await this.table?.findMany({
      where: { status: { in: ['done', 'working', 'used', 'skipped'] } },
      orderBy: { doneAt: 'desc' },
      take: 200,
      select: { id: true, media: true },
    }).catch(() => []) as { id: string; media: unknown }[];
    let removed = 0;
    for (const r of rows) {
      const media = mediaOf(r.media);
      const stale = media.filter((m) => m.driveFileId && m.publicUrl && m.stagedAt && Date.parse(m.stagedAt) < cutoff);
      if (!stale.length) continue;
      const paths = stale.map((m) => storagePathOf(m.publicUrl!, publicBase)).filter((p): p is string => Boolean(p));
      if (paths.length) await this.uploads.deletePaths(paths).catch(() => undefined);
      for (const m of stale) { delete m.publicUrl; delete m.stagedAt; }
      await this.table?.update({ where: { id: r.id }, data: { media: media as never } }).catch(() => undefined);
      removed += stale.length;
      if (removed >= limit) break;
    }
    return removed;
  }

  /** The salon says it does not fit. The reason is the useful half. */
  async skip(user: AuthenticatedUser, id: string, reason: unknown) {
    const tenantId = this.tenantId(user);
    const row = await this.table?.findFirst({ where: { id, tenantId }, select: { id: true } })
      .catch(() => null) as { id: string } | null;
    if (!row) throw new NotFoundException('Không tìm thấy đề xuất này.');
    await this.table?.update({
      where: { id: row.id },
      data: { status: 'skipped', skipReason: String(reason ?? '').trim().slice(0, 500) || null, doneAt: null },
    }).catch(() => undefined);
    return { ok: true, id: row.id };
  }

  /**
   * Put a closed card back in front of the shop. Team side only.
   *
   * `updateMany` with the tenant in the WHERE, not `update` by id: an id alone
   * selecting a row is the shape every cross-tenant bug in this codebase has
   * had, and it is worth the extra word every time.
   */
  async reopen(user: AuthenticatedUser, id: string) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio mở lại được.');
    const tenantId = this.tenantId(user);
    const r = await (this.prisma as unknown as Record<string, {
      updateMany: (a: unknown) => Promise<{ count: number }>;
    }>).contentSuggestion?.updateMany({
      where: { id, tenantId },
      data: { status: 'sent', doneAt: null, skipReason: null },
    }).catch(() => ({ count: 0 }));
    if (!r || r.count === 0) throw new NotFoundException('Không tìm thấy đề xuất này.');
    return { ok: true, id };
  }
}

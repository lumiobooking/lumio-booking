import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrintJobStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { cleanSettings, SETTINGS_KEY } from '../restaurant/check-logic';
import { AGENT_VERSION, agentScript, goneScript, installScript } from './agent-scripts';
import {
  asciiJson, CODE_MINUTES, cleanCode, cleanKey, cleanName, cleanPrinters, cleanRoutes, columnsOf, drawerRoute, escposBytes, makeCode, makeToken, printableWidth,
  publicApiBase, ROUTE_ANY, routeFor, runLine, sha, styleRows, testTicket, tokenShapeOk,
} from './print-devices.logic';

const ONLINE_MS = 45_000;
/** A job older than this is not printed by a computer that comes online later (yesterday's kitchen tickets). */
const FRESH_MS = 60 * 60_000;
/** A job a computer took but never reported is offered again after this. */
const RECLAIM_MS = 2 * 60_000;

type DeviceRow = {
  id: string; tenantId: string; name: string; printers: unknown; defaultPrinter: string | null; routes: unknown;
  agentVersion: string | null; lastSeenAt: Date | null; pairedAt: Date | null; pairExpiresAt: Date | null; createdAt: Date;
};

/**
 * The shop's printing computers (one-touch setup). Owner side: add a computer
 * (a one-time setup line), pick which printer prints what, test, remove.
 * Device side (no login, the device token): pair, report printers, take jobs,
 * report results. Every query is scoped by the tenant the token or the
 * owner's session belongs to.
 */
@Injectable()
export class PrintDevicesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Each computer asks every few seconds. Who it is (token → device, business
   * active) is remembered for a short while so a quiet poll costs two small
   * reads, not four. Removing a computer forgets it at once.
   */
  private readonly known = new Map<string, { at: number; device: DeviceRow }>();

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('NO_TENANT');
    return id;
  }

  // ------------------------------------------------------------ owner side --

  /** The computers, what each can print to, and the kinds of tickets this business prints. */
  async list(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    const now = Date.now();
    const [rows, setting, pending, tenant] = await Promise.all([
      this.prisma.printDevice.findMany({ where: { tenantId, revokedAt: null }, orderBy: { createdAt: 'asc' } }) as Promise<DeviceRow[]>,
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: SETTINGS_KEY } } }).catch(() => null),
      this.prisma.printJob.count({ where: { tenantId, status: PrintJobStatus.PENDING, createdAt: { gte: new Date(now - FRESH_MS) } } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { businessType: true } }).catch(() => null),
    ]);
    const stations = [{ key: 'COUNTER', name: 'COUNTER' }];
    // A restaurant's prep stations (Kitchen, Bar… — the defaults until the owner changes them): each can have its own printer.
    if (setting || String((tenant as { businessType?: string } | null)?.businessType ?? '') === 'RESTAURANT') {
      for (const s of cleanSettings(setting?.value ?? {}).stations) stations.push({ key: s.key, name: s.name });
    }
    return {
      version: AGENT_VERSION,
      pendingJobs: pending,
      stations,
      devices: rows
        .filter((d) => d.pairedAt || (d.pairExpiresAt && d.pairExpiresAt.getTime() > now))
        .map((d) => ({
          id: d.id,
          name: d.name,
          paired: !!d.pairedAt,
          pairExpiresAt: d.pairedAt ? null : d.pairExpiresAt,
          online: !!d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_MS,
          lastSeenAt: d.lastSeenAt,
          printers: cleanPrinters(d.printers),
          defaultPrinter: d.defaultPrinter,
          routes: cleanRoutes(d.routes),
          upToDate: d.agentVersion === AGENT_VERSION,
        })),
    };
  }

  /**
   * A one-time setup line for a new computer (30 minutes, single use). Only
   * one waiting code per business: a new one retires the old.
   */
  async installer(user: AuthenticatedUser, headers: Record<string, unknown>) {
    const tenantId = this.tid(user);
    await this.prisma.printDevice.deleteMany({ where: { tenantId, pairedAt: null } });
    const code = makeCode();
    const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);
    const row = await this.prisma.printDevice.create({
      data: { tenantId, name: '', pairHash: sha(code), pairExpiresAt: expiresAt, routes: {}, printers: [], createdById: user.userId },
      select: { id: true },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'print.installer_created', resourceType: 'print_device', resourceId: row.id });
    const url = `${publicApiBase(headers)}/print-agent/i/${code}`;
    return { id: row.id, code, expiresAt, url, runLine: runLine(url) };
  }

  private async own(tenantId: string, id: string) {
    const d = await this.prisma.printDevice.findFirst({ where: { id, tenantId, revokedAt: null } }) as DeviceRow | null;
    if (!d) throw new NotFoundException('DEVICE_NOT_FOUND');
    return d;
  }

  async update(user: AuthenticatedUser, id: string, dto: { name?: unknown; routes?: unknown }) {
    const tenantId = this.tid(user);
    await this.own(tenantId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = cleanName(dto.name);
    if (dto.routes !== undefined) data.routes = cleanRoutes(dto.routes);
    await this.prisma.printDevice.updateMany({ where: { id, tenantId, revokedAt: null }, data: data as never });
    await this.audit.log({ tenantId, userId: user.userId, action: 'print.device_updated', resourceType: 'print_device', resourceId: id, metadata: data as never });
    return this.list(user);
  }

  /** A test ticket on one computer, for one kind of ticket (its printer as set now) — or a test of its cash drawer. */
  async test(user: AuthenticatedUser, id: string, route?: unknown, drawer = false) {
    const tenantId = this.tid(user);
    const d = await this.own(tenantId, id);
    if (!d.pairedAt) throw new NotFoundException('DEVICE_NOT_FOUND');
    const key = cleanKey(route) ?? Object.keys(cleanRoutes(d.routes))[0] ?? 'COUNTER';
    if (drawer) {
      if (!cleanRoutes(d.routes)[key]?.drawer) throw new ConflictException('DRAWER_NOT_SET');
      const job = await this.prisma.printJob.create({
        data: { tenantId, title: 'Thử mở két', text: '', drawer: true, deviceId: d.id, route: key, createdById: user.userId } as never,
        select: { id: true },
      });
      return { ok: true, jobId: job.id };
    }
    const at = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const job = await this.prisma.printJob.create({
      data: {
        tenantId, title: `In thử · ${key === ROUTE_ANY ? 'mặc định' : key}`, text: testTicket(key, d.name, at),
        station: key === 'COUNTER' || key === ROUTE_ANY ? null : key, deviceId: d.id, route: key, createdById: user.userId,
      } as never,
      select: { id: true },
    });
    return { ok: true, jobId: job.id };
  }

  /** Remove a computer: its token stops working at once and it uninstalls its autostart. */
  async revoke(user: AuthenticatedUser, id: string) {
    const tenantId = this.tid(user);
    await this.own(tenantId, id);
    await this.prisma.printDevice.updateMany({ where: { id, tenantId, revokedAt: null }, data: { revokedAt: new Date(), tokenHash: null, pairHash: null } });
    for (const [k, v] of this.known) if (v.device.id === id) this.known.delete(k);
    // Tickets it had taken but not printed go back to the queue for another computer.
    await this.prisma.printJob.updateMany({ where: { tenantId, deviceId: id, status: PrintJobStatus.PENDING }, data: { deviceId: null, claimedAt: null } as never });
    await this.audit.log({ tenantId, userId: user.userId, action: 'print.device_removed', resourceType: 'print_device', resourceId: id });
    return { ok: true };
  }

  /**
   * Open the cash drawer with no ticket (the till's "Mở két": change for a
   * customer, a cash sale without a receipt). Anyone who takes payment may;
   * every opening is logged with who did it.
   */
  async openDrawer(user: AuthenticatedUser, reason?: unknown) {
    const tenantId = this.tid(user);
    const devices = await this.prisma.printDevice.findMany({ where: { tenantId, revokedAt: null, pairedAt: { not: null } }, select: { id: true, routes: true, pairedAt: true } });
    if (!drawerRoute(devices as never)) throw new ConflictException('DRAWER_NOT_SET');
    const job = await this.prisma.printJob.create({
      data: { tenantId, title: 'Mở két', text: '', drawer: true, createdById: user.userId } as never,
      select: { id: true },
    });
    const why = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || null;
    await this.audit.log({ tenantId, userId: user.userId, action: 'print.drawer_opened', resourceType: 'print_job', resourceId: job.id, metadata: { reason: why } });
    return { ok: true };
  }

  // ----------------------------------------------------------- device side --

  /** The setup script for a waiting code (or a script that says the code is gone). */
  async install(code: string, headers: Record<string, unknown>): Promise<string> {
    const c = cleanCode(code);
    if (!c) return goneScript();
    const d = await this.prisma.printDevice.findFirst({ where: { pairHash: sha(c), pairedAt: null, revokedAt: null } }) as DeviceRow | null;
    if (!d || !d.pairExpiresAt || d.pairExpiresAt.getTime() < Date.now()) return goneScript();
    return installScript(publicApiBase(headers), c);
  }

  agent(): string {
    return agentScript();
  }

  /** The setup script trades its one-time code for this computer's own token. */
  async pair(dto: { code?: unknown; name?: unknown; printers?: unknown; defaultPrinter?: unknown }) {
    const c = cleanCode(dto.code);
    if (!c) throw new NotFoundException('CODE_INVALID');
    const d = await this.prisma.printDevice.findFirst({ where: { pairHash: sha(c), pairedAt: null, revokedAt: null } }) as DeviceRow | null;
    if (!d || !d.pairExpiresAt || d.pairExpiresAt.getTime() < Date.now()) throw new NotFoundException('CODE_INVALID');
    // The first computer prints everything on its default printer until told otherwise.
    const others = await this.prisma.printDevice.count({ where: { tenantId: d.tenantId, revokedAt: null, pairedAt: { not: null } } });
    const token = makeToken();
    const now = new Date();
    const r = await this.prisma.printDevice.updateMany({
      where: { id: d.id, tenantId: d.tenantId, pairedAt: null, revokedAt: null },
      data: {
        tokenHash: sha(token), pairHash: null, pairedAt: now, lastSeenAt: now,
        name: cleanName(dto.name) || 'PC', printers: cleanPrinters(dto.printers), defaultPrinter: cleanName(dto.defaultPrinter) || null,
        routes: others === 0 ? { [ROUTE_ANY]: { printer: '' } } : {},
      },
    });
    if (r.count === 0) throw new NotFoundException('CODE_INVALID');
    await this.audit.log({ tenantId: d.tenantId, action: 'print.device_paired', resourceType: 'print_device', resourceId: d.id, metadata: { name: cleanName(dto.name) } });
    return { token };
  }

  /** Who is calling: an active computer of an active business. 401 = removed (the agent uninstalls). */
  private async device(headers: Record<string, unknown>): Promise<DeviceRow> {
    const tok = headers['x-lumio-device'];
    if (!tokenShapeOk(tok)) throw new UnauthorizedException('DEVICE_UNKNOWN');
    const hash = sha(tok);
    const hit = this.known.get(hash);
    if (hit && Date.now() - hit.at < 20_000) return hit.device;
    const d = await this.prisma.printDevice.findFirst({ where: { tokenHash: hash, revokedAt: null } }) as DeviceRow | null;
    if (!d || !d.pairedAt) { this.known.delete(hash); throw new UnauthorizedException('DEVICE_UNKNOWN'); }
    const t = await this.prisma.tenant.findUnique({ where: { id: d.tenantId }, select: { status: true } });
    if (!t || t.status !== TenantStatus.ACTIVE) throw new ForbiddenException('TENANT_INACTIVE');
    if (this.known.size > 5000) this.known.clear();
    this.known.set(hash, { at: Date.now(), device: d });
    return d;
  }

  private async seen(d: DeviceRow, extra: Record<string, unknown> = {}) {
    if (!Object.keys(extra).length && d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 15_000) return;
    const now = new Date();
    d.lastSeenAt = now; // the remembered copy too
    await this.prisma.printDevice.updateMany({ where: { id: d.id, tenantId: d.tenantId }, data: { lastSeenAt: now, ...extra } as never });
  }

  async hello(headers: Record<string, unknown>, dto: { name?: unknown; printers?: unknown; defaultPrinter?: unknown; version?: unknown }) {
    const d = await this.device(headers);
    await this.seen(d, {
      printers: cleanPrinters(dto.printers),
      defaultPrinter: cleanName(dto.defaultPrinter) || null,
      agentVersion: String(dto.version ?? '').replace(/[^a-f0-9]/g, '').slice(0, 20) || null,
      ...(cleanName(dto.name) ? { name: d.name || cleanName(dto.name) } : {}),
    });
    return { ok: true };
  }

  /**
   * The jobs this computer should print now, taken atomically (two computers
   * never print the same ticket). Returned as ASCII-only JSON, drawn line by
   * line (rows) — or as ready ESC/POS bytes for a network printer.
   */
  async jobs(headers: Record<string, unknown>): Promise<string> {
    const d = await this.device(headers);
    await this.seen(d);
    const tenantId = d.tenantId;
    const now = Date.now();
    const [devices, pending] = await Promise.all([
      this.prisma.printDevice.findMany({ where: { tenantId, revokedAt: null, pairedAt: { not: null } }, select: { id: true, routes: true, pairedAt: true } }),
      this.prisma.printJob.findMany({
        where: {
          tenantId, status: PrintJobStatus.PENDING, createdAt: { gte: new Date(now - FRESH_MS) },
          OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now - RECLAIM_MS) } }],
        } as never,
        orderBy: { createdAt: 'asc' }, take: 30,
      }) as Promise<{ id: string; title: string | null; text: string; copies: number; station: string | null; deviceId: string | null; route: string | null; claimedAt: Date | null; drawer?: boolean }[]>,
    ]);
    const out: unknown[] = [];
    for (const j of pending) {
      const drawerOnly = !!j.drawer && !String(j.text ?? '').trim();
      const to = drawerOnly ? drawerRoute(devices as never, j.deviceId, j.route) : routeFor(j, devices as never);
      if (!to || to.deviceId !== d.id) continue;
      const took = await this.prisma.printJob.updateMany({
        where: { id: j.id, tenantId, status: PrintJobStatus.PENDING, claimedAt: j.claimedAt } as never,
        data: { claimedAt: new Date(), deviceId: d.id } as never,
      });
      if (took.count !== 1) continue;
      const rows = drawerOnly ? [] : styleRows(j.text, j.station);
      // The drawer opens only on the printer it is plugged into, and only when the ticket asks (a cash sale).
      const kick = !!j.drawer && !!to.route.drawer;
      const base = { id: j.id, title: j.title, copies: Math.max(1, Math.min(5, j.copies || 1)), text: j.text, rows, cols: columnsOf(rows), kick, drawerOnly };
      out.push(to.route.host
        ? { ...base, host: to.route.host, port: to.route.port ?? 9100, raw: escposBytes(rows, to.route, { kick, drawerOnly }).toString('base64') }
        : { ...base, printer: to.route.printer ?? '', maxWidth: printableWidth(to.route) });
    }
    return asciiJson({ version: AGENT_VERSION, jobs: out });
  }

  /** A computer reports a ticket it took: printed, or why not. Only its own tickets. */
  async result(headers: Record<string, unknown>, jobId: string, ok: boolean, error?: unknown) {
    const d = await this.device(headers);
    const r = await this.prisma.printJob.updateMany({
      where: { id: String(jobId), tenantId: d.tenantId, deviceId: d.id, status: PrintJobStatus.PENDING } as never,
      data: ok
        ? { status: PrintJobStatus.PRINTED, printedAt: new Date(), error: null }
        : { status: PrintJobStatus.FAILED, error: String(error ?? 'Print failed').slice(0, 400) },
    });
    if (r.count === 0) throw new NotFoundException('JOB_NOT_FOUND');
    return { ok: true };
  }

  /** The old Node agent stands down while a one-touch computer is online (no double tickets). */
  async liveDeviceFor(tenantId: string): Promise<boolean> {
    const n = await this.prisma.printDevice.count({ where: { tenantId, revokedAt: null, pairedAt: { not: null }, lastSeenAt: { gte: new Date(Date.now() - ONLINE_MS) } } as never });
    return n > 0;
  }
}

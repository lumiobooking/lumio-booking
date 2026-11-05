import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { cleanOptionGroups } from '../restaurant/check-logic';
import { currencyFixes } from './menu-currency';
import { planMenuImport, type MenuImportRow } from './menu-import';

/**
 * Restaurant menu (dish catalog) — tenant-scoped like tables/staff. Every query
 * is scoped to the caller's own tenantId so no restaurant can read or touch
 * another's menu. A dish's price is always in the restaurant's own currency.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private async currencyOf(tenantId: string): Promise<string> {
    const rules = await this.settings.getBookingRules(tenantId).catch(() => null);
    return String((rules as { currency?: string } | null)?.currency || 'USD').toUpperCase();
  }

  /**
   * The menu, after putting any dish saved under another currency back in the
   * restaurant's own (see menu-currency.ts). Runs once per dish: a fixed dish
   * carries the right label and is left alone after that.
   */
  async list(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const currency = await this.currencyOf(tenantId);
    const items = await this.prisma.menuItem.findMany({
      where: { tenantId },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    const fixes = currencyFixes(items, currency);
    if (fixes.length) {
      for (const f of fixes) {
        await this.prisma.menuItem.updateMany({ where: { id: f.id, tenantId }, data: { priceCents: f.priceCents, currency } });
      }
      await this.audit.log({ tenantId, userId: user.userId, action: 'menu.currency_fixed', resourceType: 'menu_item', metadata: { currency, dishes: fixes.length } });
      const fixed = new Map(fixes.map((f) => [f.id, f.priceCents]));
      return items.map((i) => (fixed.has(i.id) ? { ...i, priceCents: fixed.get(i.id)!, currency } : i));
    }
    return items;
  }

  async create(user: AuthenticatedUser, dto: CreateMenuItemDto) {
    const tenantId = this.tenantId(user);
    const item = await this.prisma.menuItem.create({
      data: {
        tenantId,
        name: dto.name,
        category: dto.category ?? null,
        priceCents: dto.priceCents,
        currency: await this.currencyOf(tenantId),
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.created', resourceType: 'menu_item', resourceId: item.id });
    return item;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateMenuItemDto) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.menuItem.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Menu item not found');
    await this.prisma.menuItem.updateMany({
      where: { id, tenantId },
      data: {
        name: dto.name ?? undefined,
        category: dto.category ?? undefined,
        priceCents: dto.priceCents ?? undefined,
        description: dto.description ?? undefined,
        imageUrl: dto.imageUrl ?? undefined,
        isActive: dto.isActive ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        options: dto.options !== undefined ? (cleanOptionGroups(dto.options) as never) : undefined,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.updated', resourceType: 'menu_item', resourceId: id });
    return this.prisma.menuItem.findFirst({ where: { id, tenantId } });
  }

  /**
   * The whole menu from a sheet (menu-import.ts): new dishes created, dishes
   * the restaurant has updated, nothing copied twice. One restaurant's menu
   * only — every read and write carries its tenantId.
   */
  async importMany(user: AuthenticatedUser, items: unknown[]) {
    const tenantId = this.tenantId(user);
    const currency = await this.currencyOf(tenantId);
    const existing = await this.prisma.menuItem.findMany({
      where: { tenantId },
      select: { id: true, name: true, category: true, priceCents: true, description: true, imageUrl: true, options: true, sortOrder: true },
    });
    const plan = planMenuImport(existing, (Array.isArray(items) ? items : []) as MenuImportRow[]);
    if (plan.create.length) {
      await this.prisma.menuItem.createMany({
        data: plan.create.map((c) => ({ tenantId, currency, name: c.name, category: c.category, priceCents: c.priceCents, description: c.description, imageUrl: c.imageUrl, sortOrder: c.sortOrder, options: c.options as never })),
      });
    }
    for (const u of plan.update) {
      await this.prisma.menuItem.updateMany({ where: { id: u.id, tenantId }, data: { ...u.data, currency } as never });
    }
    const result = { created: plan.create.length, updated: plan.update.length, unchanged: plan.same, skipped: plan.duplicate, errors: plan.error };
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.imported', resourceType: 'menu_item', metadata: result });
    return result;
  }

  /** Delete every menu item for the caller's tenant. Used to recover from a bad
   *  bulk import (e.g. the wrong CSV). Tenant-scoped, so it can never touch
   *  another restaurant's menu. */
  async removeAll(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const res = await this.prisma.menuItem.deleteMany({ where: { tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.clearedAll', resourceType: 'menu_item', metadata: { deleted: res.count } });
    return { ok: true, deleted: res.count };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.menuItem.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Menu item not found');
    await this.prisma.menuItem.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.deleted', resourceType: 'menu_item', resourceId: id });
    return { ok: true };
  }
}

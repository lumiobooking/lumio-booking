import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { cleanOptionGroups } from '../restaurant/check-logic';
import { currencyFixes } from './menu-currency';
import { planMenuImport, type MenuImportRow } from './menu-import';
import { MENU_CATEGORIES_KEY, allCategories, catKey, cleanCategoryList, cleanCategoryName, orderByCategories } from './menu-categories';
import { SETTINGS_KEY as RESTAURANT_KEY } from '../restaurant/check-logic';

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
    const [raw, order] = await Promise.all([
      this.prisma.menuItem.findMany({ where: { tenantId }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      this.storedCategories(tenantId),
    ]);
    // The owner's category order (Danh mục), then the rest A–Z.
    const items = orderByCategories(raw, allCategories(order, raw.map((i) => i.category)));
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

  // ------------------------------------------------------------ categories --

  /** The owner's category list (order + empty categories), this tenant only. */
  async storedCategories(tenantId: string): Promise<string[]> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: MENU_CATEGORIES_KEY } } }).catch(() => null);
    return cleanCategoryList(row?.value ?? []);
  }

  private async saveCategoryList(tenantId: string, names: string[]) {
    const value = cleanCategoryList(names);
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: MENU_CATEGORIES_KEY } },
      update: { value: value as never },
      create: { tenantId, key: MENU_CATEGORIES_KEY, value: value as never },
    });
    return value;
  }

  /** Every category with its dish count, in menu order. */
  async categories(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const [stored, groups] = await Promise.all([
      this.storedCategories(tenantId),
      this.prisma.menuItem.groupBy({ by: ['category'], where: { tenantId }, _count: { _all: true } }),
    ]);
    const list = allCategories(stored, groups.map((g) => g.category));
    const count = (c: string) => groups.filter((g) => g.category && catKey(g.category) === catKey(c)).reduce((n, g) => n + g._count._all, 0);
    return { categories: list.map((name) => ({ name, dishes: count(name) })), uncategorized: groups.filter((g) => !cleanCategoryName(g.category)).reduce((n, g) => n + g._count._all, 0) };
  }

  /** Create a category (may stay empty until dishes are added to it). */
  async addCategory(user: AuthenticatedUser, nameRaw: unknown) {
    const tenantId = this.tenantId(user);
    const name = cleanCategoryName(nameRaw);
    if (!name) throw new BadRequestException('CATEGORY_NAME_REQUIRED');
    const stored = await this.storedCategories(tenantId);
    const groups = await this.prisma.menuItem.groupBy({ by: ['category'], where: { tenantId } });
    const list = allCategories(stored, groups.map((g) => g.category));
    if (list.some((c) => catKey(c) === catKey(name))) throw new BadRequestException('CATEGORY_EXISTS');
    await this.saveCategoryList(tenantId, [...list, name]);
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.category_created', resourceType: 'menu_category', metadata: { name } });
    return this.categories(user);
  }

  /** Save the order the owner arranged (unknown names dropped, missing ones kept at the end). */
  async orderCategories(user: AuthenticatedUser, namesRaw: unknown) {
    const tenantId = this.tenantId(user);
    const stored = await this.storedCategories(tenantId);
    const groups = await this.prisma.menuItem.groupBy({ by: ['category'], where: { tenantId } });
    const known = allCategories(stored, groups.map((g) => g.category));
    const wanted = cleanCategoryList(namesRaw).filter((n) => known.some((k) => catKey(k) === catKey(n)));
    await this.saveCategoryList(tenantId, allCategories(wanted.map((n) => known.find((k) => catKey(k) === catKey(n))!), known));
    return this.categories(user);
  }

  /** Rename: every dish in it, the list, and the till's kitchen routing follow. */
  async renameCategory(user: AuthenticatedUser, fromRaw: unknown, toRaw: unknown) {
    const tenantId = this.tenantId(user);
    const from = cleanCategoryName(fromRaw);
    const to = cleanCategoryName(toRaw);
    if (!from || !to) throw new BadRequestException('CATEGORY_NAME_REQUIRED');
    const items = await this.prisma.menuItem.findMany({ where: { tenantId }, select: { id: true, category: true } });
    const ids = items.filter((i) => catKey(i.category) === catKey(from)).map((i) => i.id);
    if (ids.length) await this.prisma.menuItem.updateMany({ where: { tenantId, id: { in: ids } }, data: { category: to } });
    const list = allCategories(await this.storedCategories(tenantId), items.map((i) => i.category));
    const exists = list.some((c) => catKey(c) === catKey(to) && catKey(c) !== catKey(from));
    await this.saveCategoryList(tenantId, exists ? list.filter((c) => catKey(c) !== catKey(from)) : list.map((c) => (catKey(c) === catKey(from) ? to : c)));
    // The kitchen station this category printed at stays with it.
    const rs = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: RESTAURANT_KEY } } }).catch(() => null);
    const val = (rs?.value && typeof rs.value === 'object' ? rs.value : null) as { byCategory?: Record<string, string> } | null;
    if (val?.byCategory && val.byCategory[catKey(from)] && !val.byCategory[catKey(to)]) {
      const byCategory = { ...val.byCategory, [catKey(to)]: val.byCategory[catKey(from)] };
      delete byCategory[catKey(from)];
      await this.prisma.setting.updateMany({ where: { tenantId, key: RESTAURANT_KEY }, data: { value: { ...val, byCategory } as never } });
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.category_renamed', resourceType: 'menu_category', metadata: { from, to, dishes: ids.length } });
    return this.categories(user);
  }

  /** Delete a category. Its dishes are kept, without a category (they show under "Khác"). */
  async deleteCategory(user: AuthenticatedUser, nameRaw: unknown) {
    const tenantId = this.tenantId(user);
    const name = cleanCategoryName(nameRaw);
    if (!name) throw new BadRequestException('CATEGORY_NAME_REQUIRED');
    const items = await this.prisma.menuItem.findMany({ where: { tenantId }, select: { id: true, category: true } });
    const ids = items.filter((i) => catKey(i.category) === catKey(name)).map((i) => i.id);
    if (ids.length) await this.prisma.menuItem.updateMany({ where: { tenantId, id: { in: ids } }, data: { category: null } });
    const stored = await this.storedCategories(tenantId);
    await this.saveCategoryList(tenantId, stored.filter((c) => catKey(c) !== catKey(name)));
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.category_deleted', resourceType: 'menu_category', metadata: { name, dishes: ids.length } });
    return this.categories(user);
  }
}

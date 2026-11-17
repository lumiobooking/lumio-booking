import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { AiReleaseService } from './ai-release.service';
import type { ReleaseFeature, ReleaseStage } from './ai-release';

/**
 * Where each new AI behaviour is: off, on the test accounts only, or on for
 * every salon (./ai-release). Platform state — it names the test accounts and
 * nothing else about any salon. Support may look; only a Super Admin may move
 * a behaviour, because "on" reaches every salon's customers. Every move is
 * written to the audit log.
 */
@Controller('support/ai-release')
export class AiReleaseController {
  constructor(private readonly release: AiReleaseService, private readonly prisma: PrismaService) {}

  @Get()
  @Roles('SUPPORT' as UserRole, UserRole.SUPER_ADMIN)
  view() {
    return this.release.view();
  }

  @Post()
  @HttpCode(200)
  @Roles(UserRole.SUPER_ADMIN)
  async change(@CurrentUser() user: AuthenticatedUser, @Body() body: { stages?: Partial<Record<ReleaseFeature, ReleaseStage>>; canary?: string[] }) {
    const out = await this.release.change(user.email || user.userId, { stages: body?.stages, canary: Array.isArray(body?.canary) ? body.canary : undefined });
    await this.prisma.auditLog.create({
      data: {
        tenantId: null, userId: user.userId ?? null, action: 'platform.ai_release_changed', resourceType: 'platform_config', resourceId: 'ai_release',
        metadata: { stages: Object.fromEntries(out.features.map((f) => [f.feature, f.stage])), testAccounts: out.testAccounts.map((t) => t.id) },
      },
    }).catch(() => undefined);
    return out;
  }
}

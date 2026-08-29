import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { VoiceService } from './voice.service';
import { ProvisionVoiceDto, UpdateVoiceDto, VoiceLimitsDto } from './dto/voice.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';

/** Salon-admin management of the AI voice hotline (tenant-scoped). */
@Roles(UserRole.SALON_ADMIN)
@Controller('voice')
export class VoiceController {
  constructor(private readonly svc: VoiceService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.get(user);
  }

  @Post('settings')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('voiceAi')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateVoiceDto) {
    return this.svc.updateSettings(user, dto);
  }

  @Get('calls')
  calls(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listCalls(user);
  }

  @Get('usage')
  usage(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.usage(user);
  }
}

/** Platform (Super Admin) provisioning of Lumio voice numbers to tenants. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/voice')
export class VoiceAdminController {
  constructor(private readonly svc: VoiceService) {}

  @Post('provision')
  provision(@Body() dto: ProvisionVoiceDto) {
    return this.svc.provision(dto.tenantId, dto.lumioNumber);
  }

  /** One click answers "is the platform's AI brain alive?" — a real (tiny)
   *  Anthropic call. Every tenant shares one key: when it dies, EVERY hotline
   *  and messenger bot degrades at once and each salon looks broken on its
   *  own. Never returns the key itself. */
  @Get('ai-diag')
  aiDiag() {
    return this.svc.aiDiag();
  }

  @Get('usage')
  usage() {
    return this.svc.usageAll();
  }

  @Post('limits')
  limits(@Body() dto: VoiceLimitsDto) {
    return this.svc.setLimits(dto.tenantId, dto);
  }
}

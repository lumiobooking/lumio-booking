import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { VoiceService } from './voice.service';
import { ProvisionVoiceDto, UpdateVoiceDto } from './dto/voice.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

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
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateVoiceDto) {
    return this.svc.updateSettings(user, dto);
  }

  @Get('calls')
  calls(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listCalls(user);
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
}

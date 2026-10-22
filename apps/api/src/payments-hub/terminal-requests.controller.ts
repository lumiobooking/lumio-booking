import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { TerminalRequestsService } from './terminal-requests.service';

export class TerminalRequestDto {
  @IsOptional() @IsString() @Length(0, 60) brand?: string;
  @IsOptional() @IsString() @Length(0, 80) model?: string;
  @IsOptional() @IsString() @Length(0, 80) serial?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
}

export class TerminalRequestUpdateDto {
  @IsOptional() @IsIn(['open', 'sent', 'done']) status?: 'open' | 'sent' | 'done';
  @IsOptional() @IsString() @Length(0, 1000) reply?: string;
}

/** The salon's own requests: owner only, its own salon only. */
@Roles(UserRole.SALON_ADMIN)
@Controller('payments-hub/terminal-requests')
export class TerminalRequestsController {
  constructor(private readonly svc: TerminalRequestsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: TerminalRequestDto) {
    return this.svc.create(user, dto);
  }
}

/** Lumio's side: every salon's requests, and the answer sent back. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/terminal-requests')
export class TerminalRequestsAdminController {
  constructor(private readonly svc: TerminalRequestsService) {}

  @Get()
  all() {
    return this.svc.all();
  }

  @Patch(':tenantId/:id')
  update(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: TerminalRequestUpdateDto) {
    return this.svc.update(tenantId, id, dto);
  }
}

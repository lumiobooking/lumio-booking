import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RateLimit } from '../common/security/rate-limit.guard';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { StaffInviteService } from './staff-invite.service';
import { INVITE_ROLES } from './staff-invite';

export class CreateInviteDto {
  @IsOptional() @IsIn(INVITE_ROLES as unknown as string[]) staffRole?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxUses?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) days?: number;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}
export class FacebookStartDto {
  @IsIn(['join', 'login']) mode!: 'join' | 'login';
  @IsOptional() @IsString() @MaxLength(64) token?: string;
}
export class JoinPasswordDto {
  @IsString() @MaxLength(64) token!: string;
  @IsString() @MaxLength(80) name!: string;
  @IsString() @MaxLength(30) phone!: string;
  @IsString() @MaxLength(128) password!: string;
}
export class FacebookExchangeDto {
  @IsString() @MaxLength(2000) ticket!: string;
  @IsOptional() @IsInt() @Min(0) @Max(9) pick?: number;
}

/** rt200 — the owner's invite links (signed in) and the newcomer's way in (public). */
@Controller()
export class StaffInviteController {
  constructor(private readonly svc: StaffInviteService) {}

  @Roles(UserRole.SALON_ADMIN)
  @Get('staff-invites')
  list(@CurrentUser() user: AuthenticatedUser) { return this.svc.list(user); }

  @Roles(UserRole.SALON_ADMIN)
  @Post('staff-invites')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInviteDto) { return this.svc.create(user, dto); }

  @Roles(UserRole.SALON_ADMIN)
  @Post('staff-invites/:id/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.svc.revoke(user, id); }

  @Public()
  @RateLimit(30)
  @Get('staff-invites/preview/:token')
  preview(@Param('token') token: string) { return this.svc.preview(token); }

  /** rt203: is "Đăng nhập với Facebook" offered on this server? */
  @Public()
  @Get('auth/facebook/available')
  available() { return { on: this.svc.facebookOn() }; }

  @Public()
  @RateLimit(20)
  @Post('auth/facebook/start')
  @HttpCode(200)
  start(@Body() dto: FacebookStartDto) { return this.svc.start(dto.mode, dto.token); }

  /** rt202: join by the invite without Facebook — name, phone, own password. */
  @Public()
  @RateLimit(10)
  @Post('staff-invites/join')
  @HttpCode(200)
  joinPassword(@Body() dto: JoinPasswordDto) { return this.svc.joinWithPassword(dto.token, dto); }

  @Public()
  @RateLimit(20)
  @Post('auth/facebook/exchange')
  @HttpCode(200)
  exchange(@Body() dto: FacebookExchangeDto) { return this.svc.exchange(dto.ticket, dto.pick); }
}

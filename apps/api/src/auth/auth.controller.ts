import { BadRequestException, Body, Controller, Get, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { TeamPinsService } from './team-pins.service';
import { verifyLoginCaptcha } from '../common/security/turnstile';
import { AuthService } from './auth.service';
import { RateLimit } from '../common/security/rate-limit.guard';
import { LoginDto } from './dto/login.dto';
import { BootstrapDto } from './dto/bootstrap.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { capabilitiesFor } from './capabilities';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

class ApprovalPinDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  // 4–6 digits; empty clears it.
  @IsOptional() @IsString() @MaxLength(6) pin?: string;
}

class TeamPinDto {
  // 4–6 digits; empty clears it.
  @IsOptional() @IsString() @MaxLength(6) pin?: string;
}

class TeamPasswordDto {
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
}

class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(200) newPassword!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly teamPins: TeamPinsService) {}

  // POST /api/auth/login -> public, returns an access token.
  // Tight rate limit blunts password brute-forcing (10 tries/min per IP).
  @Public()
  @RateLimit(10, 60_000)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Ip() ip?: string) {
    // "Tôi không phải robot": refused before the password is even looked at.
    if (!(await verifyLoginCaptcha(dto.captchaToken, ip))) {
      throw new BadRequestException('Please confirm you are not a robot, then sign in again.');
    }
    return this.authService.login(dto.email, dto.password);
  }

  // POST /api/auth/bootstrap -> creates the FIRST Super Admin, once.
  //
  // Public because there is nobody to authenticate as yet. Guarded instead by
  // a secret token AND by the database being empty, so it stops working the
  // moment it has been used. Rate limited hard: five tries an hour makes
  // guessing the token pointless.
  @Public()
  @RateLimit(5, 3_600_000)
  @Post('bootstrap')
  @HttpCode(200)
  bootstrap(@Body() dto: BootstrapDto) {
    return this.authService.bootstrapSuperAdmin(dto);
  }

  // POST /api/auth/password -> change MY password (current one required).
  @RateLimit(10, 60_000)
  @Post('password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changeOwnPassword(user, dto.currentPassword, dto.newPassword);
  }

  // The approval PIN a manager types at the till (refunds / voids).
  @Get('approval-pin')
  approvalPin(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.approvalPinStatus(user);
  }

  // The salon's approvers and whether each has a PIN — for the owner, and for
  // Lumio Support setting a restaurant up (see team-pins.service.ts).
  @Get('approval-pins/team')
  teamApprovalPins(@CurrentUser() user: AuthenticatedUser) {
    return this.teamPins.list(user);
  }

  @RateLimit(20, 60_000)
  @Post('approval-pins/team/:userId')
  @HttpCode(200)
  setTeamApprovalPin(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string, @Body() dto: TeamPinDto) {
    return this.teamPins.set(user, userId, dto.pin ?? '');
  }

  // The salon's logins and a new sign-in password for one — Lumio Support inside a salon only.
  @Get('team-logins')
  teamLogins(@CurrentUser() user: AuthenticatedUser) {
    return this.teamPins.logins(user);
  }

  @RateLimit(20, 60_000)
  @Post('team-logins/:userId/password')
  @HttpCode(200)
  setTeamLoginPassword(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string, @Body() dto: TeamPasswordDto) {
    return this.teamPins.setLoginPassword(user, userId, dto.password);
  }

  @RateLimit(10, 60_000)
  @Post('approval-pin')
  @HttpCode(200)
  setApprovalPin(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApprovalPinDto) {
    return this.authService.setApprovalPin(user, dto.currentPassword, dto.pin ?? '');
  }

  // GET /api/auth/me -> requires a valid token; echoes the current principal.
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { ...user, capabilities: capabilitiesFor(user.role, user.staffRole, user.staffCaps) };
  }
}

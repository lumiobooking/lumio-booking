import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { WaitlistService } from './waitlist.service';

class JoinWaitlistDto {
  @IsString() @MaxLength(80) customerName!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() @MaxLength(10) preferredDate?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

@Controller()
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  /** Public: customer joins the waitlist for a salon. */
  @Public()
  @Post('public/salons/:slug/waitlist')
  join(@Param('slug') slug: string, @Body() dto: JoinWaitlistDto) {
    return this.waitlist.joinBySlug(slug, dto);
  }

  // ---- Salon admin ----
  @Roles(UserRole.SALON_ADMIN)
  @Get('waitlist')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.waitlist.list(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('waitlist/:id/notify')
  notify(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.waitlist.notify(user, id);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Patch('waitlist/:id')
  setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { status: string }) {
    return this.waitlist.setStatus(user, id, dto?.status);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete('waitlist/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.waitlist.remove(user, id);
  }
}

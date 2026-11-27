import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GoogleReviewsService } from './google-reviews.service';
import { ApproveReplyDto, RegenerateReplyDto, SetLocationDto, UpdateGbrSettingsDto } from './dto/google-reviews.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/** Salon-admin management for the Google review auto-reply system. All actions
 *  are strictly scoped to the authenticated tenant inside the service. */
@Roles(UserRole.SALON_ADMIN)
@UseGuards(FeaturePolicyGuard)
@RequiresFeature('reviews')
@Controller('google-reviews')
export class GoogleReviewsController {
  constructor(private readonly svc: GoogleReviewsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.get(user);
  }

  @Get('list')
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.svc.list(user, status);
  }

  @Post('settings')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateGbrSettingsDto) {
    return this.svc.updateSettings(user, dto);
  }

  @Get('connect')
  connect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.authUrl(user);
  }

  /** Clear reviews left over from an earlier connection (only while not connected). */
  @Post('purge-stale')
  purgeStale(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.purgeStale(user);
  }

  @Post('disconnect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.disconnect(user);
  }

  @Get('locations')
  locations(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listLocations(user);
  }

  @Post('location')
  setLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetLocationDto) {
    return this.svc.setLocation(user, dto.accountId, dto.locationId, dto.locationTitle);
  }

  /** rt252: Lumio team frees a Google location held by another salon (a stale, wrong link). */
  @Post('location/release')
  releaseLocation(@CurrentUser() user: AuthenticatedUser, @Body() body: { locationId?: string }) {
    return this.svc.releaseLocation(user, typeof body?.locationId === 'string' ? body.locationId.slice(0, 200) : '');
  }

  @Post('sync')
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.syncNow(user);
  }

  @Post('resync')
  resync(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.resync(user);
  }

  @Post('test-ai')
  testAi(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.testAi(user);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ApproveReplyDto) {
    return this.svc.approve(user, id, dto.text);
  }

  @Post(':id/regenerate')
  regenerate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RegenerateReplyDto) {
    return this.svc.regenerate(user, id, dto?.note);
  }

  @Post(':id/skip')
  skip(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.skip(user, id);
  }
}

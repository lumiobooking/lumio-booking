import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ReviewsService } from './reviews.service';

class SubmitFeedbackDto {
  @IsString() slug!: string;
  @IsString() staffId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // ---- Public (customer feedback page) ----
  @Public()
  @Get('public/review/:slug/:staffId')
  context(@Param('slug') slug: string, @Param('staffId') staffId: string) {
    return this.reviews.context(slug, staffId);
  }

  @Public()
  @Post('public/review')
  submit(@Body() dto: SubmitFeedbackDto) {
    return this.reviews.submit(dto);
  }

  // ---- Salon Admin ----
  @Roles(UserRole.SALON_ADMIN)
  @Get('reviews/leaderboard')
  leaderboard(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.leaderboard(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Get('reviews/feedback')
  feedback(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.recentFeedback(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('reviews/staff/:id/adjust')
  adjust(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { delta: number; reason?: string }) {
    return this.reviews.adjustPoints(user, id, dto.delta, dto.reason ?? '');
  }

  // ---- Staff (self) ----
  @Roles(UserRole.STAFF, UserRole.SALON_ADMIN)
  @Get('reviews/me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.mine(user);
  }
}

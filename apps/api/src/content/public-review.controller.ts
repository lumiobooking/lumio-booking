import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/security/rate-limit.guard';
import { PostReviewService } from './post-review.service';

/**
 * The group-chat door: everything the salon's review LINK can reach.
 *
 * No login — possession of the token is the credential, and the service
 * resolves it to exactly one tenant or to nothing (see post-review.ts for the
 * token's shape and its 30-day life). Every route re-resolves the token; a
 * revoked link dies mid-session, which is the point of revoking one.
 *
 * Rate-limited harder than the booking pages: nothing here is on a customer's
 * critical path, and a guessing attack against tokens should hit the wall
 * long before it hits the odds.
 */
@Public()
@Controller('public/review')
export class PublicReviewController {
  constructor(private readonly review: PostReviewService) {}

  private async tenantOf(token: string): Promise<string> {
    const tenantId = await this.review.resolveToken(String(token ?? ''));
    // One error for every failure mode: parse, unknown, revoked, expired.
    // A distinguishable "expired" tells a guesser they found a real tenant.
    if (!tenantId) throw new NotFoundException('Link không còn hiệu lực. Nhắn đội Lumio để nhận link mới nhé.');
    return tenantId;
  }

  @Get(':token')
  @RateLimit(60, 60_000)
  async feed(@Param('token') token: string) {
    return this.review.feed(await this.tenantOf(token));
  }

  @Post(':token/posts/:postId/approve')
  @RateLimit(20, 60_000)
  async approve(
    @Param('token') token: string,
    @Param('postId') postId: string,
    @Body() body: { name?: string },
  ) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('Cho tiệm biết tên người duyệt nhé.');
    return this.review.approve(await this.tenantOf(token), postId, name);
  }

  @Get(':token/posts/:postId/comments')
  @RateLimit(60, 60_000)
  async comments(@Param('token') token: string, @Param('postId') postId: string) {
    return this.review.comments(await this.tenantOf(token), postId);
  }

  @Post(':token/posts/:postId/comments')
  @RateLimit(20, 60_000)
  async comment(
    @Param('token') token: string,
    @Param('postId') postId: string,
    @Body() body: { name?: string; body?: string },
  ) {
    return this.review.addComment(await this.tenantOf(token), postId, String(body?.name ?? ''), String(body?.body ?? ''));
  }
}

import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/security/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { WebChatService } from './web-chat.service';
import { widgetSource } from './web-chat-widget';

/** The salon's switch and the line to paste. Same trust as the Bot page. */
@Roles(UserRole.SALON_ADMIN)
@Controller('messenger/webchat')
export class WebChatAdminController {
  constructor(private readonly svc: WebChatService) {}

  @Get()
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @Post()
  @HttpCode(200)
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: Record<string, unknown>) {
    return this.svc.update(user, dto ?? {});
  }
}

/**
 * What a visitor's browser calls, from the salon's own website. No login —
 * the visitor id the browser minted is the credential for its one thread.
 * CORS for this prefix is opened in main.ts, because the caller is whatever
 * domain the salon's site lives on.
 */
@Public()
@Controller('public/chat')
export class WebChatPublicController {
  constructor(private readonly svc: WebChatService) {}

  /** The widget itself. One file for every salon; the slug rides on the tag. */
  @Get('widget.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  widget() {
    return widgetSource();
  }

  @Get(':slug')
  config(@Param('slug') slug: string) {
    return this.svc.publicConfig(slug);
  }

  /** Polled while the panel is open — a few a minute per visitor. */
  @Get(':slug/messages')
  messages(@Param('slug') slug: string, @Query('visitor') visitor?: string, @Query('since') since?: string) {
    return this.svc.messages(slug, visitor, since);
  }

  /** One line from the visitor. Tighter budget: each one costs a model call. */
  @Post(':slug/messages')
  @HttpCode(200)
  @RateLimit(20, 60_000)
  send(@Param('slug') slug: string, @Body() body: { visitor?: string; text?: string }) {
    return this.svc.inbound(slug, body ?? {});
  }
}

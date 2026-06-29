import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GiftCardsService } from './gift-cards.service';
import { IssueGiftCardDto, AdjustGiftCardDto } from './dto/gift-card.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// Cashiers (receptionists) sell + redeem gift cards, so this rides the 'pos' cap.
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('pos')
@Controller('gift-cards')
export class GiftCardsController {
  constructor(private readonly giftCards: GiftCardsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.giftCards.list(user, status);
  }

  @Get('lookup/:code')
  lookup(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.giftCards.lookup(user, code);
  }

  @Post()
  issue(@CurrentUser() user: AuthenticatedUser, @Body() dto: IssueGiftCardDto) {
    return this.giftCards.issue(user, dto);
  }

  @Post(':id/void')
  @HttpCode(200)
  void(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.giftCards.void(user, id);
  }

  @Post(':id/adjust')
  @HttpCode(200)
  adjust(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AdjustGiftCardDto) {
    return this.giftCards.adjust(user, id, dto);
  }
}

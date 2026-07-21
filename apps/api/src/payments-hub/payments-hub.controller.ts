import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { PaymentOrchestrator } from './payment-orchestrator.service';
import { ChargeDto, ConnectDto, RefundDto, RegisterReaderDto, VoidDto } from './dto/payments-hub.dto';

/**
 * Salon-facing Payment Hub API. Class-level RBAC = SALON_ADMIN + STAFF; the
 * connect/revoke/refund and reader-registration actions are narrowed to
 * SALON_ADMIN. Every method is tenant-scoped inside the orchestrator.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('payments-hub')
export class PaymentsHubController {
  constructor(private readonly hub: PaymentOrchestrator) {}

  @Get('status')
  status() {
    return this.hub.status();
  }

  @Get('connections')
  connections(@CurrentUser() user: AuthenticatedUser) {
    return this.hub.listConnections(user);
  }

  @Post('connect')
  @Roles(UserRole.SALON_ADMIN)
  connect(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConnectDto) {
    return this.hub.connect(user, dto);
  }

  @Post('test/:provider')
  @Roles(UserRole.SALON_ADMIN)
  test(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string) {
    return this.hub.test(user, provider);
  }

  @Delete('connection/:provider')
  @Roles(UserRole.SALON_ADMIN)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string) {
    return this.hub.revoke(user, provider);
  }

  @Get('readers/:provider')
  readers(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string) {
    return this.hub.listReaders(user, provider);
  }

  @Post('readers/:provider')
  @Roles(UserRole.SALON_ADMIN)
  registerReader(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string, @Body() dto: RegisterReaderDto) {
    return this.hub.registerReader(user, provider, dto);
  }

  /** Check one specific terminal, not the account as a whole. */
  @Post('readers/test/:deviceId')
  testDevice(@CurrentUser() user: AuthenticatedUser, @Param('deviceId') deviceId: string) {
    return this.hub.testDevice(user, deviceId);
  }

  @Post('connection-token/:provider')
  connectionToken(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string) {
    return this.hub.connectionToken(user, provider);
  }

  @Post('charge')
  charge(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChargeDto) {
    return this.hub.charge(user, dto);
  }

  @Get('intents/:id')
  getIntent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hub.getIntent(user, id);
  }

  @Post('refund')
  @Roles(UserRole.SALON_ADMIN)
  refund(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefundDto) {
    return this.hub.refund(user, dto);
  }

  /**
   * Void cancels the original transaction before the batch settles. It is the
   * right tool the same day; after settlement the salon must use Refund.
   */
  @Post('void')
  @Roles(UserRole.SALON_ADMIN)
  voidPayment(@CurrentUser() user: AuthenticatedUser, @Body() dto: VoidDto) {
    return this.hub.voidPayment(user, dto);
  }
}

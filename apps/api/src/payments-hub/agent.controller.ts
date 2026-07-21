import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { AgentService } from './agent.service';
import { AgentPairDto, AgentRegisterReaderDto, AgentResultDto, CreateAgentDto } from './dto/payments-hub.dto';

/** Salon-admin management of Bridge/Companion agents. */
@Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
@Controller('payments-hub/agents')
export class AgentAdminController {
  constructor(private readonly agents: AgentService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAgentDto) {
    return this.agents.createAgent(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.agents.listAgents(user);
  }

  @Delete(':id')
  unpair(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.agents.unpair(user, id);
  }
}

/**
 * Agent runtime API. Authenticated by the AGENT bearer token (not a user JWT),
 * so these routes are @Public to the JWT guard and validate the token manually.
 */
@Controller('payments-hub/agent')
export class AgentRuntimeController {
  constructor(private readonly agents: AgentService) {}

  @Public()
  @SkipRateLimit()
  @Post('pair')
  pair(@Body() dto: AgentPairDto) {
    return this.agents.pair(dto);
  }

  @Public()
  @SkipRateLimit()
  @Post('poll')
  async poll(@Headers('authorization') auth?: string) {
    const agent = await this.agents.authAgent(auth);
    return this.agents.poll(agent);
  }

  @Public()
  @SkipRateLimit()
  @Post('result')
  async result(@Headers('authorization') auth: string | undefined, @Body() dto: AgentResultDto) {
    const agent = await this.agents.authAgent(auth);
    return this.agents.result(agent, dto);
  }

  @Public()
  @SkipRateLimit()
  @Post('connection-token')
  async connectionToken(@Headers('authorization') auth?: string) {
    const agent = await this.agents.authAgent(auth);
    return this.agents.connectionToken(agent);
  }

  @Public()
  @SkipRateLimit()
  @Post('readers')
  async registerReader(@Headers('authorization') auth: string | undefined, @Body() dto: AgentRegisterReaderDto) {
    const agent = await this.agents.authAgent(auth);
    return this.agents.registerReader(agent, dto);
  }
}

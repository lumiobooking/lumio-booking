import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RateLimit } from '../common/security/rate-limit.guard';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { capabilitiesFor } from './capabilities';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/login -> public, returns an access token.
  // Tight rate limit blunts password brute-forcing (10 tries/min per IP).
  @Public()
  @RateLimit(10, 60_000)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // GET /api/auth/me -> requires a valid token; echoes the current principal.
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { ...user, capabilities: capabilitiesFor(user.role, user.staffRole) };
  }
}

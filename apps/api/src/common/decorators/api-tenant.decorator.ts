import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * Injects the tenantId resolved by ApiKeyGuard from the X-Lumio-Api-Key header.
 * Throws if used on a route that is not protected by ApiKeyGuard.
 */
export const ApiTenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const tenantId = req.apiTenantId;
  if (!tenantId) {
    throw new UnauthorizedException('Missing API key context');
  }
  return tenantId;
});

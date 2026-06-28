import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchScopeInterceptor } from './branch-scope.interceptor';

/**
 * Multi-branch (chain) support. Registers a global interceptor that re-scopes a
 * request to a selected branch (via X-Branch-Id) for owners/managers, plus the
 * switcher list + consolidated report endpoints.
 */
@Module({
  controllers: [BranchesController],
  providers: [
    BranchesService,
    { provide: APP_INTERCEPTOR, useClass: BranchScopeInterceptor },
  ],
  exports: [BranchesService],
})
export class BranchesModule {}

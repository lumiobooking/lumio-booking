import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as public so the global JWT guard skips authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

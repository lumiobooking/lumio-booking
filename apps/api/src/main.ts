import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the raw request buffer so Stripe webhook signatures can
  // be verified (req.rawBody). JSON parsing still works for all other routes.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  // Global API prefix: all routes live under /api
  app.setGlobalPrefix('api');

  // Fail fast in production if the JWT signing secret wasn't provided — never
  // silently fall back to the built-in dev secret (that would let anyone forge
  // admin tokens).
  if (config.get<string>('NODE_ENV') === 'production' && !config.get<string>('JWT_SECRET')) {
    throw new Error('JWT_SECRET must be set in production');
  }

  // Baseline security headers (dependency-free equivalent of the headers helmet
  // would set for a JSON API). No CSP/CORP — this API serves JSON to a
  // cross-origin SPA + the WordPress plugin, and CORS already governs readers.
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (config.get<string>('NODE_ENV') === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  // Validate and strip every incoming request body against its DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS limited to the configured frontend origins (default http://localhost:3005)
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3005')
    .split(',')
    .map((origin) => origin.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Backend API listens on port 8005 (frontend dashboard uses 3005)
  const port = Number(config.get<string>('PORT') ?? 8005);
  await app.listen(port);

  Logger.log(`Lumio Booking API is running on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();

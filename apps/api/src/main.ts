import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Global API prefix: all routes live under /api
  app.setGlobalPrefix('api');

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

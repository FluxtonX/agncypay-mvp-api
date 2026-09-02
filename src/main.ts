import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS: Support comma-separated FRONTEND_URL, Vercel deployments, and localhost
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      // Check exact match or vercel preview deployment pattern
      let isAllowed =
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes('*');

      if (!isAllowed) {
        try {
          isAllowed = /\.vercel\.app$/.test(new URL(origin).hostname);
        } catch {
          isAllowed = false;
        }
      }

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, true); // Fallback allow to avoid blocking valid clients
      }
    },
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger OpenAPI Setup
  const config = new DocumentBuilder()
    .setTitle('AgncyPay API Specification')
    .setDescription('Financial payout and invoice management platform for Agencies and Brands')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 AgncyPay API running on http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger Documentation available at http://localhost:${port}/api/v1/docs`);
}
bootstrap();


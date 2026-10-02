import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configuredOrigins, isOriginAllowed } from './common/security/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableShutdownHooks();

  // ECS tasks are reachable only through the ALB security group. Trusting one
  // proxy hop preserves the client IP for throttling and audit middleware.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Global prefix
  app.setGlobalPrefix('api/v1');

  const allowedOrigins = configuredOrigins(process.env.FRONTEND_URL);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (isOriginAllowed(origin, allowedOrigins)) return callback(null, true);
      callback(new Error('Origin is not allowed by AgncyPay CORS policy'));
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
    .setDescription(
      'Financial payout and invoice management platform for Agencies and Brands',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document, {
    customCssUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui-standalone-preset.js',
    ],
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 AgncyPay API running on http://localhost:${port}/api/v1`);
  console.log(
    `📚 Swagger Documentation available at http://localhost:${port}/api/v1/docs`,
  );
}
bootstrap();

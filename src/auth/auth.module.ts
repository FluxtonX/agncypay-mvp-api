import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';
import { AuthorizationGuard } from './guards/authorization.guard';
import { InvitationService } from './invitation.service';
import { AUTH_EMAIL_PROVIDER } from '../core/interfaces/auth-email-provider.interface';
import { CaptureAuthEmailProvider } from '../infrastructure/providers/email/capture-auth-email.provider';
import { SesAuthEmailProvider } from '../infrastructure/providers/email/ses-auth-email.provider';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import type { SignOptions } from 'jsonwebtoken';

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          'agncypay-jwt-secret-change-in-production',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRATION') ||
            '15m') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    UserRepository,
    AuthorizationGuard,
    InvitationService,
    OptionalJwtAuthGuard,
    CaptureAuthEmailProvider,
    SesAuthEmailProvider,
    {
      provide: AUTH_EMAIL_PROVIDER,
      inject: [ConfigService, CaptureAuthEmailProvider, SesAuthEmailProvider],
      useFactory: (
        configService: ConfigService,
        captureProvider: CaptureAuthEmailProvider,
        sesProvider: SesAuthEmailProvider,
      ) => {
        const environment =
          configService.get<string>('NODE_ENV') || 'development';
        const configuredMode = configService
          .get<string>('AUTH_EMAIL_MODE')
          ?.trim()
          .toLowerCase();
        const mode =
          configuredMode || (environment === 'production' ? 'ses' : 'capture');

        if (mode === 'ses') return sesProvider;
        if (mode === 'capture' && environment !== 'production') {
          return captureProvider;
        }
        throw new Error(
          `AUTH_EMAIL_MODE=${mode} is not allowed for NODE_ENV=${environment}`,
        );
      },
    },
  ],
  exports: [
    AuthService,
    AuthorizationGuard,
    InvitationService,
    AUTH_EMAIL_PROVIDER,
  ],
})
export class AuthModule {}

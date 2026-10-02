import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Headers,
  Param,
  ForbiddenException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  CreateInvitationDto,
  AcceptInvitationDto,
  RefreshTokenDto,
  PublicSignupDto,
  VerifyEmailDto,
  ResendVerificationDto,
} from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { InvitationService } from './invitation.service';
import { AuthorizationGuard } from './guards/authorization.guard';
import { Permissions } from './decorators/authorization.decorator';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { CaptureAuthEmailProvider } from '../infrastructure/providers/email/capture-auth-email.provider';
import { ConfigService } from '@nestjs/config';
import type { AuthEmailPurpose } from '../core/interfaces/auth-email-provider.interface';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly invitationService: InvitationService,
    private readonly captureEmailProvider: CaptureAuthEmailProvider,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Create a public Agency, Brand, or Talent account' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  signup(@Body() dto: PublicSignupDto) {
    return this.authService.signup(dto);
  }

  @ApiOperation({ summary: 'Verify a public-signup email address' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @ApiOperation({ summary: 'Request another email-verification message' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-email/resend')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @ApiOperation({
    summary: 'Read a captured auth email in non-production only',
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('development/emails/:deliveryId')
  getDevelopmentEmail(
    @Param('deliveryId') deliveryId: string,
    @Headers('x-dev-email-key') suppliedKey?: string,
  ) {
    const expectedKey = this.configService.get<string>(
      'AUTH_EMAIL_CAPTURE_KEY',
    );
    if (process.env.NODE_ENV === 'production' || !expectedKey) {
      throw new NotFoundException();
    }
    if (!suppliedKey || suppliedKey !== expectedKey) {
      throw new ForbiddenException('Invalid development email key');
    }
    const message = this.captureEmailProvider.get(deliveryId);
    if (!message) throw new NotFoundException('Captured email not found');
    return message;
  }

  @ApiOperation({
    summary: 'Read the latest captured auth email in non-production only',
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('development/emails/latest/message')
  getLatestDevelopmentEmail(
    @Query('email') email: string,
    @Query('purpose') purpose: AuthEmailPurpose,
    @Headers('x-dev-email-key') suppliedKey?: string,
  ) {
    const expectedKey = this.configService.get<string>(
      'AUTH_EMAIL_CAPTURE_KEY',
    );
    if (process.env.NODE_ENV === 'production' || !expectedKey) {
      throw new NotFoundException();
    }
    if (!suppliedKey || suppliedKey !== expectedKey) {
      throw new ForbiddenException('Invalid development email key');
    }
    if (
      !email ||
      !['verify_email', 'password_reset', 'invitation'].includes(purpose)
    ) {
      throw new NotFoundException('Captured email not found');
    }
    const message = this.captureEmailProvider.findLatest(email, purpose);
    if (!message) throw new NotFoundException('Captured email not found');
    return message;
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Invite a user or Talent into an authorized organization',
  })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions('manage_team')
  @Post('invitations')
  async createInvitation(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    const result = await this.invitationService.create(userId, dto);
    return {
      invitationId: result.invitationId,
      expiresAt: result.expiresAt,
      emailDelivery: result.emailDelivery,
    };
  }

  @ApiOperation({ summary: 'Activate a single-use organization invitation' })
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('invitations/accept')
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @CurrentUser('id') currentUserId?: string,
  ) {
    return this.authService.acceptInvitation(dto, currentUserId);
  }

  @ApiOperation({ summary: 'Log in with user credentials' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user session & profile' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @ApiOperation({ summary: 'Request password reset email & token' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @ApiOperation({ summary: 'Reset account password with reset token' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiOperation({ summary: 'Issue new tokens using refresh token' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out and revoke refresh tokens' })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@CurrentUser('id') userId: string) {
    await this.authService.logout(userId);
    return { success: true };
  }
}

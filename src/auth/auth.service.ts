import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';
import { InvitationService } from './invitation.service';
import { AcceptInvitationDto } from './dto';
import { PublicSignupDto, ResendVerificationDto, VerifyEmailDto } from './dto';
import { AccountType, Prisma } from '@prisma/client';
import { AUTH_EMAIL_PROVIDER } from '../core/interfaces/auth-email-provider.interface';
import type { AuthEmailProvider } from '../core/interfaces/auth-email-provider.interface';
import { defaultRoleFor, permissionsForRole } from './access-policy';
import type { SignOptions } from 'jsonwebtoken';

type RefreshTokenPayload = {
  sub: string;
  email: string;
  sv: number;
  jti?: string;
  exp?: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userRepo: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
    private readonly invitationService: InvitationService,
    @Inject(AUTH_EMAIL_PROVIDER)
    private readonly authEmailProvider: AuthEmailProvider,
  ) {}

  private hashOpaqueToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private accountReference(accountType: AccountType): string {
    const prefix: Record<AccountType, string> = {
      agency: 'AGY',
      brand: 'BRND',
      talent: 'TAL',
      platform: 'PLT',
    };
    return `${prefix[accountType]}-${crypto.randomUUID()}`;
  }

  async signup(dto: PublicSignupDto) {
    const email = dto.email.trim().toLowerCase();
    const accountType = dto.accountType as AccountType;
    if (accountType !== 'talent' && !dto.organizationName?.trim()) {
      throw new BadRequestException(
        'Organization name is required for Agency and Brand signup',
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account already exists for this email');
    }

    const verificationToken = crypto.randomBytes(32).toString('base64url');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const password = await bcrypt.hash(dto.password, 12);

    const created = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const userData = {
          email,
          password,
          fullName: dto.fullName.trim(),
          accountType,
          agncyId: this.accountReference(accountType),
          emailVerified: false,
          emailVerificationToken: this.hashOpaqueToken(verificationToken),
          emailVerificationTokenExpires: verificationExpiresAt,
          deletedAt: null,
        };
        const user = await tx.user.create({ data: userData });

        const participant = await tx.participant.create({
          data: {
            kind: 'individual',
            displayName: user.fullName,
          },
        });
        await tx.participantUser.create({
          data: { participantId: participant.id, userId: user.id },
        });

        let organizationId: string | undefined;
        if (accountType === 'agency' || accountType === 'brand') {
          const organization = await tx.organization.create({
            data: {
              type: accountType,
              name: dto.organizationName!.trim(),
            },
          });
          organizationId = organization.id;
          const role = defaultRoleFor(accountType)!;
          await tx.organizationParticipant.create({
            data: {
              organizationId,
              participantId: participant.id,
              relationshipType: role,
              metadata: {
                organizationRole: role,
                permissions: permissionsForRole(role),
              },
            },
          });
        }

        return { user, participantId: participant.id, organizationId };
      },
    );

    const delivery = await this.authEmailProvider.send({
      to: email,
      purpose: 'verify_email',
      token: verificationToken,
      expiresAt: verificationExpiresAt,
      metadata: { userId: created.user.id },
    });
    await this.auditLogsService.log({
      userId: created.user.id,
      organizationId: created.organizationId,
      action: 'PUBLIC_SIGNUP_CREATED',
      entityType: 'User',
      entityId: created.user.id,
      details: { accountType, deliveryId: delivery.id },
    });

    return {
      success: true,
      userId: created.user.id,
      verificationRequired: true,
      emailDelivery: delivery,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const tokenHash = this.hashOpaqueToken(dto.token);
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationToken: tokenHash,
        deletedAt: null,
      },
    });
    if (
      !user ||
      !user.emailVerificationTokenExpires ||
      user.emailVerificationTokenExpires <= new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationTokenExpires: null,
      },
    });
    await this.auditLogsService.log({
      userId: verified.id,
      action: 'EMAIL_VERIFIED',
      entityType: 'User',
      entityId: verified.id,
    });
    return {
      user: this.publicUser(verified),
      ...(await this.generateTokens(verified.id, verified.email)),
    };
  }

  async resendVerification(dto: ResendVerificationDto) {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user || user.emailVerified) {
      return {
        success: true,
        message: 'If verification is required, a new message has been sent.',
      };
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.userRepo.update(user.id, {
      emailVerificationToken: this.hashOpaqueToken(token),
      emailVerificationTokenExpires: expiresAt,
    });
    await this.authEmailProvider.send({
      to: user.email,
      purpose: 'verify_email',
      token,
      expiresAt,
      metadata: { userId: user.id },
    });
    return {
      success: true,
      message: 'If verification is required, a new message has been sent.',
    };
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Email verification is required');
    }

    await this.auditLogsService.log({
      userId: user.id,
      action: 'USER_LOGGED_IN',
      entityType: 'User',
      entityId: user.id,
    });

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        ...this.publicUser(user),
      },
      ...tokens,
    };
  }

  async acceptInvitation(dto: AcceptInvitationDto, currentUserId?: string) {
    const user = await this.invitationService.accept(dto, currentUserId);
    await this.auditLogsService.log({
      userId: user.id,
      action: 'INVITATION_ACCEPTED',
      entityType: 'User',
      entityId: user.id,
      details: { accountType: user.accountType },
    });
    const tokens = await this.generateTokens(user.id, user.email);
    return {
      user: {
        ...this.publicUser(user),
      },
      ...tokens,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) {
      // Don't reveal if user exists
      return {
        success: true,
        message:
          'If an account exists with this email, password reset instructions have been sent.',
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = this.hashOpaqueToken(rawToken);
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.userRepo.update(user.id, {
      resetToken: hashedResetToken,
      resetTokenExpires,
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
    });

    await this.authEmailProvider.send({
      to: user.email,
      purpose: 'password_reset',
      token: rawToken,
      expiresAt: resetTokenExpires,
      metadata: { userId: user.id },
    });

    return {
      success: true,
      message:
        'If an account exists with this email, password reset instructions have been sent.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hashedToken = this.hashOpaqueToken(dto.token);
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        deletedAt: null,
      },
    });

    if (
      !user ||
      !user.resetTokenExpires ||
      user.resetTokenExpires < new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.userRepo.update(user.id, {
      password: hashedPassword,
      resetToken: null,
      resetTokenExpires: null,
      sessionVersion: { increment: 1 },
    });
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: user.id,
    });

    return { success: true, message: 'Password has been reset successfully.' };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        },
      );

      const storedToken = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: this.hashOpaqueToken(refreshToken) },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        if (payload.sub) {
          await this.prisma.$transaction([
            this.prisma.refreshToken.deleteMany({
              where: { userId: payload.sub },
            }),
            this.prisma.user.updateMany({
              where: { id: payload.sub, deletedAt: null },
              data: { sessionVersion: { increment: 1 } },
            }),
          ]);
        }
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = await this.userRepo.findById(payload.sub);
      if (!user || !user.emailVerified || user.sessionVersion !== payload.sv) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      await this.prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });

      return this.generateTokens(user.id, user.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      }),
    ]);

    await this.auditLogsService.log({
      userId,
      action: 'USER_LOGGED_OUT',
      entityType: 'User',
      entityId: userId,
    });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        accountType: true,
        agncyId: true,
        emailVerified: true,
        kybStatus: true,
        createdAt: true,
        participantLinks: {
          include: {
            participant: {
              include: {
                organizations: {
                  where: { status: 'active' },
                  include: { organization: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const memberships = user.participantLinks.flatMap((link) =>
      link.participant.organizations.map((membership) => ({
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        organizationType: membership.organization.type,
        relationshipType: membership.relationshipType,
        metadata: membership.metadata,
      })),
    );
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      displayName: user.fullName,
      accountType: user.accountType,
      role: user.accountType,
      agncyId: user.agncyId,
      emailVerified: user.emailVerified,
      kybStatus: user.kybStatus,
      kycStatus: user.kybStatus,
      createdAt: user.createdAt,
      memberships,
    };
  }

  private publicUser(user: {
    id: string;
    email: string;
    fullName: string;
    accountType: AccountType;
    agncyId: string;
    kybStatus?: unknown;
  }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      accountType: user.accountType,
      agncyId: user.agncyId,
      ...(user.kybStatus !== undefined ? { kybStatus: user.kybStatus } : {}),
    };
  }

  private async generateTokens(userId: string, email: string) {
    const session = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, emailVerified: true },
      select: { sessionVersion: true },
    });
    if (!session)
      throw new UnauthorizedException('User session is unavailable');
    const payload = { sub: userId, email, sv: session.sessionVersion };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_EXPIRATION') ||
        '15m') as SignOptions['expiresIn'],
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, jti: crypto.randomUUID() },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRATION') ||
          '7d') as SignOptions['expiresIn'],
      },
    );

    const decoded = this.jwtService.decode<RefreshTokenPayload>(refreshToken);
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashOpaqueToken(refreshToken),
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}

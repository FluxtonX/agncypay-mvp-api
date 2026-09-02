import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import { AccountType, WorkspaceType, WorkspaceRole, Prisma } from '@prisma/client';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userRepo: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private generateAgncyId(prefix: string): string {
    return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
  }

  private getDefaultWorkspaceRole(type: WorkspaceType): WorkspaceRole {
    if (type === 'agency') return WorkspaceRole.agency_admin;
    if (type === 'mother_agency') return WorkspaceRole.super_admin;
    return WorkspaceRole.admin;
  }

  private getDefaultPermissions(role: WorkspaceRole): string[] {
    const permissionsByRole: Record<string, string[]> = {
      admin: ['approve_invoices', 'initiate_payments', 'view_treasury', 'manage_team', 'view_reports'],
      finance: ['initiate_payments', 'view_treasury', 'view_reports'],
      approver: ['approve_invoices', 'view_reports'],
      viewer: ['view_reports'],
      agency_admin: ['create_invoices', 'approve_payouts', 'manage_team', 'view_reports'],
      finance_manager: ['create_invoices', 'approve_payouts', 'view_reports'],
      super_admin: ['manage_hierarchy', 'view_treasury', 'initiate_payments', 'approve_payouts', 'manage_team', 'view_reports'],
      treasury: ['view_treasury', 'initiate_payments', 'approve_payouts', 'view_reports'],
      finance_ops: ['approve_payouts', 'view_reports'],
    };
    return permissionsByRole[role] || [];
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.userRepo.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const accountType = dto.accountType as AccountType;
    const prefix = accountType === 'brand' ? 'BRND' : accountType === 'talent' ? 'TAL' : 'AGY';
    const agncyId = this.generateAgncyId(prefix);
    const workspaceType = (accountType === 'talent' ? 'agency' : accountType) as unknown as WorkspaceType;
    const role = this.getDefaultWorkspaceRole(workspaceType);
    const workspaceName = dto.workspaceName?.trim() || (accountType === 'talent' ? `${dto.fullName}'s Talent Workspace` : 'AgncyPay Workspace');

    const user = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdUser = await tx.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          password: hashedPassword,
          fullName: dto.fullName.trim(),
          accountType,
          agncyId,
          emailVerified: true,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          type: workspaceType,
          name: workspaceName,
          agncyId: this.generateAgncyId('WS'),
          verificationTrack: 'kyb',
          verificationStatus: 'draft',
          ownerId: createdUser.id,
        },
      });

      await tx.membership.create({
        data: {
          userId: createdUser.id,
          workspaceId: workspace.id,
          role,
          permissions: this.getDefaultPermissions(role),
          status: 'active',
        },
      });

      await tx.businessProfile.create({ data: { userId: createdUser.id } });
      await tx.representative.create({ data: { userId: createdUser.id } });
      await tx.authorization.create({ data: { userId: createdUser.id } });
      await tx.brandVerification.create({ data: { userId: createdUser.id } });
      await tx.bankDetails.create({ data: { userId: createdUser.id } });

      const walletPrefix = accountType === 'brand' ? 'WAL-BRND' : accountType === 'talent' ? 'WAL-TAL' : 'WAL-AGY';
      const walletId = `${walletPrefix}-${Math.floor(100000 + Math.random() * 900000)}`;

      await tx.wallet.create({
        data: {
          walletId,
          userId: createdUser.id,
          accountType,
          balance: accountType === 'brand' ? 25000 : 0,
        },
      });

      if (accountType === 'brand') {
        await tx.brandTreasury.create({
          data: { userId: createdUser.id, balance: 25000 },
        });
      }

      return createdUser;
    });


    await this.auditLogsService.log({
      userId: user.id,
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      details: { email: user.email, accountType: user.accountType },
    });

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        accountType: user.accountType,
        agncyId: user.agncyId,
        kybStatus: user.kybStatus,
      },
      ...tokens,
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

    await this.auditLogsService.log({
      userId: user.id,
      action: 'USER_LOGGED_IN',
      entityType: 'User',
      entityId: user.id,
    });

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        accountType: user.accountType,
        agncyId: user.agncyId,
        kybStatus: user.kybStatus,
      },
      ...tokens,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) {
      // Don't reveal if user exists
      return { success: true, message: 'If an account exists with this email, password reset instructions have been sent.' };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.userRepo.update(user.id, { resetToken: hashedResetToken, resetTokenExpires });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
    });

    return {
      success: true,
      message: 'If an account exists with this email, password reset instructions have been sent.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hashedToken = crypto.createHash('sha256').update(dto.token).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { resetToken: hashedToken },
          { resetToken: dto.token }, // Fallback for pre-existing legacy tokens
        ],
        deletedAt: null,
      },
    });

    if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.userRepo.update(user.id, {
      password: hashedPassword,
      resetToken: null,
      resetTokenExpires: null,
    });

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
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const storedToken = await this.prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      await this.prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });

      return this.generateTokens(payload.sub, payload.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    await this.auditLogsService.log({
      userId,
      action: 'USER_LOGGED_OUT',
      entityType: 'User',
      entityId: userId,
    });
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_EXPIRATION') || '15m') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d') as any,
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}


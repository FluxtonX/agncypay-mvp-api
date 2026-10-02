import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountType,
  OrganizationRole,
  OrganizationType,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto, CreateInvitationDto } from './dto/invitation.dto';
import {
  ACCOUNT_TYPE_ROLES,
  ACCESS_PERMISSIONS,
  defaultRoleFor,
  permissionsForRole,
} from './access-policy';
import { AUTH_EMAIL_PROVIDER } from '../core/interfaces/auth-email-provider.interface';
import type { AuthEmailProvider } from '../core/interfaces/auth-email-provider.interface';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';

type AccessMetadata = {
  organizationRole?: OrganizationRole;
  permissions?: string[];
};

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(AUTH_EMAIL_PROVIDER)
    private readonly authEmailProvider: AuthEmailProvider,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private accountReference(accountType: AccountType): string {
    const prefixes: Record<AccountType, string> = {
      agency: 'AGY',
      brand: 'BRND',
      talent: 'TAL',
      platform: 'PLT',
    };
    return `${prefixes[accountType]}-${crypto.randomUUID()}`;
  }

  async create(invitedById: string, dto: CreateInvitationDto) {
    return this.createInternal(invitedById, dto);
  }

  async createForParticipant(
    invitedById: string,
    dto: CreateInvitationDto,
    participantId: string,
  ) {
    const relationship = await this.prisma.organizationParticipant.findFirst({
      where: {
        organizationId: dto.organizationId,
        participantId,
        status: 'active',
      },
    });
    if (!relationship) {
      throw new ForbiddenException(
        'Participant is not active in the inviting organization',
      );
    }
    return this.createInternal(invitedById, dto, participantId);
  }

  private async createInternal(
    invitedById: string,
    dto: CreateInvitationDto,
    participantId?: string,
  ) {
    const organization = await this.prisma.organization.findFirst({
      where: { id: dto.organizationId, status: 'active', deletedAt: null },
      include: {
        participants: {
          where: {
            status: 'active',
            participant: { users: { some: { userId: invitedById } } },
          },
        },
      },
    });
    if (!organization || organization.participants.length === 0) {
      throw new ForbiddenException('Organization not found or not accessible');
    }

    const inviterAccess = organization.participants.some((membership) => {
      const metadata = (membership.metadata ?? {}) as AccessMetadata;
      return (
        metadata.organizationRole === 'platform_admin' ||
        metadata.organizationRole === 'agency_owner' ||
        metadata.organizationRole === 'brand_admin' ||
        metadata.permissions?.includes(ACCESS_PERMISSIONS.MANAGE_TEAM)
      );
    });
    if (!inviterAccess) {
      throw new ForbiddenException(
        'The inviter cannot manage this organization',
      );
    }

    this.assertInvitationTypeAllowed(organization.type, dto.accountType);
    const role = this.resolveInvitationRole(
      organization.type,
      dto.accountType,
      dto.organizationRole,
    );
    const permissions = permissionsForRole(role);
    if (
      dto.permissions &&
      (dto.permissions.length !== permissions.length ||
        dto.permissions.some((permission) => !permissions.includes(permission)))
    ) {
      throw new BadRequestException(
        'Permissions are derived from the selected organization role',
      );
    }

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { participantLinks: true },
    });
    if (existingUser?.deletedAt) {
      throw new ConflictException(
        'This email belongs to a disabled account; contact support',
      );
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + (dto.expiresInHours ?? 168) * 60 * 60 * 1000,
    );
    const relationshipType = this.relationshipTypeFor(
      organization.type,
      dto.accountType,
      role,
    );

    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: {
          organizationId: dto.organizationId,
          email,
          status: 'pending',
        },
        data: { status: 'revoked' },
      });

      return tx.invitation.create({
        data: {
          organizationId: dto.organizationId,
          participantId:
            participantId ?? existingUser?.participantLinks[0]?.participantId,
          email,
          accountType: dto.accountType,
          relationshipType,
          organizationRole: role,
          permissions,
          tokenHash: this.hashToken(token),
          expiresAt,
          invitedById,
        },
      });
    });

    const delivery = await this.authEmailProvider.send({
      to: email,
      purpose: 'invitation',
      token,
      expiresAt,
      metadata: {
        invitationId: invitation.id,
        organizationId: organization.id,
        organizationName: dto.organizationName,
      },
    });
    await this.auditLogsService.log({
      userId: invitedById,
      organizationId: organization.id,
      action: 'INVITATION_CREATED',
      entityType: 'Invitation',
      entityId: invitation.id,
      details: {
        accountType: dto.accountType,
        organizationRole: role,
        deliveryId: delivery.id,
      },
    });

    return {
      invitationId: invitation.id,
      token,
      expiresAt,
      emailDelivery: delivery,
    };
  }

  private assertInvitationTypeAllowed(
    sponsorType: OrganizationType,
    targetType: CreateInvitationDto['accountType'],
  ): void {
    const allowed: Record<
      OrganizationType,
      CreateInvitationDto['accountType'][]
    > = {
      platform: ['agency', 'brand', 'talent'],
      agency: ['agency', 'brand', 'talent'],
      brand: ['brand'],
    };
    if (!allowed[sponsorType].includes(targetType)) {
      throw new BadRequestException(
        `${sponsorType} organizations cannot invite ${targetType} accounts`,
      );
    }
  }

  private resolveInvitationRole(
    sponsorType: OrganizationType,
    accountType: CreateInvitationDto['accountType'],
    requested?: OrganizationRole,
  ): OrganizationRole | undefined {
    if (accountType === 'talent') return undefined;
    const defaultRole =
      accountType === 'agency' && sponsorType === 'agency'
        ? 'agency_admin'
        : defaultRoleFor(accountType);
    const role = requested ?? defaultRole;
    if (!role || !ACCOUNT_TYPE_ROLES[accountType]?.includes(role)) {
      throw new BadRequestException(
        `Organization role is not valid for ${accountType}`,
      );
    }
    return role;
  }

  private relationshipTypeFor(
    sponsorType: OrganizationType,
    accountType: CreateInvitationDto['accountType'],
    role?: OrganizationRole,
  ): string {
    if (sponsorType === 'agency' && accountType === 'brand') {
      return 'agency_brand';
    }
    if (accountType === 'talent') return 'talent';
    return role ?? `${sponsorType}_${accountType}`;
  }

  async accept(dto: AcceptInvitationDto, currentUserId?: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.hashToken(dto.token) },
      include: { organization: true },
    });
    if (!invitation || invitation.status !== 'pending') {
      throw new NotFoundException(
        'Invitation is invalid or no longer available',
      );
    }
    if (invitation.expiresAt <= new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Invitation has expired');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
    });
    if (existingUser && currentUserId !== existingUser.id) {
      throw new UnauthorizedException(
        'Sign in as the invited user before accepting this invitation',
      );
    }
    if (!existingUser && (!dto.password || !dto.fullName?.trim())) {
      throw new BadRequestException(
        'Full name and password are required for a new invited user',
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const acceptedUser = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: { emailVerified: true, deletedAt: null },
          })
        : await tx.user.create({
            data: {
              email: invitation.email,
              password: await bcrypt.hash(dto.password!, 12),
              fullName: dto.fullName!.trim(),
              accountType: invitation.accountType,
              agncyId: this.accountReference(invitation.accountType),
              emailVerified: true,
            },
          });

      const existingLink = await tx.participantUser.findUnique({
        where: { userId: acceptedUser.id },
      });
      const participantId =
        invitation.participantId ?? existingLink?.participantId;
      const participant = participantId
        ? await tx.participant.update({
            where: { id: participantId },
            data: {
              displayName: acceptedUser.fullName,
              status: 'active',
              deletedAt: null,
            },
          })
        : await tx.participant.create({
            data: { displayName: acceptedUser.fullName },
          });
      await tx.participantUser.upsert({
        where: { userId: acceptedUser.id },
        update: { participantId: participant.id, isPrimary: true },
        create: {
          userId: acceptedUser.id,
          participantId: participant.id,
          isPrimary: true,
        },
      });

      const targetOrganizationId = await this.resolveTargetOrganization(
        tx,
        invitation,
        acceptedUser.id,
        participant.id,
      );
      if (targetOrganizationId) {
        await tx.organizationParticipant.upsert({
          where: {
            organizationId_participantId_relationshipType: {
              organizationId: targetOrganizationId,
              participantId: participant.id,
              relationshipType: invitation.relationshipType,
            },
          },
          update: {
            status: 'active',
            endsAt: null,
            metadata: {
              organizationRole: invitation.organizationRole,
              permissions: invitation.permissions,
            },
          },
          create: {
            organizationId: targetOrganizationId,
            participantId: participant.id,
            relationshipType: invitation.relationshipType,
            status: 'active',
            metadata: {
              organizationRole: invitation.organizationRole,
              permissions: invitation.permissions,
            },
          },
        });
      }

      if (
        invitation.accountType === 'brand' &&
        invitation.organization.type === 'agency' &&
        targetOrganizationId
      ) {
        await tx.organizationRelationship.upsert({
          where: {
            sourceOrganizationId_targetOrganizationId_relationshipType: {
              sourceOrganizationId: invitation.organizationId,
              targetOrganizationId,
              relationshipType: 'agency_brand',
            },
          },
          update: { status: 'active', endedAt: null },
          create: {
            sourceOrganizationId: invitation.organizationId,
            targetOrganizationId,
            relationshipType: 'agency_brand',
            status: 'active',
            originInvitationId: invitation.id,
          },
        });
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedById: acceptedUser.id,
          participantId: participant.id,
        },
      });
      return acceptedUser;
    });
  }

  private async resolveTargetOrganization(
    tx: Prisma.TransactionClient,
    invitation: Prisma.InvitationGetPayload<{
      include: { organization: true };
    }>,
    userId: string,
    participantId: string,
  ): Promise<string | undefined> {
    if (invitation.accountType === 'talent') {
      return invitation.organization.type === 'agency'
        ? invitation.organizationId
        : undefined;
    }

    if (invitation.organization.type === invitation.accountType) {
      return invitation.organizationId;
    }

    const existingOrganization = await tx.organization.findFirst({
      where: {
        type: invitation.accountType,
        participants: {
          some: { participantId, status: 'active' },
        },
      },
    });
    if (existingOrganization) return existingOrganization.id;

    const created = await tx.organization.create({
      data: {
        type: invitation.accountType,
        name: invitation.email.split('@')[0] || `Organization ${userId}`,
      },
    });
    return created.id;
  }
}

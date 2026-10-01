import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, OrganizationRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto, CreateInvitationDto } from './dto/invitation.dto';

@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  private invitationAccess(accountType: AccountType, dto: CreateInvitationDto) {
    const defaults: Partial<
      Record<AccountType, { role?: OrganizationRole; permissions: string[] }>
    > = {
      brand: {
        role: OrganizationRole.admin,
        permissions: ['approve_invoices', 'initiate_payments', 'view_reports'],
      },
      agency: {
        role: OrganizationRole.agency_admin,
        permissions: [
          'create_invoices',
          'approve_payouts',
          'manage_team',
          'view_reports',
        ],
      },
      talent: { permissions: [] },
    };
    const fallback = defaults[accountType] || { permissions: [] };
    return {
      organizationRole:
        (dto.organizationRole as OrganizationRole | undefined) || fallback.role,
      permissions: dto.permissions ?? fallback.permissions,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
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
      where: {
        id: dto.organizationId,
        status: 'active',
        participants: {
          some: {
            status: 'active',
            participant: { users: { some: { userId: invitedById } } },
          },
        },
      },
    });
    if (!organization) {
      throw new ForbiddenException('Organization not found or not accessible');
    }
    if (dto.accountType === 'brand' && organization.type !== 'agency') {
      throw new BadRequestException(
        'Brand invitations must originate from an Agency',
      );
    }

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { participantLinks: true },
    });
    if (existingUser && existingUser.accountType !== dto.accountType) {
      throw new ConflictException('Email belongs to a different account type');
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + (dto.expiresInHours ?? 168) * 60 * 60 * 1000,
    );
    const access = this.invitationAccess(dto.accountType as AccountType, dto);

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
          relationshipType: dto.relationshipType,
          organizationRole: access.organizationRole,
          permissions: access.permissions,
          tokenHash: this.hashToken(token),
          expiresAt,
          invitedById,
        },
      });
    });

    return { invitationId: invitation.id, token, expiresAt };
  }

  async accept(dto: AcceptInvitationDto) {
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

    const password = await bcrypt.hash(dto.password, 12);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let user = await tx.user.findUnique({
        where: { email: invitation.email },
      });
      if (user && user.accountType !== invitation.accountType) {
        throw new ConflictException(
          'Email belongs to a different account type',
        );
      }
      if (user) {
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            password,
            fullName: dto.fullName.trim(),
            emailVerified: true,
            deletedAt: null,
          },
        });
      } else {
        const prefix =
          invitation.accountType === 'brand'
            ? 'BRND'
            : invitation.accountType === 'agency'
              ? 'AGY'
              : 'TAL';
        user = await tx.user.create({
          data: {
            email: invitation.email,
            password,
            fullName: dto.fullName.trim(),
            accountType: invitation.accountType as AccountType,
            agncyId: `${prefix}-${crypto.randomInt(100000, 1000000)}`,
            emailVerified: true,
          },
        });
      }

      const existingLink = await tx.participantUser.findUnique({
        where: { userId: user.id },
      });
      const participantId =
        invitation.participantId ?? existingLink?.participantId ?? user.id;
      await tx.participant.upsert({
        where: { id: participantId },
        update: {
          displayName: user.fullName,
          status: 'active',
          deletedAt: null,
        },
        create: { id: participantId, displayName: user.fullName },
      });
      await tx.participantUser.upsert({
        where: { userId: user.id },
        update: { participantId, isPrimary: true },
        create: { userId: user.id, participantId, isPrimary: true },
      });
      await tx.organizationParticipant.upsert({
        where: {
          organizationId_participantId_relationshipType: {
            organizationId: invitation.organizationId,
            participantId,
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
          organizationId: invitation.organizationId,
          participantId,
          relationshipType: invitation.relationshipType,
          status: 'active',
          metadata: {
            organizationRole: invitation.organizationRole,
            permissions: invitation.permissions,
          },
        },
      });

      // A Brand is an organization in its own right, even though its portal
      // originates from an approved Agency invitation. Keep that organization
      // distinct from the human participant and persist the sponsoring link.
      if (invitation.accountType === 'brand') {
        await tx.organization.upsert({
          where: { id: user.id },
          update: {
            name: user.fullName,
            type: 'brand',
            status: 'active',
            deletedAt: null,
          },
          create: {
            id: user.id,
            name: user.fullName,
            type: 'brand',
            status: 'active',
          },
        });
        await tx.organizationParticipant.upsert({
          where: {
            organizationId_participantId_relationshipType: {
              organizationId: user.id,
              participantId,
              relationshipType: 'brand_admin',
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
            organizationId: user.id,
            participantId,
            relationshipType: 'brand_admin',
            status: 'active',
            metadata: {
              organizationRole: invitation.organizationRole,
              permissions: invitation.permissions,
            },
          },
        });
        if (invitation.organization.type !== 'agency') {
          throw new BadRequestException(
            'Brand invitations must originate from an Agency',
          );
        }
        await tx.organizationRelationship.upsert({
          where: {
            sourceOrganizationId_targetOrganizationId_relationshipType: {
              sourceOrganizationId: invitation.organizationId,
              targetOrganizationId: user.id,
              relationshipType: 'agency_brand',
            },
          },
          update: {
            status: 'active',
            originInvitationId: invitation.id,
            endedAt: null,
          },
          create: {
            sourceOrganizationId: invitation.organizationId,
            targetOrganizationId: user.id,
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
          acceptedById: user.id,
          participantId,
        },
      });
      return user;
    });
  }
}

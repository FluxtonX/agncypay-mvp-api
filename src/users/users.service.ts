import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
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

    const organizations = user.participantLinks.flatMap((link) =>
      link.participant.organizations.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        type: membership.organization.type,
        status: membership.organization.status,
        relationshipType: membership.relationshipType,
        metadata: membership.metadata,
      })),
    );
    const { participantLinks, ...profile } = user;
    return { ...profile, organizations };
  }

  async updateProfile(userId: string, data: { fullName?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        fullName: true,
        accountType: true,
        agncyId: true,
      },
    });
  }
}

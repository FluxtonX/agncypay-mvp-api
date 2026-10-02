import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountType, OrganizationRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACCOUNT_TYPES_KEY,
  ORGANIZATION_ROLES_KEY,
  PERMISSIONS_KEY,
} from '../decorators/authorization.decorator';
import { ACCOUNT_TYPE_ROLES } from '../access-policy';

type AuthenticatedRequest = {
  user?: {
    id: string;
    accountType: AccountType;
  };
};

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const accountTypes = this.reflector.getAllAndOverride<AccountType[]>(
      ACCOUNT_TYPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const roles = this.reflector.getAllAndOverride<OrganizationRole[]>(
      ORGANIZATION_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const permissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!accountTypes?.length && !roles?.length && !permissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user?.id) {
      throw new ForbiddenException('Authenticated user is required');
    }

    if (accountTypes?.length || roles?.length || permissions?.length) {
      const organizationAccess =
        await this.prisma.organizationParticipant.findMany({
          where: {
            status: 'active',
            participant: { users: { some: { userId: user.id } } },
          },
          select: { metadata: true, organizationId: true },
        });
      const canonicalAccess = organizationAccess.map((item) => {
        const metadata = (item.metadata || {}) as Record<string, unknown>;
        return {
          organizationId: item.organizationId,
          role: metadata.organizationRole as OrganizationRole | undefined,
          permissions: Array.isArray(metadata.permissions)
            ? metadata.permissions.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        };
      });
      const access = canonicalAccess;

      if (accountTypes?.length) {
        const personaAllowed = accountTypes.includes(user.accountType);
        const membershipAllowed = accountTypes.some((accountType) => {
          const allowedRoles = ACCOUNT_TYPE_ROLES[accountType] ?? [];
          return access.some(
            (item) => item.role && allowedRoles.includes(item.role),
          );
        });
        if (!personaAllowed && !membershipAllowed) {
          throw new ForbiddenException(
            'Account type is not authorized for this operation',
          );
        }
      }

      if (
        roles?.length &&
        !access.some((item) => item.role && roles.includes(item.role))
      ) {
        throw new ForbiddenException(
          'Organization role is not authorized for this operation',
        );
      }

      if (
        permissions?.length &&
        !access.some((item) =>
          permissions.every((permission) =>
            item.permissions.includes(permission),
          ),
        )
      ) {
        throw new ForbiddenException(
          'Required organization permission is missing',
        );
      }
    }

    return true;
  }
}

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationGuard } from './authorization.guard';

describe('AuthorizationGuard', () => {
  const contextFor = (user: Record<string, unknown>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('rejects an account type that is not allowed', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(['agency'])
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined),
    } as unknown as Reflector;
    const prisma = {
      organizationParticipant: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const guard = new AuthorizationGuard(reflector, prisma as any);

    await expect(
      guard.canActivate(contextFor({ id: 'brand-1', accountType: 'brand' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a user with the required active permission', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(['agency'])
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(['approve_payouts']),
    } as unknown as Reflector;
    const prisma = {
      organizationParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            metadata: {
              organizationRole: 'agency_admin',
              permissions: ['approve_payouts'],
            },
          },
        ]),
      },
    };
    const guard = new AuthorizationGuard(reflector, prisma as any);

    await expect(
      guard.canActivate(contextFor({ id: 'agency-1', accountType: 'agency' })),
    ).resolves.toBe(true);
    expect(prisma.organizationParticipant.findMany).toHaveBeenCalled();
  });

  it('rejects a missing workspace permission', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(['manage_team']),
    } as unknown as Reflector;
    const prisma = {
      organizationParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            metadata: {
              organizationRole: 'viewer',
              permissions: ['view_reports'],
            },
          },
        ]),
      },
    };
    const guard = new AuthorizationGuard(reflector, prisma as any);

    await expect(
      guard.canActivate(contextFor({ id: 'viewer-1', accountType: 'agency' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts permissions persisted on a canonical organization relationship', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(['brand'])
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(['initiate_payments']),
    } as unknown as Reflector;
    const prisma = {
      organizationParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            metadata: {
              organizationRole: 'admin',
              permissions: ['initiate_payments'],
            },
          },
        ]),
      },
    };
    const guard = new AuthorizationGuard(reflector, prisma as any);

    await expect(
      guard.canActivate(contextFor({ id: 'brand-1', accountType: 'brand' })),
    ).resolves.toBe(true);
  });

  it('allows a user to use an additional Brand persona through membership', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(['brand'])
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(['initiate_payments']),
    } as unknown as Reflector;
    const prisma = {
      organizationParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            organizationId: 'brand-org',
            metadata: {
              organizationRole: 'brand_admin',
              permissions: ['initiate_payments'],
            },
          },
        ]),
      },
    };
    const guard = new AuthorizationGuard(reflector, prisma as any);

    await expect(
      guard.canActivate(
        contextFor({ id: 'agency-primary', accountType: 'agency' }),
      ),
    ).resolves.toBe(true);
  });

  it('allows routes without authorization metadata', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new AuthorizationGuard(reflector, {} as any);

    await expect(
      guard.canActivate(contextFor({ id: 'user-1', accountType: 'talent' })),
    ).resolves.toBe(true);
  });
});

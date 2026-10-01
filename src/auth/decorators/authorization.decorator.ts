import { SetMetadata } from '@nestjs/common';
import { AccountType, OrganizationRole } from '@prisma/client';

export const ACCOUNT_TYPES_KEY = 'authorization:account-types';
export const ORGANIZATION_ROLES_KEY = 'authorization:organization-roles';
export const PERMISSIONS_KEY = 'authorization:permissions';

export const AccountTypes = (...types: AccountType[]) =>
  SetMetadata(ACCOUNT_TYPES_KEY, types);

export const OrganizationRoles = (...roles: OrganizationRole[]) =>
  SetMetadata(ORGANIZATION_ROLES_KEY, roles);

export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

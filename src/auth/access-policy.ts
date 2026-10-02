import { AccountType, OrganizationRole } from '@prisma/client';

export const ACCESS_PERMISSIONS = {
  MANAGE_TEAM: 'manage_team',
  MANAGE_INTEGRATIONS: 'manage_integrations',
  VIEW_REPORTS: 'view_reports',
  APPROVE_PAYOUTS: 'approve_payouts',
  INITIATE_PAYMENTS: 'initiate_payments',
  PLATFORM_ADMIN: 'platform_admin',
} as const;

export const ROLE_PERMISSIONS: Partial<
  Record<OrganizationRole, readonly string[]>
> = {
  platform_admin: [
    ACCESS_PERMISSIONS.PLATFORM_ADMIN,
    ACCESS_PERMISSIONS.MANAGE_TEAM,
    ACCESS_PERMISSIONS.MANAGE_INTEGRATIONS,
    ACCESS_PERMISSIONS.VIEW_REPORTS,
    ACCESS_PERMISSIONS.APPROVE_PAYOUTS,
    ACCESS_PERMISSIONS.INITIATE_PAYMENTS,
  ],
  agency_owner: [
    ACCESS_PERMISSIONS.MANAGE_TEAM,
    ACCESS_PERMISSIONS.MANAGE_INTEGRATIONS,
    ACCESS_PERMISSIONS.VIEW_REPORTS,
    ACCESS_PERMISSIONS.APPROVE_PAYOUTS,
  ],
  agency_admin: [
    ACCESS_PERMISSIONS.MANAGE_TEAM,
    ACCESS_PERMISSIONS.MANAGE_INTEGRATIONS,
    ACCESS_PERMISSIONS.VIEW_REPORTS,
  ],
  agency_finance: [ACCESS_PERMISSIONS.VIEW_REPORTS],
  agency_viewer: [ACCESS_PERMISSIONS.VIEW_REPORTS],
  brand_admin: [
    ACCESS_PERMISSIONS.MANAGE_TEAM,
    ACCESS_PERMISSIONS.VIEW_REPORTS,
    ACCESS_PERMISSIONS.INITIATE_PAYMENTS,
  ],
  brand_finance: [
    ACCESS_PERMISSIONS.VIEW_REPORTS,
    ACCESS_PERMISSIONS.INITIATE_PAYMENTS,
  ],
  brand_viewer: [ACCESS_PERMISSIONS.VIEW_REPORTS],
};

export const ACCOUNT_TYPE_ROLES: Partial<
  Record<AccountType, readonly OrganizationRole[]>
> = {
  platform: ['platform_admin'],
  agency: [
    'agency_owner',
    'agency_admin',
    'agency_finance',
    'agency_viewer',
    // Temporary compatibility role.
    'finance_manager',
  ],
  brand: ['brand_admin', 'brand_finance', 'brand_viewer', 'admin', 'finance'],
  talent: [],
};

export function permissionsForRole(role?: OrganizationRole): string[] {
  return role ? [...(ROLE_PERMISSIONS[role] ?? [])] : [];
}

export function defaultRoleFor(
  accountType: AccountType,
): OrganizationRole | undefined {
  switch (accountType) {
    case 'platform':
      return 'platform_admin';
    case 'agency':
      return 'agency_owner';
    case 'brand':
      return 'brand_admin';
    default:
      return undefined;
  }
}

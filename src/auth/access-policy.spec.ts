import { ACCOUNT_TYPE_ROLES, permissionsForRole } from './access-policy';

describe('Phase 1 access policy', () => {
  it('limits Agency financial approval to the Agency Owner role', () => {
    expect(permissionsForRole('agency_owner')).toContain('approve_payouts');
    expect(permissionsForRole('agency_admin')).not.toContain('approve_payouts');
    expect(permissionsForRole('agency_finance')).not.toContain(
      'approve_payouts',
    );
    expect(permissionsForRole('agency_viewer')).not.toContain(
      'approve_payouts',
    );
  });

  it('maps additional organization personas independently of signup persona', () => {
    expect(ACCOUNT_TYPE_ROLES.brand).toEqual(
      expect.arrayContaining(['brand_admin', 'brand_finance', 'brand_viewer']),
    );
    expect(ACCOUNT_TYPE_ROLES.agency).toEqual(
      expect.arrayContaining([
        'agency_owner',
        'agency_admin',
        'agency_finance',
        'agency_viewer',
      ]),
    );
  });
});

export interface ConduitCustomerParams {
  name: string;
  email: string;
  type: 'individual' | 'business';
  country?: string;
  taxId?: string;
  metadata?: Record<string, any>;
}

export interface ConduitCustomer {
  id: string;
  name: string;
  email: string;
  type: string;
  status: 'pending' | 'verified' | 'approved' | 'rejected';
  createdAt: string;
}

export interface ConduitOnboardingApplicationParams {
  clientReferenceId: string;
  businessInfo: {
    legalName: string;
    tradeName?: string;
    taxId: string;
    country: string;
    website?: string;
    industry?: string;
    phone?: string;
    email?: string;
    address?: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
  };
  ownership?: {
    persons: Array<{
      referenceId?: string;
      firstName: string;
      lastName: string;
      email: string;
      roles: string[];
      taxId?: string;
      dob?: string;
      phone?: string;
      address?: {
        line1: string;
        city: string;
        state: string;
        postalCode: string;
        country: string;
      };
    }>;
  };
}

export interface ConduitOnboardingApplicationResponse {
  id: string;
  clientReferenceId?: string;
  status: 'pending' | 'processing' | 'approved' | 'rejected' | 'cancelled';
  customerId?: string;
  failureMessage?: string;
  resubmittable?: boolean;
  createdAt: string;
}

export interface ConduitVirtualAccountParams {
  customerId: string;
  asset?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ConduitVirtualAccount {
  id: string;
  customerId: string;
  accountNumber: string;
  routingNumber: string;
  bankName: string;
  beneficiaryName?: string;
  currency: string;
  status: string;
}

export interface ConduitRecipientParams {
  customerId: string;
  name: string;
  type?: 'individual' | 'business';
  payoutRail?: 'ach' | 'wire' | 'rtp' | 'crypto';
  accountNumber?: string;
  routingNumber?: string;
  bankName?: string;
  walletAddress?: string;
  metadata?: Record<string, any>;
}

export interface ConduitRecipient {
  id: string;
  customerId: string;
  name: string;
  recipientType: string;
  status: 'active' | 'pending_review' | 'rejected';
  payoutRail: string;
  accountNumberMask?: string;
  routingNumber?: string;
  walletAddress?: string;
  createdAt: string;
}

export interface ConduitPayoutParams {
  customerId: string;
  sourceAccountId?: string;
  beneficiaryId?: string;
  recipientId?: string;
  amount: number;
  currency: string;
  purpose?: string;
  reference?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface ConduitPayoutResponse {
  id: string;
  status:
    'created' | 'pending' | 'processing' | 'settled' | 'completed' | 'failed';
  amount: number;
  currency: string;
  reference?: string;
  failureReason?: string;
  createdAt: string;
  settledAt?: string;
}

export interface ConduitTransferParams extends ConduitPayoutParams {}
export interface ConduitTransfer extends ConduitPayoutResponse {}
export interface ConduitBeneficiaryParams extends ConduitRecipientParams {
  accountHolderName?: string;
}
export interface ConduitBeneficiary extends ConduitRecipient {
  accountHolderName?: string;
}

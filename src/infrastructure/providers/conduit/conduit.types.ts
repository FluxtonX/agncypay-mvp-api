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
  status: 'pending' | 'verified' | 'rejected';
  createdAt: string;
}

export interface ConduitBeneficiaryParams {
  customerId: string;
  accountHolderName: string;
  accountNumber: string;
  routingNumber: string;
  currency?: string;
  accountType?: 'checking' | 'savings';
  country?: string;
  metadata?: Record<string, any>;
}

export interface ConduitBeneficiary {
  id: string;
  customerId: string;
  accountHolderName: string;
  bankName?: string;
  accountNumberMask: string;
  status: 'active' | 'pending' | 'failed';
  createdAt: string;
}

export interface ConduitTransferParams {
  sourceAccountId?: string;
  beneficiaryId: string;
  amount: number;
  currency: string;
  reference?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface ConduitTransfer {
  id: string;
  status: 'created' | 'pending' | 'processing' | 'completed' | 'failed';
  amount: number;
  currency: string;
  sourceAccountId?: string;
  beneficiaryId: string;
  reference?: string;
  fee?: number;
  failureReason?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ConduitVirtualAccount {
  id: string;
  customerId: string;
  accountNumber: string;
  routingNumber: string;
  bankName: string;
  currency: string;
  status: string;
}

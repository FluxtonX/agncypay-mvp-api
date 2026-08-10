export interface SyncedInvoice {
  id: string;
  docNumber: string;
  name: string;
  amount: number;
  dueDate: string;
  status: string;
  raw?: any;
}

export interface IAccountingIntegrationProvider {
  getAuthUrl(): Promise<string>;
  handleCallback(code: string, realmId?: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }>;
  getInvoices(accessToken: string, realmId?: string): Promise<SyncedInvoice[]>;
  getPayouts?(accessToken: string, realmId?: string): Promise<any[]>;
  getVendors?(accessToken: string, realmId?: string): Promise<any[]>;
}

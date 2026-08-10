export interface ACHPaymentRequest {
  invoiceId: string;
  amount: number;
  currency: string;
  payerUserId: string;
  recipientUserId: string;
  accountNumber?: string;
  routingNumber?: string;
  paymentType?: 'ach' | 'wire' | 'rtp';
  metadata?: Record<string, any>;
}

export interface ACHPaymentResponse {
  paymentOrderId: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'returned' | 'cancelled';
  counterpartyId?: string;
  details?: Record<string, any>;
}

export interface IPaymentProvider {
  processACHPayment(request: ACHPaymentRequest): Promise<ACHPaymentResponse>;
  getPaymentStatus(paymentOrderId: string): Promise<ACHPaymentResponse>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}


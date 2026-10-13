export interface ProviderTransferInstruction {
  account: string;
  amount: number;
  currency: "INR";
  on_hold?: boolean;
  notes?: Record<string, string>;
  linked_account_notes?: string[];
}
export interface CreatePaymentInput {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
  transfers?: ProviderTransferInstruction[];
}
export interface ProviderTransfer {
  id: string;
  source?: string;
  recipient?: string;
  amount: number;
  currency: string;
  status: string;
  amount_reversed?: number;
  fees?: number;
  tax?: number;
  settlement_status?: string | null;
  recipient_settlement_id?: string | null;
  processed_at?: number;
  error?: Record<string, unknown> | null;
}
export interface ProviderPaymentOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  transfers?: ProviderTransfer[];
}
export interface ProviderRefund {
  id: string;
  payment_id?: string;
  paymentId?: string;
  amount: number;
  currency?: string;
  status: string;
  receipt?: string | null;
  notes?: Record<string, string>;
}
export interface ProviderLinkedAccount {
  id: string;
  type?: string;
  reference_id?: string;
  status?: string;
  legal_business_name?: string;
  business_type?: string;
  email?: string;
  phone?: string | number;
}
export interface ProviderProductConfiguration {
  id: string;
  account_id?: string;
  product_name?: string;
  activation_status?: string;
  requirements?: Array<{ status?: string; reason_code?: string }>;
  tnc?: { accepted?: boolean; accepted_at?: number };
  active_configuration?: Record<string, any>;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<ProviderPaymentOrder>;
  verifyCheckout(input: { orderId: string; paymentId: string; signature: string }): boolean;
  getPaymentStatus(paymentId: string): Promise<Record<string, unknown>>;
  refundPayment(
    paymentId: string,
    amountMinor: number,
    receipt: string,
    options?: { reverseAll?: boolean },
  ): Promise<ProviderRefund>;
  getPaymentRefunds(paymentId: string): Promise<ProviderRefund[]>;
  getOrderTransfers(orderId: string): Promise<ProviderTransfer[]>;
  getTransfersForSettlement(settlementId: string): Promise<ProviderTransfer[]>;
  getTransfer(transferId: string): Promise<ProviderTransfer>;
  getLinkedAccount(accountId: string): Promise<ProviderLinkedAccount>;
  getProductConfiguration(
    accountId: string,
    productId: string,
  ): Promise<ProviderProductConfiguration>;
  reverseTransfer(
    transferId: string,
    amountMinor: number,
    receipt: string,
  ): Promise<Record<string, unknown>>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

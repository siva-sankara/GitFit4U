export interface CreatePaymentInput { amountMinor: number; currency: string; receipt: string; notes?: Record<string, string>; }
export interface ProviderPaymentOrder { id: string; amount: number; currency: string; status: string; }
export interface ProviderRefund { id: string; paymentId: string; amount: number; status: string; }

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<ProviderPaymentOrder>;
  verifyCheckout(input: { orderId: string; paymentId: string; signature: string }): boolean;
  getPaymentStatus(paymentId: string): Promise<Record<string, unknown>>;
  refundPayment(paymentId: string, amountMinor: number, receipt: string): Promise<ProviderRefund>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

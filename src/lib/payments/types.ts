export type PaymentProvider = "freekassa" | "cryptomus" | "cispay";

export type FreeKassaMethod = "card" | "visa" | "mastercard" | "mir" | "sbp";
export type CisPayMethod = "card" | "sbp";

export interface CreatePaymentRequest {
  provider: PaymentProvider;
  planId: string;
  email?: string;
  method?: FreeKassaMethod | CisPayMethod;
  customerId?: string;
  recurrent?: boolean;
  recurrentPeriod?: "day" | "week" | "month" | "year";
}

export interface PaymentCheckout {
  provider: PaymentProvider;
  orderId: string;
  checkoutUrl: string;
  providerPaymentId?: string;
  rawStatus?: string;
}

export interface VerifiedPaymentEvent {
  provider: PaymentProvider;
  orderId: string;
  status: string;
  paid: boolean;
  amount?: string;
  currency?: string;
  providerPaymentId?: string;
  txid?: string;
}

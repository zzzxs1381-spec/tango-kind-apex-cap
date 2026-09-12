export type PaymentProvider = "freekassa" | "cryptomus";

export type FreeKassaMethod = "card" | "visa" | "mastercard" | "mir" | "sbp";

export interface CreatePaymentRequest {
  provider: PaymentProvider;
  orderId: string;
  amount: number;
  currency?: string;
  email?: string;
  method?: FreeKassaMethod;
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

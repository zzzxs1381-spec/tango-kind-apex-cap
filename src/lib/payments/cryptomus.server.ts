import { createHash, timingSafeEqual } from "node:crypto";

import type { PaymentCheckout, VerifiedPaymentEvent } from "./types";

const CRYPTOMUS_API = "https://api.cryptomus.com/v1";
const CRYPTOMUS_WEBHOOK_IP = "91.227.144.54";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function cryptomusSign(jsonBody: string, apiKey: string): string {
  return md5(`${Buffer.from(jsonBody).toString("base64")}${apiKey}`);
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function createCryptomusPayment(input: {
  orderId: string;
  amount: number;
  currency: string;
  callbackBaseUrl: string;
}): Promise<PaymentCheckout> {
  const merchant = requireEnv("XF_CRYPTOMUS_MERCHANT_ID");
  const apiKey = requireEnv("XF_CRYPTOMUS_PAYMENT_API_KEY");
  const baseUrl = input.callbackBaseUrl.replace(/\/$/, "");

  const payload = {
    amount: input.amount.toFixed(2),
    currency: input.currency.toUpperCase(),
    order_id: input.orderId,
    url_callback: `${baseUrl}/api/payments/cryptomus-webhook`,
    url_return: `${baseUrl}/app/`,
    url_success: `${baseUrl}/app/`,
    is_payment_multiple: false,
  };
  const json = JSON.stringify(payload);

  const response = await fetch(`${CRYPTOMUS_API}/payment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      merchant,
      sign: cryptomusSign(json, apiKey),
    },
    body: json,
  });

  const data = (await response.json()) as {
    state?: number;
    result?: { uuid?: string; url?: string; status?: string };
    message?: string;
    errors?: unknown;
  };

  if (!response.ok || data.state !== 0 || !data.result?.url) {
    throw new Error(`Cryptomus create payment failed: ${data.message ?? JSON.stringify(data.errors ?? response.status)}`);
  }

  return {
    provider: "cryptomus",
    orderId: input.orderId,
    checkoutUrl: data.result.url,
    providerPaymentId: data.result.uuid,
    rawStatus: data.result.status,
  };
}

export function verifyCryptomusWebhook(data: Record<string, unknown>): VerifiedPaymentEvent {
  const apiKey = requireEnv("XF_CRYPTOMUS_PAYMENT_API_KEY");
  const incomingSign = typeof data.sign === "string" ? data.sign : "";
  if (!incomingSign) throw new Error("Cryptomus webhook is missing sign");

  const unsigned = { ...data };
  delete unsigned.sign;

  // Cryptomus signs PHP json_encode output; PHP escapes forward slashes by default.
  const canonicalJson = JSON.stringify(unsigned).replace(/\//g, "\\/");
  const expected = cryptomusSign(canonicalJson, apiKey);
  if (!safeEqual(expected, incomingSign)) throw new Error("Invalid Cryptomus webhook signature");

  const orderId = typeof data.order_id === "string" ? data.order_id : "";
  const status = typeof data.status === "string" ? data.status : "unknown";
  if (!orderId) throw new Error("Cryptomus webhook is missing order_id");

  return {
    provider: "cryptomus",
    orderId,
    status,
    paid: status === "paid" || status === "paid_over",
    amount: typeof data.payment_amount === "string" ? data.payment_amount : undefined,
    currency: typeof data.payer_currency === "string" ? data.payer_currency : undefined,
    providerPaymentId: typeof data.uuid === "string" ? data.uuid : undefined,
    txid: typeof data.txid === "string" ? data.txid : undefined,
  };
}

export function isCryptomusWebhookIpAllowed(ip: string | undefined): boolean {
  if (process.env.XF_CRYPTOMUS_ENFORCE_WEBHOOK_IP !== "1") return true;
  return ip === CRYPTOMUS_WEBHOOK_IP;
}

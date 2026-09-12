import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { FreeKassaMethod, PaymentCheckout, VerifiedPaymentEvent } from "./types";

const FK_API_BASE = "https://api.fk.life/v1";
let lastNonce = 0;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function nextNonce(): number {
  const now = Date.now();
  lastNonce = Math.max(now, lastNonce + 1);
  return lastNonce;
}

function signApiPayload(payload: Record<string, string | number>): string {
  const apiKey = requireEnv("XF_FK_API_KEY");
  const message = Object.keys(payload)
    .sort()
    .map((key) => String(payload[key]))
    .join("|");
  return createHmac("sha256", apiKey).update(message).digest("hex");
}

function methodId(method: FreeKassaMethod): number {
  const defaults: Record<FreeKassaMethod, string> = {
    card: "4",
    visa: "4",
    mastercard: "8",
    mir: "12",
    sbp: "42",
  };
  const envNames: Record<FreeKassaMethod, string> = {
    card: "XF_FK_CARD_METHOD_ID",
    visa: "XF_FK_VISA_METHOD_ID",
    mastercard: "XF_FK_MASTERCARD_METHOD_ID",
    mir: "XF_FK_MIR_METHOD_ID",
    sbp: "XF_FK_SBP_METHOD_ID",
  };
  const parsed = Number.parseInt(process.env[envNames[method]] ?? defaults[method], 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid FreeKassa method id for ${method}`);
  return parsed;
}

export async function createFreeKassaPayment(input: {
  orderId: string;
  amount: number;
  email: string;
  ip: string;
  method: FreeKassaMethod;
  recurrent?: boolean;
  recurrentPeriod?: "day" | "week" | "month" | "year";
}): Promise<PaymentCheckout> {
  const shopId = Number.parseInt(requireEnv("XF_FK_SHOP_ID"), 10);
  if (!Number.isInteger(shopId) || shopId <= 0) throw new Error("XF_FK_SHOP_ID must be a positive integer");

  const payload: Record<string, string | number> = {
    shopId,
    nonce: nextNonce(),
    paymentId: input.orderId,
    i: methodId(input.method),
    email: input.email,
    ip: input.ip,
    amount: input.amount.toFixed(2),
    currency: "RUB",
  };

  if (input.recurrent) {
    payload.recurrent = "Y";
    payload.recurrent_period = input.recurrentPeriod ?? "month";
    payload.recurrent_description = "XFreedom VPN subscription";
  }

  const response = await fetch(`${FK_API_BASE}/orders/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, signature: signApiPayload(payload) }),
  });

  const data = (await response.json()) as {
    type?: string;
    orderId?: number | string;
    location?: string;
    message?: string;
    error?: string;
  };

  if (!response.ok || data.type !== "success" || !data.location) {
    throw new Error(`FreeKassa create order failed: ${data.message ?? data.error ?? response.status}`);
  }

  return {
    provider: "freekassa",
    orderId: input.orderId,
    checkoutUrl: data.location,
    providerPaymentId: data.orderId ? String(data.orderId) : undefined,
    rawStatus: data.type,
  };
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left.toLowerCase(), "hex"), Buffer.from(right.toLowerCase(), "hex"));
}

export function verifyFreeKassaWebhook(data: Record<string, string>): VerifiedPaymentEvent {
  const merchantId = requireEnv("XF_FK_SHOP_ID");
  const secret2 = requireEnv("XF_FK_SECRET2");
  const incomingMerchant = data.MERCHANT_ID;
  const amount = data.AMOUNT;
  const orderId = data.MERCHANT_ORDER_ID;
  const sign = data.SIGN;

  if (!incomingMerchant || !amount || !orderId || !sign) throw new Error("Malformed FreeKassa webhook");
  if (incomingMerchant !== merchantId) throw new Error("FreeKassa merchant id mismatch");

  const expected = createHash("md5")
    .update(`${incomingMerchant}:${amount}:${secret2}:${orderId}`)
    .digest("hex");

  if (!safeEqualHex(expected, sign)) throw new Error("Invalid FreeKassa webhook signature");

  return {
    provider: "freekassa",
    orderId,
    status: "paid",
    paid: true,
    amount,
    currency: data.CUR_ID ?? data.CURRENCY ?? "RUB",
    providerPaymentId: data.intid,
  };
}

export function isFreeKassaWebhookIpAllowed(ip: string | undefined): boolean {
  const configured = process.env.XF_FK_WEBHOOK_IPS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (configured.length === 0) return true;
  return Boolean(ip && configured.includes(ip));
}

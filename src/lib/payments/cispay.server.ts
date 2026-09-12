import { createHmac, timingSafeEqual } from "node:crypto";

import type { CisPayMethod, PaymentCheckout, VerifiedPaymentEvent } from "./types";

const CISPAY_API = "https://api.cispay.app";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left.toLowerCase(), "hex"), Buffer.from(right.toLowerCase(), "hex"));
}

export async function createCisPayPayment(input: {
  orderId: string;
  amountRub: number;
  method: CisPayMethod;
  customerId?: string;
  returnBaseUrl: string;
}): Promise<PaymentCheckout> {
  const shopId = requireEnv("XF_CISPAY_SHOP_ID");
  const apiKey = requireEnv("XF_CISPAY_API_KEY");
  const returnBaseUrl = input.returnBaseUrl.replace(/\/$/, "");
  const payload: Record<string, string | number> = {
    amount: Math.round(input.amountRub * 100),
    order_id: input.orderId,
    payment_method: input.method.toUpperCase(),
    redirect_success_url: `${returnBaseUrl}/app/`,
    redirect_fail_url: `${returnBaseUrl}/app/`,
  };
  if (input.method === "sbp") {
    payload.customer_id = input.customerId?.trim() || input.orderId;
  }

  const response = await fetch(`${CISPAY_API}/payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shop-ID": shopId,
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as {
    id?: string;
    order_id?: string;
    status?: string;
    payment_url?: string;
    detail?: string;
  };
  if (!response.ok || !data.payment_url || !data.id) {
    throw new Error(`cisPay create payment failed: ${data.detail ?? response.status}`);
  }
  if (data.order_id && data.order_id !== input.orderId) {
    throw new Error("cisPay returned mismatched order id");
  }
  return {
    provider: "cispay",
    orderId: input.orderId,
    checkoutUrl: data.payment_url,
    providerPaymentId: data.id,
    rawStatus: data.status,
  };
}

export function verifyCisPayWebhook(rawBody: string, signature: string | undefined): VerifiedPaymentEvent {
  const apiKey = requireEnv("XF_CISPAY_API_KEY");
  if (!signature) throw new Error("cisPay webhook is missing X-Signature");
  const expected = createHmac("sha256", apiKey).update(rawBody).digest("hex");
  if (!safeEqualHex(expected, signature)) throw new Error("Invalid cisPay webhook signature");

  const data = JSON.parse(rawBody) as Record<string, unknown>;
  const configuredShopId = requireEnv("XF_CISPAY_SHOP_ID");
  if (typeof data.store_id === "string" && data.store_id !== configuredShopId) {
    throw new Error("cisPay store id mismatch");
  }
  const orderId = typeof data.order_id === "string" ? data.order_id : "";
  const status = typeof data.status === "string" ? data.status : "unknown";
  const amountKopecks = typeof data.amount === "number" ? data.amount : Number(data.amount);
  if (!orderId || !Number.isFinite(amountKopecks) || amountKopecks <= 0) {
    throw new Error("Malformed cisPay webhook");
  }

  return {
    provider: "cispay",
    orderId,
    status: status.toLowerCase(),
    paid: status === "PAID",
    amount: (amountKopecks / 100).toFixed(2),
    currency: typeof data.currency === "string" ? data.currency : "RUB",
    providerPaymentId: typeof data.id === "string" ? data.id : undefined,
  };
}

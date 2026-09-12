import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineHandler, getRequestIP, getRequestURL, readBody } from "nitro/h3";

import { createCryptomusPayment } from "@/lib/payments/cryptomus.server";
import { createFreeKassaPayment } from "@/lib/payments/freekassa.server";
import {
  attachCheckout,
  createPaymentOrder,
  markProviderError,
} from "@/lib/payments/ledger.server";
import { getPaymentPlan, paymentPlansConfigured } from "@/lib/payments/plans.server";

const schema = z.object({
  provider: z.enum(["freekassa", "cryptomus"]),
  planId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  email: z.string().email().optional(),
  method: z.enum(["card", "visa", "mastercard", "mir", "sbp"]).optional(),
  recurrent: z.boolean().optional(),
  recurrentPeriod: z.enum(["day", "week", "month", "year"]).optional(),
});

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default defineHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event));
  if (!parsed.success) return jsonError("Invalid payment request");
  if (!paymentPlansConfigured()) return jsonError("Payment plans are not configured", 503);

  const input = parsed.data;
  const plan = getPaymentPlan(input.planId);
  if (!plan) return jsonError("Unknown payment plan");

  const orderId = `xf_${randomUUID().replace(/-/g, "")}`;
  const amount = input.provider === "freekassa" ? plan.rubAmount : plan.cryptoAmount;
  const currency = input.provider === "freekassa" ? "RUB" : plan.cryptoCurrency;

  await createPaymentOrder({
    id: orderId,
    provider: input.provider,
    planId: plan.id,
    amount,
    currency,
  });

  let providerOrderCreated = false;
  try {
    if (input.provider === "freekassa") {
      if (!input.email) return jsonError("Email is required for FreeKassa");

      const ip = getRequestIP(event, { xForwardedFor: true }) ?? "127.0.0.1";
      const checkout = await createFreeKassaPayment({
        orderId,
        amount,
        email: input.email,
        ip,
        method: input.method ?? "sbp",
        recurrent: input.recurrent,
        recurrentPeriod: input.recurrentPeriod,
      });
      providerOrderCreated = true;
      await attachCheckout(checkout);
      return { ok: true, checkout };
    }

    const requestUrl = getRequestURL(event, { xForwardedHost: true });
    const callbackBaseUrl = (process.env.XF_PUBLIC_BASE_URL?.trim() || requestUrl.origin).replace(/\/$/, "");
    const checkout = await createCryptomusPayment({
      orderId,
      amount,
      currency,
      callbackBaseUrl,
    });
    providerOrderCreated = true;
    await attachCheckout(checkout);
    return { ok: true, checkout };
  } catch (error) {
    if (!providerOrderCreated) await markProviderError(orderId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Payment provider error";
    console.error("payment-create-failed", { provider: input.provider, orderId, message });
    return jsonError("Payment provider is temporarily unavailable", 502);
  }
});

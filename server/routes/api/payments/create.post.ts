import { z } from "zod";
import { defineHandler, getRequestIP, getRequestURL, readBody } from "nitro/h3";

import { createCryptomusPayment } from "@/lib/payments/cryptomus.server";
import { createFreeKassaPayment } from "@/lib/payments/freekassa.server";

const schema = z.object({
  provider: z.enum(["freekassa", "cryptomus"]),
  orderId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  amount: z.number().positive().max(1_000_000),
  currency: z.string().regex(/^[A-Za-z]{3,10}$/).optional(),
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

  const input = parsed.data;

  try {
    if (input.provider === "freekassa") {
      if (!input.email) return jsonError("Email is required for FreeKassa");
      if (input.currency && input.currency.toUpperCase() !== "RUB") {
        return jsonError("FreeKassa checkout is configured for RUB payments");
      }

      const ip = getRequestIP(event, { xForwardedFor: true }) ?? "127.0.0.1";
      const checkout = await createFreeKassaPayment({
        orderId: input.orderId,
        amount: input.amount,
        email: input.email,
        ip,
        method: input.method ?? "sbp",
        recurrent: input.recurrent,
        recurrentPeriod: input.recurrentPeriod,
      });
      return { ok: true, checkout };
    }

    const requestUrl = getRequestURL(event, { xForwardedHost: true });
    const callbackBaseUrl = (process.env.XF_PUBLIC_BASE_URL?.trim() || requestUrl.origin).replace(/\/$/, "");
    const checkout = await createCryptomusPayment({
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency ?? "USD",
      callbackBaseUrl,
    });
    return { ok: true, checkout };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment provider error";
    console.error("payment-create-failed", { provider: input.provider, orderId: input.orderId, message });
    return jsonError("Payment provider is temporarily unavailable", 502);
  }
});

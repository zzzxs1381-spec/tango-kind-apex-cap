import { defineHandler, getHeader, readRawBody } from "nitro/h3";

import { verifyCisPayWebhook } from "@/lib/payments/cispay.server";
import { recordVerifiedPaymentEvent } from "@/lib/payments/ledger.server";

export default defineHandler(async (event) => {
  try {
    const rawBody = await readRawBody(event, "utf8");
    if (!rawBody) throw new Error("Empty cisPay webhook body");
    const signature = getHeader(event, "x-signature");
    const paymentEvent = verifyCisPayWebhook(rawBody, signature);
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : "no-ts";
    const eventKey = [
      paymentEvent.providerPaymentId ?? paymentEvent.orderId,
      paymentEvent.status,
      timestamp,
    ].join(":");

    await recordVerifiedPaymentEvent({
      event: paymentEvent,
      eventKey,
      rawPayload: parsed,
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("cispay-webhook-failed", { message });
    return new Response(JSON.stringify({ ok: false }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
});

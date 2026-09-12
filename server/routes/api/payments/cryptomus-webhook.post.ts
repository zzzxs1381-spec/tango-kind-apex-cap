import { defineHandler, getRequestIP, readBody } from "nitro/h3";

import {
  isCryptomusWebhookIpAllowed,
  verifyCryptomusWebhook,
} from "@/lib/payments/cryptomus.server";
import { recordVerifiedPaymentEvent } from "@/lib/payments/ledger.server";

export default defineHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true });
  if (!isCryptomusWebhookIpAllowed(ip)) {
    console.warn("cryptomus-webhook-rejected-ip", { ip });
    return new Response(JSON.stringify({ ok: false }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const body = await readBody(event);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Malformed Cryptomus webhook");
    }

    const rawPayload = body as Record<string, unknown>;
    const paymentEvent = verifyCryptomusWebhook(rawPayload);
    const eventKey = [
      paymentEvent.providerPaymentId ?? paymentEvent.orderId,
      paymentEvent.status,
      paymentEvent.txid ?? "no-txid",
    ].join(":");

    await recordVerifiedPaymentEvent({
      event: paymentEvent,
      eventKey,
      rawPayload,
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("cryptomus-webhook-failed", { message });
    return new Response(JSON.stringify({ ok: false }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
});

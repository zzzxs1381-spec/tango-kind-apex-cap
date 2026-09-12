import { defineHandler, getRequestIP, readFormData } from "nitro/h3";

import {
  isFreeKassaWebhookIpAllowed,
  verifyFreeKassaWebhook,
} from "@/lib/payments/freekassa.server";
import { recordVerifiedPaymentEvent } from "@/lib/payments/ledger.server";

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default defineHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true });
  if (!isFreeKassaWebhookIpAllowed(ip)) {
    console.warn("freekassa-webhook-rejected-ip", { ip });
    return textResponse("FORBIDDEN", 403);
  }

  try {
    const form = await readFormData(event);
    const data: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") data[key] = value;
    }

    const paymentEvent = verifyFreeKassaWebhook(data);
    const eventKey = paymentEvent.providerPaymentId
      ? `intid:${paymentEvent.providerPaymentId}`
      : `order:${paymentEvent.orderId}:amount:${paymentEvent.amount ?? ""}`;

    await recordVerifiedPaymentEvent({
      event: paymentEvent,
      eventKey,
      rawPayload: data,
    });

    // FreeKassa can be configured to retry notifications until it receives YES.
    return textResponse("YES");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("freekassa-webhook-failed", { message });
    return textResponse("INVALID", 400);
  }
});

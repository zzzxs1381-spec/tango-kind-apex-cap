import { getSql } from "@/lib/db";

import type { PaymentCheckout, PaymentProvider, VerifiedPaymentEvent } from "./types";

export interface PaymentOrderRow {
  id: string;
  provider: PaymentProvider;
  plan_id: string;
  amount: string;
  currency: string;
  status: string;
  provider_payment_id: string | null;
  checkout_url: string | null;
}

export async function createPaymentOrder(input: {
  id: string;
  provider: PaymentProvider;
  planId: string;
  amount: number;
  currency: string;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO payment_orders (id, provider, plan_id, amount, currency, status)
    VALUES (${input.id}, ${input.provider}, ${input.planId}, ${input.amount.toFixed(8)}, ${input.currency}, 'creating')
  `;
}

export async function attachCheckout(checkout: PaymentCheckout): Promise<void> {
  const sql = await getSql();
  await sql`
    UPDATE payment_orders
       SET provider_payment_id = ${checkout.providerPaymentId ?? null},
           checkout_url = ${checkout.checkoutUrl},
           status = 'pending',
           updated_at = now()
     WHERE id = ${checkout.orderId}
       AND provider = ${checkout.provider}
  `;
}

export async function markProviderError(orderId: string): Promise<void> {
  const sql = await getSql();
  await sql`
    UPDATE payment_orders
       SET status = 'provider_error', updated_at = now()
     WHERE id = ${orderId} AND status = 'creating'
  `;
}

function sameAmount(expected: string, actual: string | undefined): boolean {
  if (actual == null) return false;
  const left = Number(expected);
  const right = Number(actual);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.00000001;
}

export async function recordVerifiedPaymentEvent(input: {
  event: VerifiedPaymentEvent;
  eventKey: string;
  rawPayload: Record<string, unknown>;
}): Promise<{ accepted: boolean; duplicate: boolean; paid: boolean }> {
  const sql = await getSql();
  const rows = await sql<PaymentOrderRow>`
    SELECT id, provider, plan_id, amount::text AS amount, currency, status,
           provider_payment_id, checkout_url
      FROM payment_orders
     WHERE id = ${input.event.orderId}
       AND provider = ${input.event.provider}
     LIMIT 1
  `;
  const order = rows[0];
  if (!order) throw new Error("Unknown payment order");

  // Never grant service unless the provider confirms the exact server-side price.
  // Non-paid terminal/intermediate events can legitimately omit amount/currency.
  if (input.event.paid && !sameAmount(order.amount, input.event.amount)) {
    throw new Error("Payment amount mismatch");
  }
  if (
    input.event.paid &&
    (!input.event.currency || order.currency.toUpperCase() !== input.event.currency.toUpperCase())
  ) {
    throw new Error("Payment currency mismatch");
  }

  const eventRows = await sql.query<{ id: number }>(
    `INSERT INTO payment_events (provider, event_key, order_id, status, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (provider, event_key) DO NOTHING
     RETURNING id`,
    [
      input.event.provider,
      input.eventKey,
      input.event.orderId,
      input.event.status,
      JSON.stringify(input.rawPayload),
    ],
  );
  if (eventRows.length === 0) {
    return { accepted: true, duplicate: true, paid: order.status === "paid" };
  }

  const nextStatus = input.event.paid ? "paid" : input.event.status;
  await sql`
    UPDATE payment_orders
       SET status = ${nextStatus},
           provider_payment_id = COALESCE(${input.event.providerPaymentId ?? null}, provider_payment_id),
           paid_at = CASE WHEN ${input.event.paid} THEN COALESCE(paid_at, now()) ELSE paid_at END,
           updated_at = now()
     WHERE id = ${input.event.orderId}
       AND provider = ${input.event.provider}
  `;

  return { accepted: true, duplicate: false, paid: input.event.paid };
}

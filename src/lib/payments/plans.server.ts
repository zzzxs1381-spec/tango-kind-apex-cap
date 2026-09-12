export interface PaymentPlan {
  id: string;
  durationDays: number;
  rubAmount: number;
  cryptoAmount: number;
  cryptoCurrency: string;
}

type RawPlan = Partial<PaymentPlan> & { id?: never };

let cachedSource: string | undefined;
let cachedPlans = new Map<string, PaymentPlan>();

function parsePlans(): Map<string, PaymentPlan> {
  const source = process.env.XF_PAYMENT_PLANS_JSON?.trim() ?? "";
  if (source === cachedSource) return cachedPlans;

  const next = new Map<string, PaymentPlan>();
  if (!source) {
    cachedSource = source;
    cachedPlans = next;
    return next;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("XF_PAYMENT_PLANS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("XF_PAYMENT_PLANS_JSON must be an object keyed by plan id");
  }

  for (const [id, rawValue] of Object.entries(parsed as Record<string, RawPlan>)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(id)) throw new Error(`Invalid payment plan id: ${id}`);
    const raw = rawValue as RawPlan;
    const durationDays = Number(raw.durationDays);
    const rubAmount = Number(raw.rubAmount);
    const cryptoAmount = Number(raw.cryptoAmount);
    const cryptoCurrency = String(raw.cryptoCurrency ?? "USD").toUpperCase();
    if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 3660) {
      throw new Error(`Invalid durationDays for plan ${id}`);
    }
    if (!Number.isFinite(rubAmount) || rubAmount <= 0 || rubAmount > 1_000_000) {
      throw new Error(`Invalid rubAmount for plan ${id}`);
    }
    if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0 || cryptoAmount > 1_000_000) {
      throw new Error(`Invalid cryptoAmount for plan ${id}`);
    }
    if (!/^[A-Z0-9]{3,10}$/.test(cryptoCurrency)) {
      throw new Error(`Invalid cryptoCurrency for plan ${id}`);
    }
    next.set(id, { id, durationDays, rubAmount, cryptoAmount, cryptoCurrency });
  }

  cachedSource = source;
  cachedPlans = next;
  return next;
}

export function getPaymentPlan(id: string): PaymentPlan | null {
  return parsePlans().get(id) ?? null;
}

export function paymentPlansConfigured(): boolean {
  return parsePlans().size > 0;
}

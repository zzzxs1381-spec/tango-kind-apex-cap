# XFreedom payments

Payment backend is provider-agnostic and currently supports:

- **FreeKassa** for RUB checkout (cards / MIR / SBP, subject to methods enabled for the merchant account).
- **Cryptomus** for cryptocurrency checkout.

The public API never accepts a price from the client. Prices are loaded server-side from `XF_PAYMENT_PLANS_JSON`; each order is persisted before the external checkout is created and all provider callbacks are stored idempotently.

## Required environment variables

### Common

- `DATABASE_URL` — production PostgreSQL/Neon connection.
- `XF_PUBLIC_BASE_URL` — public HTTPS origin used for webhook URLs, for example `https://xservis.app`.
- `XF_PAYMENT_RETURN_URL` — optional page to return to after Cryptomus checkout.
- `XF_PAYMENT_PLANS_JSON` — server-side plan catalog.

Example structure only (replace prices before production):

```json
{
  "month": {
    "durationDays": 30,
    "rubAmount": 0,
    "cryptoAmount": 0,
    "cryptoCurrency": "USD"
  }
}
```

The example uses zero deliberately and therefore fails validation; production prices must be explicitly chosen and configured instead of being invented in source code.

### FreeKassa

- `XF_FK_SHOP_ID`
- `XF_FK_API_KEY`
- `XF_FK_SECRET2`
- `XF_FK_WEBHOOK_IPS` — optional comma-separated override. If unset, the adapter uses the provider IPs published in FreeKassa documentation.
- Optional payment-method overrides: `XF_FK_CARD_METHOD_ID`, `XF_FK_VISA_METHOD_ID`, `XF_FK_MASTERCARD_METHOD_ID`, `XF_FK_MIR_METHOD_ID`, `XF_FK_SBP_METHOD_ID`.

Configure the shop notification URL as:

`https://<public-origin>/api/payments/freekassa-webhook`

Enable FreeKassa notification acknowledgement if desired; the endpoint returns `YES` after a verified and persisted callback.

### Cryptomus

- `XF_CRYPTOMUS_MERCHANT_ID`
- `XF_CRYPTOMUS_PAYMENT_API_KEY`
- `XF_CRYPTOMUS_ENFORCE_WEBHOOK_IP=1` — optional. Signature verification is always mandatory; enabling this adds the provider IP check as well.

Invoices use:

`https://<public-origin>/api/payments/cryptomus-webhook`

If automatic conversion to USDT is desired for received cryptocurrency, enable the corresponding auto-conversion option in the Cryptomus merchant account. Do not place API keys in the repository or Android application.

## Checkout API

`POST /api/payments/create`

FreeKassa example:

```json
{
  "provider": "freekassa",
  "planId": "month",
  "email": "customer@example.com",
  "method": "sbp"
}
```

Cryptomus example:

```json
{
  "provider": "cryptomus",
  "planId": "month"
}
```

The response contains a provider checkout URL. A verified webhook changes the internal order to `paid`; duplicate callbacks do not create duplicate payment events.

## Release gate

Do not grant VPN entitlement merely because the browser returned from checkout. Grant it only from a persisted `paid` order produced by a verified provider webhook. The entitlement/subscription layer should be wired after final tariff rules and account identity rules are approved.

# chin-chin-backend

## Saferpay authorization security

Notifications only identify a pending payment. The server retrieves its stored
checkout token, calls `PaymentPage/Assert` using the configured sandbox/production
credentials, and validates `AUTHORIZED`, transaction ID (if already known), order
reference, amount and currency before changing payment/reservation state. Supplied
callback statuses and checkout tokens are not accepted as proof of authorization.
Repeated/concurrent authorization cannot reset a captured/refunded payment.

Set `SAFERPAY_NOTIFY_URL` to
`https://api.chin-chin.hr/api/payments/webhooks/worldline`. New checkouts append
their merchant reference automatically to both `SuccessNotifyUrl` and
`FailNotifyUrl`. GET and POST callbacks are supported. The app's existing checkout
assertion also validates the stored token and transaction details.

An inconclusive assertion, provider error, timeout or mismatch leaves the payment
unchanged and returns a retryable verification error. Do not treat this as proof of
either a successful charge or a failed charge; reconcile unresolved payments with
Saferpay before taking further action. These errors do not trigger an automatic refund.

`POST /api/payments/preview/reservations/:reservationId/mock-authorize` now requires
an authenticated `ADMIN`. It is also blocked at service level unless the provider
mode is explicitly `mock` and `NODE_ENV` is not `production`. Real sandbox card
payments continue using `SAFERPAY_MODE=sandbox`; they never need mock authorization.
Both protections can be tested before production credentials are issued.

Run security regression checks:

```sh
node --require ts-node/register --test test/payment-security.test.cjs
npm run typecheck
npm run build
```

Before rollout, exercise real sandbox authorization, capture, cancellation, full and
partial refund, failed/aborted checkout, callback replay, and a callback with a
forged status. With production activation, configure production IDs, API credentials,
mode and base URL together and repeat a small real payment and refund. Saved sandbox
cards and tokens cannot be reused in production. No database migration is required
for these security changes.

References:

- https://docs.saferpay.com/home/integration-guide/licences-and-interfaces/payment-page
- https://saferpay.github.io/jsonapi/#Payment_v1_PaymentPage_Assert

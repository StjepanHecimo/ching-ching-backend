const test = require("node:test");
const assert = require("node:assert/strict");
const { ConfigService } = require("@nestjs/config");
const { GUARDS_METADATA } = require("@nestjs/common/constants");
const {
  WorldlinePaymentProvider,
} = require("../src/payments/worldline-payment.provider");
const { PaymentsService } = require("../src/payments/payments.service");
const { PaymentsController } = require("../src/payments/payments.controller");

test("new checkouts identify their order in both Saferpay notification URLs", async () => {
  const gateway = new WorldlinePaymentProvider(
    new ConfigService({
      SAFERPAY_MODE: "sandbox",
      SAFERPAY_CUSTOMER_ID: "customer",
      SAFERPAY_TERMINAL_ID: "terminal",
      API_PUBLIC_URL: "https://api.example.com",
      SAFERPAY_NOTIFY_URL:
        "https://api.example.com/api/payments/webhooks/worldline?existing=1",
    }),
    { record() {} },
  );
  gateway.saferpayPost = async (_path, body) => {
    const success = new URL(body.Notification.SuccessNotifyUrl);
    assert.equal(success.searchParams.get("merchantReference"), "order-1");
    assert.equal(success.searchParams.get("existing"), "1");
    assert.equal(body.Notification.FailNotifyUrl, success.toString());
    assert.equal(body.Notification.NotifyUrl, undefined);
    return {
      Token: "stored-token",
      RedirectUrl: "https://test.saferpay.com/checkout",
    };
  };
  await gateway.createAuthorizationCheckout({
    reservationId: "reservation-1",
    ...expected,
  });
});

function provider(mode = "sandbox", nodeEnv = "test") {
  return new WorldlinePaymentProvider(
    new ConfigService({ SAFERPAY_MODE: mode, NODE_ENV: nodeEnv }),
    { record() {} },
  );
}
const expected = {
  amountCents: 600,
  currency: "EUR",
  merchantReference: "order-1",
};
function transaction(overrides = {}) {
  return {
    Id: "tx-1",
    Status: "AUTHORIZED",
    OrderId: "order-1",
    Amount: { Value: "600", CurrencyCode: "EUR" },
    ...overrides,
  };
}
function payment(overrides = {}) {
  return {
    id: "payment-1",
    reservationId: "reservation-1",
    status: "AUTH_PENDING",
    providerCheckoutId: "stored-token",
    providerMerchantReference: "order-1",
    providerPaymentId: null,
    amountCents: 600,
    currency: "EUR",
    ...overrides,
  };
}
function service(row = payment(), gateway = provider()) {
  return new PaymentsService(
    {
      reservationPayment: { findFirst: async () => row },
      paymentWebhookEvent: { upsert: async () => ({}) },
    },
    new ConfigService({}),
    gateway,
    {},
    {},
    {},
  );
}

test("authorization checks the stored token with Saferpay", async () => {
  const gateway = provider();
  gateway.saferpayPost = async (path, body) => {
    assert.equal(path, "/Payment/v1/PaymentPage/Assert");
    assert.equal(body.Token, "stored-token");
    return { Transaction: transaction() };
  };
  gateway.requestHeader = () => ({});
  assert.equal(
    (await gateway.assertAuthorizationCheckout("stored-token", expected))
      .providerPaymentId,
    "tx-1",
  );
});

for (const [label, override] of [
  ["wrong order", { OrderId: "other-order" }],
  ["wrong amount", { Amount: { Value: "400", CurrencyCode: "EUR" } }],
  ["wrong currency", { Amount: { Value: "600", CurrencyCode: "USD" } }],
  ["missing amount", { Amount: undefined }],
  ["pending", { Status: "PENDING" }],
  ["cancelled", { Status: "CANCELLED" }],
  ["captured", { Status: "CAPTURED" }],
  ["missing status", { Status: undefined }],
]) {
  test(`rejects provider response: ${label}`, async () => {
    const gateway = provider();
    gateway.requestHeader = () => ({});
    gateway.saferpayPost = async () => ({ Transaction: transaction(override) });
    await assert.rejects(
      gateway.assertAuthorizationCheckout("stored-token", expected),
    );
  });
}

test("rejects a different existing transaction ID", async () => {
  const gateway = provider();
  gateway.requestHeader = () => ({});
  gateway.saferpayPost = async () => ({ Transaction: transaction() });
  await assert.rejects(
    gateway.assertAuthorizationCheckout("stored-token", {
      ...expected,
      providerPaymentId: "other-tx",
    }),
  );
});

test("webhook ignores forged success/failure status and uses server verification", async () => {
  for (const status of ["AUTHORIZED", "FAILED"]) {
    const payments = service();
    let verified = 0;
    payments.assertReservationCheckout = async (id, token) => {
      assert.equal(id, "reservation-1");
      assert.equal(token, undefined);
      verified++;
    };
    assert.deepEqual(
      await payments.handleWorldlineWebhook({
        merchantReference: "order-1",
        status,
        payload: { token: "attacker-token" },
      }),
      { status: "processed" },
    );
    assert.equal(verified, 1);
  }
});

test("webhook without identity cannot query or modify a payment", async () => {
  const payments = service();
  payments.prisma.reservationPayment.findFirst = () =>
    assert.fail("must not query");
  await assert.rejects(
    payments.handleWorldlineWebhook({ status: "AUTHORIZED" }),
  );
});

test("unknown webhook reference cannot authorize", async () => {
  const payments = service(null);
  payments.assertReservationCheckout = () => assert.fail("must not authorize");
  await assert.rejects(
    payments.handleWorldlineWebhook({ merchantReference: "unknown" }),
  );
});

test("replayed notifications do not reopen authorized/captured/refunded payments", async () => {
  for (const status of [
    "AUTHORIZED",
    "CAPTURED",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
    "VOIDED",
  ]) {
    const payments = service(payment({ status }));
    payments.assertReservationCheckout = () => assert.fail("must not reopen");
    assert.deepEqual(
      await payments.handleWorldlineWebhook({ merchantReference: "order-1" }),
      { status: "ignored" },
    );
  }
});

test("mock mode does not trust public webhook", async () => {
  await assert.rejects(
    service(payment(), provider("mock")).handleWorldlineWebhook({
      merchantReference: "order-1",
      status: "AUTHORIZED",
    }),
  );
});

test("checkout cannot substitute a token from another payment", async () => {
  const payments = service();
  await assert.rejects(
    payments.assertReservationCheckout("reservation-1", "attacker-token"),
  );
});

test("verification outage leaves payment unchanged for a retry", async () => {
  const gateway = provider();
  gateway.assertAuthorizationCheckout = async () => {
    throw new Error("timeout");
  };
  const payments = service(payment(), gateway);
  payments.logger = { warn() {} };
  payments.markPaymentAuthorizationFailed = () =>
    assert.fail("must not mark as failed");
  payments.markPaymentAuthorized = () => assert.fail("must not authorize");
  await assert.rejects(
    payments.assertReservationCheckout("reservation-1"),
    /verification is unavailable/,
  );
});

test("mock authorization requires both guards at the HTTP route", () => {
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    PaymentsController.prototype.mockAuthorizeReservationPayment,
  );
  assert.deepEqual(
    guards.map((guard) => guard.name),
    ["JwtAuthGuard", "AdminRolesGuard"],
  );
  assert.deepEqual(
    Reflect.getMetadata(
      "admin_roles",
      PaymentsController.prototype.mockAuthorizeReservationPayment,
    ),
    ["ADMIN"],
  );
});

for (const [mode, nodeEnv] of [
  ["sandbox", "test"],
  ["production", "test"],
  ["mock", "production"],
]) {
  test(`mock authorization is blocked for mode=${mode}, NODE_ENV=${nodeEnv}`, async () => {
    const payments = service(payment(), provider(mode, nodeEnv));
    payments.prisma.reservationPayment.findFirst = () =>
      assert.fail("must be blocked before database access");
    await assert.rejects(
      payments.mockAuthorizeReservationPayment("reservation-1"),
    );
  });
}

test("explicit local mock mode permits the test authorization", () => {
  assert.doesNotThrow(() =>
    provider("mock", "development").assertMockAuthorizationAllowed(),
  );
});

test("concurrent authorization cannot downgrade a payment or reopen its reservation", async () => {
  const payments = service();
  payments.findProviderPayment = async () => payment();
  payments.prisma.$transaction = async (callback) =>
    callback({
      reservationPayment: {
        updateMany: async () => ({ count: 0 }),
        findUniqueOrThrow: async () => payment({ status: "CAPTURED" }),
        update: () => assert.fail("must not downgrade"),
      },
      reservation: { update: () => assert.fail("must not reopen") },
    });
  payments.notifyVenueAboutReservationRequest = () =>
    assert.fail("must not notify again");
  const result = await payments.markPaymentAuthorized({
    merchantReference: "order-1",
    rawProviderData: {},
  });
  assert.equal(result.status, "CAPTURED");
});

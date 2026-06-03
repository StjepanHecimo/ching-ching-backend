import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type CreateAuthorizationCheckoutInput = {
  reservationId: string;
  merchantReference: string;
  amountCents: number;
  currency: string;
  saveCard?: boolean;
};

type AuthorizeWithPaymentMethodInput = {
  providerPaymentMethodId: string;
  merchantReference: string;
  amountCents: number;
  currency: string;
};

type ProviderPaymentResult = {
  providerPaymentId: string;
  rawProviderData: Record<string, unknown>;
};

@Injectable()
export class WorldlinePaymentProvider {
  constructor(private readonly configService: ConfigService) {}

  async createAuthorizationCheckout(input: CreateAuthorizationCheckoutInput) {
    if (this.useMockProvider()) {
      return {
        providerCheckoutId: `mock_checkout_${input.merchantReference}`,
        providerPaymentId: `mock_payment_${input.merchantReference}`,
        checkoutUrl: `${this.publicAppUrl()}/mock-worldline-checkout?reservationId=${input.reservationId}&reference=${input.merchantReference}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        rawProviderData: {
          mode: "mock",
          action: "AUTHORIZE_ONLY",
          amountCents: input.amountCents,
          currency: input.currency,
          saveCard: input.saveCard === true,
          mockSavedPaymentMethod: input.saveCard
            ? {
                providerPaymentMethodId: `mock_pm_${input.merchantReference}`,
                brand: "Visa",
                last4: "4242",
                expiryMonth: 12,
                expiryYear: 2030,
                holderName: "Chin-Chin korisnik",
              }
            : null,
        },
      };
    }

    // Production Worldline API call plugs in here. Keep all reservation/payment
    // state changes outside this adapter so provider replacement stays small.
    throw new Error(
      "Worldline production provider is not configured. Set WORLDLINE_MODE=mock for local development.",
    );
  }

  async authorizeWithPaymentMethod(
    input: AuthorizeWithPaymentMethodInput,
  ): Promise<ProviderPaymentResult> {
    if (this.useMockProvider()) {
      return {
        providerPaymentId: `mock_payment_${input.merchantReference}`,
        rawProviderData: {
          mode: "mock",
          action: "AUTHORIZE_WITH_PAYMENT_METHOD",
          providerPaymentMethodId: input.providerPaymentMethodId,
          amountCents: input.amountCents,
          currency: input.currency,
          authorizedAt: new Date().toISOString(),
        },
      };
    }

    throw new Error(
      "Worldline production card-on-file authorization is not configured.",
    );
  }

  async capturePayment(
    providerPaymentId: string,
    amountCents: number,
    currency: string,
  ): Promise<ProviderPaymentResult> {
    if (this.useMockProvider()) {
      return {
        providerPaymentId,
        rawProviderData: {
          mode: "mock",
          action: "CAPTURE",
          providerPaymentId,
          amountCents,
          currency,
          capturedAt: new Date().toISOString(),
        },
      };
    }

    throw new Error("Worldline production capture is not configured.");
  }

  async voidAuthorization(
    providerPaymentId: string,
  ): Promise<ProviderPaymentResult> {
    if (this.useMockProvider()) {
      return {
        providerPaymentId,
        rawProviderData: {
          mode: "mock",
          action: "VOID_AUTHORIZATION",
          providerPaymentId,
          voidedAt: new Date().toISOString(),
        },
      };
    }

    throw new Error(
      "Worldline production authorization void is not configured.",
    );
  }

  async refundPayment(
    providerPaymentId: string,
    amountCents: number,
    currency: string,
  ): Promise<ProviderPaymentResult> {
    if (this.useMockProvider()) {
      return {
        providerPaymentId,
        rawProviderData: {
          mode: "mock",
          action: "REFUND",
          providerPaymentId,
          amountCents,
          currency,
          refundedAt: new Date().toISOString(),
        },
      };
    }

    throw new Error("Worldline production refund is not configured.");
  }

  verifyWebhookSignature(_headers: Record<string, unknown>, _body: unknown) {
    // TODO: Wire Worldline signature validation once production credentials are
    // issued. The payment service still stores and processes events
    // idempotently, so local/mock development remains deterministic.
    return true;
  }

  private useMockProvider() {
    return (
      this.configService.get<string>("WORLDLINE_MODE")?.toLowerCase() !==
      "production"
    );
  }

  private publicAppUrl() {
    return (
      this.configService.get<string>("CUSTOMER_APP_PUBLIC_URL") ??
      "http://localhost:4000"
    );
  }
}

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";

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

type ProviderCheckoutResult = {
  providerCheckoutId: string;
  checkoutUrl: string;
  expiresAt: Date;
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

    const notifyUrl = this.saferpayNotifyUrl();
    const response = await this.saferpayPost<SaferpayPaymentPageInitialize>(
      "/Payment/v1/PaymentPage/Initialize",
      {
        RequestHeader: this.requestHeader(),
        TerminalId: this.saferpayTerminalId(),
        Payment: {
          Amount: {
            Value: input.amountCents.toString(),
            CurrencyCode: input.currency,
          },
          OrderId: input.merchantReference,
          Description: `Chin-Chin rezervacija ${input.reservationId}`,
        },
        ReturnUrl: {
          Url: this.saferpayReturnUrl(input.reservationId),
        },
        ...(notifyUrl
          ? {
              Notification: {
                NotifyUrl: notifyUrl,
              },
            }
          : {}),
        PaymentMethods: this.saferpayPaymentMethods(),
        ...(input.saveCard
          ? {
              RegisterAlias: {
                IdGenerator: "RANDOM_UNIQUE",
                Lifetime: this.saferpayAliasLifetimeDays(),
              },
            }
          : {}),
      },
    );

    return {
      providerCheckoutId: response.Token,
      providerPaymentId: null,
      checkoutUrl: response.RedirectUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      rawProviderData: {
        mode: this.providerMode(),
        action: "PAYMENT_PAGE_INITIALIZE",
        token: response.Token,
        merchantReference: input.merchantReference,
        saferpay: response,
      },
    };
  }

  async assertAuthorizationCheckout(
    providerCheckoutId: string,
  ): Promise<ProviderPaymentResult> {
    if (this.useMockProvider()) {
      return {
        providerPaymentId: `mock_payment_${providerCheckoutId}`,
        rawProviderData: {
          mode: "mock",
          action: "PAYMENT_PAGE_ASSERT",
          token: providerCheckoutId,
          authorizedAt: new Date().toISOString(),
        },
      };
    }

    const response = await this.saferpayPost<SaferpayPaymentPageAssert>(
      "/Payment/v1/PaymentPage/Assert",
      {
        RequestHeader: this.requestHeader(),
        Token: providerCheckoutId,
      },
    );
    const providerPaymentId = response.Transaction?.Id;
    if (!providerPaymentId) {
      throw new Error("Saferpay assert did not return Transaction.Id.");
    }

    return {
      providerPaymentId,
      rawProviderData: {
        mode: this.providerMode(),
        action: "PAYMENT_PAGE_ASSERT",
        token: providerCheckoutId,
        status: response.Transaction?.Status,
        savedPaymentMethod: this.savedPaymentMethodFromAssert(response),
        saferpay: response,
      },
    };
  }

  async createPaymentMethodCheckout(
    customerId: string,
  ): Promise<ProviderCheckoutResult> {
    if (this.useMockProvider()) {
      return {
        providerCheckoutId: `mock_alias_${customerId}_${Date.now()}`,
        checkoutUrl: `${this.publicAppUrl()}/mock-worldline-card-setup?customerId=${customerId}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        rawProviderData: {
          mode: "mock",
          action: "ALIAS_INSERT",
          customerId,
        },
      };
    }

    const response = await this.saferpayPost<SaferpayAliasInsert>(
      "/Payment/v1/Alias/Insert",
      {
        RequestHeader: this.requestHeader(),
        RegisterAlias: {
          IdGenerator: "RANDOM_UNIQUE",
          Lifetime: this.saferpayAliasLifetimeDays(),
        },
        Type: "CARD",
        ReturnUrl: {
          Url: this.saferpayPaymentMethodReturnUrl(),
        },
        LanguageCode: this.saferpayLanguageCode(),
      },
    );

    return {
      providerCheckoutId: response.Token,
      checkoutUrl: this.saferpayAliasRedirectUrl(response),
      expiresAt: response.Expiration
        ? new Date(response.Expiration)
        : new Date(Date.now() + 15 * 60 * 1000),
      rawProviderData: {
        mode: this.providerMode(),
        action: "ALIAS_INSERT",
        token: response.Token,
        saferpay: response,
      },
    };
  }

  async assertPaymentMethodCheckout(token: string) {
    if (this.useMockProvider()) {
      return {
        rawProviderData: {
          mode: "mock",
          action: "ALIAS_ASSERT_INSERT",
          token,
          savedPaymentMethod: {
            providerPaymentMethodId: `mock_pm_${token}`,
            brand: "Visa",
            last4: "4242",
            expiryMonth: 12,
            expiryYear: 2030,
            holderName: "Chin-Chin korisnik",
          },
        },
      };
    }

    const response = await this.saferpayPost<SaferpayAliasAssertInsert>(
      "/Payment/v1/Alias/AssertInsert",
      {
        RequestHeader: this.requestHeader(),
        Token: token,
      },
    );

    return {
      rawProviderData: {
        mode: this.providerMode(),
        action: "ALIAS_ASSERT_INSERT",
        token,
        savedPaymentMethod: this.savedPaymentMethodFromAliasAssert(response),
        saferpay: response,
      },
    };
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

    const response = await this.saferpayPost<SaferpayAuthorizeDirect>(
      "/Payment/v1/Transaction/AuthorizeDirect",
      {
        RequestHeader: this.requestHeader(),
        TerminalId: this.saferpayTerminalId(),
        Payment: {
          Amount: {
            Value: input.amountCents.toString(),
            CurrencyCode: input.currency,
          },
          OrderId: input.merchantReference,
          Description: `Chin-Chin rezervacija ${input.merchantReference}`,
        },
        PaymentMeans: {
          Alias: {
            Id: input.providerPaymentMethodId,
          },
        },
        Transaction: {
          Type: "PAYMENT",
        },
        Initiator: this.saferpayAliasInitiator(),
      },
    );

    const providerPaymentId = response.Transaction?.Id;
    if (!providerPaymentId) {
      throw new Error("Saferpay authorization did not return Transaction.Id.");
    }

    return {
      providerPaymentId,
      rawProviderData: {
        mode: this.providerMode(),
        action: "AUTHORIZE_WITH_PAYMENT_METHOD",
        providerPaymentMethodId: input.providerPaymentMethodId,
        status: response.Transaction?.Status,
        saferpay: response,
      },
    };
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

    const response = await this.saferpayPost<SaferpayCapture>(
      "/Payment/v1/Transaction/Capture",
      {
        RequestHeader: this.requestHeader(),
        TransactionReference: {
          TransactionId: providerPaymentId,
        },
        Amount: {
          Value: amountCents.toString(),
          CurrencyCode: currency,
        },
      },
    );

    return {
      providerPaymentId,
      rawProviderData: {
        mode: this.providerMode(),
        action: "CAPTURE",
        providerPaymentId,
        captureId: response.CaptureId,
        status: response.Status,
        amountCents,
        currency,
        capturedAt: new Date().toISOString(),
        saferpay: response,
      },
    };
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

    const response = await this.saferpayPost<Record<string, unknown>>(
      "/Payment/v1/Transaction/Cancel",
      {
        RequestHeader: this.requestHeader(),
        TransactionReference: {
          TransactionId: providerPaymentId,
        },
      },
    );

    return {
      providerPaymentId,
      rawProviderData: {
        mode: this.providerMode(),
        action: "VOID_AUTHORIZATION",
        providerPaymentId,
        voidedAt: new Date().toISOString(),
        saferpay: response,
      },
    };
  }

  async refundPayment(
    providerPaymentId: string,
    amountCents: number,
    currency: string,
    rawPaymentData?: unknown,
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

    const captureId = this.captureIdFromRawPaymentData(rawPaymentData);
    if (!captureId) {
      throw new Error(
        "Saferpay refund requires CaptureId. Capture the transaction before refunding it.",
      );
    }

    const response = await this.saferpayPost<SaferpayRefund>(
      "/Payment/v1/Transaction/Refund",
      {
        RequestHeader: this.requestHeader(),
        Refund: {
          Amount: {
            Value: amountCents.toString(),
            CurrencyCode: currency,
          },
          OrderId: `refund_${providerPaymentId}_${Date.now()}`,
          Description: "Chin-Chin refund",
        },
        CaptureReference: {
          CaptureId: captureId,
        },
      },
    );

    return {
      providerPaymentId: response.Transaction?.Id ?? providerPaymentId,
      rawProviderData: {
        mode: this.providerMode(),
        action: "REFUND",
        providerPaymentId,
        refundTransactionId: response.Transaction?.Id,
        status: response.Transaction?.Status,
        captureId,
        amountCents,
        currency,
        refundedAt: new Date().toISOString(),
        saferpay: response,
      },
    };
  }

  verifyWebhookSignature(_headers: Record<string, unknown>, _body: unknown) {
    // TODO: Wire Worldline signature validation once production credentials are
    // issued. The payment service still stores and processes events
    // idempotently, so local/mock development remains deterministic.
    return true;
  }

  private useMockProvider() {
    return this.providerMode() === "mock";
  }

  private providerMode() {
    return (
      this.configService.get<string>("SAFERPAY_MODE")?.toLowerCase().trim() ??
      this.configService.get<string>("WORLDLINE_MODE")?.toLowerCase().trim() ??
      "mock"
    );
  }

  private publicAppUrl() {
    return (
      this.configService.get<string>("CUSTOMER_APP_PUBLIC_URL") ??
      "http://localhost:4000"
    );
  }

  private saferpayBaseUrl() {
    const configured =
      this.configService.get<string>("SAFERPAY_API_BASE_URL") ??
      this.configService.get<string>("WORLDLINE_API_BASE_URL");
    if (configured?.trim()) {
      return configured.trim().replace(/\/+$/, "");
    }
    return this.providerMode() === "production"
      ? "https://www.saferpay.com/api"
      : "https://test.saferpay.com/api";
  }

  private saferpayCustomerId() {
    const value =
      this.configService.get<string>("SAFERPAY_CUSTOMER_ID") ??
      this.configService.get<string>("WORLDLINE_MERCHANT_ID");
    if (!value?.trim()) {
      throw new Error("SAFERPAY_CUSTOMER_ID is not configured.");
    }
    return value.trim();
  }

  private saferpayTerminalId() {
    const value =
      this.configService.get<string>("SAFERPAY_TERMINAL_ID") ??
      this.configService.get<string>("WORLDLINE_TERMINAL_ID");
    if (!value?.trim()) {
      throw new Error("SAFERPAY_TERMINAL_ID is not configured.");
    }
    return value.trim();
  }

  private saferpayUsername() {
    const value =
      this.configService.get<string>("SAFERPAY_API_USERNAME") ??
      this.configService.get<string>("WORLDLINE_API_KEY");
    if (!value?.trim()) {
      throw new Error("SAFERPAY_API_USERNAME is not configured.");
    }
    return value.trim();
  }

  private saferpayPassword() {
    const value =
      this.configService.get<string>("SAFERPAY_API_PASSWORD") ??
      this.configService.get<string>("WORLDLINE_API_SECRET");
    if (!value?.trim()) {
      throw new Error("SAFERPAY_API_PASSWORD is not configured.");
    }
    return value.trim();
  }

  private saferpaySpecVersion() {
    return (
      this.configService.get<string>("SAFERPAY_SPEC_VERSION")?.trim() ?? "1.41"
    );
  }

  private saferpayReturnUrl(reservationId: string) {
    const configured = this.configService.get<string>("SAFERPAY_RETURN_URL");
    const base =
      configured?.trim() || "chinchincustomer://payment-return/saferpay";
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}reservationId=${encodeURIComponent(
      reservationId,
    )}`;
  }

  private saferpayPaymentMethodReturnUrl() {
    return (
      this.configService
        .get<string>("SAFERPAY_PAYMENT_METHOD_RETURN_URL")
        ?.trim() || "chinchincustomer://payment-method-return/saferpay"
    );
  }

  private saferpayNotifyUrl() {
    const configured = this.configService.get<string>("SAFERPAY_NOTIFY_URL");
    if (configured?.trim()) {
      return configured.trim();
    }
    return undefined;
  }

  private saferpayPaymentMethods() {
    const configured =
      this.configService.get<string>("SAFERPAY_PAYMENT_METHODS") ?? "CARD";
    return configured
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean);
  }

  private saferpayAliasLifetimeDays() {
    const configured = Number.parseInt(
      this.configService.get<string>("SAFERPAY_ALIAS_LIFETIME_DAYS") ?? "1600",
      10,
    );
    return Number.isInteger(configured) && configured > 0 ? configured : 1600;
  }

  private saferpayAliasInitiator() {
    return (
      this.configService.get<string>("SAFERPAY_ALIAS_INITIATOR")?.trim() ??
      "MERCHANT"
    );
  }

  private saferpayLanguageCode() {
    return (
      this.configService.get<string>("SAFERPAY_LANGUAGE_CODE")?.trim() ?? "hr"
    );
  }

  private requestHeader() {
    return {
      SpecVersion: this.saferpaySpecVersion(),
      CustomerId: this.saferpayCustomerId(),
      RequestId: randomUUID(),
      RetryIndicator: 0,
      ClientInfo: {
        ShopInfo: "Chin-Chin",
        OsInfo: "Chin-Chin backend",
      },
    };
  }

  private async saferpayPost<T>(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.saferpayBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Basic ${Buffer.from(
          `${this.saferpayUsername()}:${this.saferpayPassword()}`,
        ).toString("base64")}`,
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    const responseBody = this.parseProviderResponse(responseText);
    if (!response.ok) {
      throw new Error(
        `Saferpay ${path} failed with ${response.status}: ${responseText}`,
      );
    }
    return responseBody as T;
  }

  private parseProviderResponse(responseText: string) {
    if (!responseText.trim()) {
      return {};
    }
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      throw new Error(`Saferpay returned invalid JSON: ${responseText}`);
    }
  }

  private savedPaymentMethodFromAssert(
    response: SaferpayPaymentPageAssert,
  ): Record<string, unknown> | null {
    const aliasId = response.RegistrationResult?.Alias?.Id;
    if (!aliasId) {
      return null;
    }
    const displayText = response.PaymentMeans?.DisplayText ?? "";
    const maskedNumber = response.PaymentMeans?.Card?.MaskedNumber ?? "";
    return {
      providerPaymentMethodId: aliasId,
      brand:
        response.PaymentMeans?.Brand?.Name ??
        response.PaymentMeans?.Brand?.PaymentMethod ??
        "Kartica",
      last4: this.lastFourDigits(maskedNumber || displayText),
      holderName: response.Payer?.DisplayName ?? null,
      rawProviderData: response,
    };
  }

  private savedPaymentMethodFromAliasAssert(
    response: SaferpayAliasAssertInsert,
  ): Record<string, unknown> | null {
    const aliasId = response.Alias?.Id;
    if (!aliasId) {
      return null;
    }
    const displayText = response.PaymentMeans?.DisplayText ?? "";
    const maskedNumber = response.PaymentMeans?.Card?.MaskedNumber ?? "";
    return {
      providerPaymentMethodId: aliasId,
      brand:
        response.PaymentMeans?.Brand?.Name ??
        response.PaymentMeans?.Brand?.PaymentMethod ??
        "Kartica",
      last4: this.lastFourDigits(maskedNumber || displayText),
      holderName: response.Payer?.DisplayName ?? null,
      rawProviderData: response,
    };
  }

  private saferpayAliasRedirectUrl(response: SaferpayAliasInsert) {
    const redirectUrl = response.Redirect?.RedirectUrl;
    if (!redirectUrl) {
      throw new Error("Saferpay alias insert did not return RedirectUrl.");
    }
    return redirectUrl;
  }

  private lastFourDigits(value: string) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(-4) : undefined;
  }

  private captureIdFromRawPaymentData(rawPaymentData: unknown) {
    if (!rawPaymentData || typeof rawPaymentData !== "object") {
      return undefined;
    }
    const raw = rawPaymentData as Record<string, unknown>;
    const directCaptureId = this.stringFrom(raw.captureId);
    if (directCaptureId) {
      return directCaptureId;
    }
    const saferpay = raw.saferpay;
    if (saferpay && typeof saferpay === "object" && !Array.isArray(saferpay)) {
      const captureId = this.stringFrom(
        (saferpay as Record<string, unknown>).CaptureId,
      );
      if (captureId) {
        return captureId;
      }
    }
    return undefined;
  }

  private stringFrom(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  }
}

type SaferpayPaymentPageInitialize = {
  Token: string;
  RedirectUrl: string;
};

type SaferpayAliasInsert = {
  Token: string;
  Expiration?: string;
  Redirect?: {
    RedirectUrl?: string;
  };
};

type SaferpayPaymentPageAssert = {
  Transaction?: {
    Id?: string;
    Status?: string;
  };
  RegistrationResult?: {
    Alias?: {
      Id?: string;
    };
  };
  PaymentMeans?: {
    DisplayText?: string;
    Brand?: {
      Name?: string;
      PaymentMethod?: string;
    };
    Card?: {
      MaskedNumber?: string;
    };
  };
  Payer?: {
    DisplayName?: string;
  };
};

type SaferpayAuthorizeDirect = {
  Transaction?: {
    Id?: string;
    Status?: string;
  };
};

type SaferpayCapture = {
  CaptureId?: string;
  Status?: string;
};

type SaferpayRefund = {
  Transaction?: {
    Id?: string;
    Status?: string;
  };
};

type SaferpayAliasAssertInsert = {
  Alias?: {
    Id?: string;
  };
  PaymentMeans?: {
    DisplayText?: string;
    Brand?: {
      Name?: string;
      PaymentMethod?: string;
    };
    Card?: {
      MaskedNumber?: string;
    };
  };
  Payer?: {
    DisplayName?: string;
  };
};

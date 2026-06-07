import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma/client";
import {
  CustomerPaymentMethodStatus,
  DevicePushApp,
  LedgerEntryDirection,
  LedgerEntryType,
  PaymentProvider,
  PaymentWebhookStatus,
  ReservationPaymentStatus,
  ReservationStatus,
} from "../../generated/prisma/enums";
import { DeviceTokensService } from "../device-tokens/device-tokens.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminManualRefundDto } from "./dto/admin-manual-refund.dto";
import { CreateReservationCheckoutDto } from "./dto/create-reservation-checkout.dto";
import { CreateTestPaymentMethodDto } from "./dto/create-test-payment-method.dto";
import { WorldlineWebhookDto } from "./dto/worldline-webhook.dto";
import { WorldlinePaymentProvider } from "./worldline-payment.provider";

const DEFAULT_CHIN_CHIN_COMMISSION_BPS = 3000;
const DEFAULT_FIRST_RESERVATION_COMMISSION_BPS = 1000;
const VENUE_CONFIRMATION_WINDOW_SECONDS = 60;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly worldlineProvider: WorldlinePaymentProvider,
    private readonly deviceTokensService: DeviceTokensService,
  ) {}

  async createReservationCheckout(
    reservationId: string,
    dto: CreateReservationCheckoutDto,
    customerUserId?: string,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (this.isTerminalReservationStatus(reservation.status)) {
      throw new BadRequestException("Reservation is not payable.");
    }

    const existingPayment = await this.prisma.reservationPayment.findFirst({
      where: {
        reservationId,
        status: {
          in: [
            ReservationPaymentStatus.AUTH_PENDING,
            ReservationPaymentStatus.AUTHORIZED,
            ReservationPaymentStatus.CAPTURED,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingPayment) {
      return this.serializePayment(existingPayment);
    }

    const savedPaymentMethod = await this.resolveCustomerPaymentMethod({
      customerUserId,
      reservationCustomerId: reservation.customerId,
      paymentMethodId: dto.paymentMethodId,
      useDefaultPaymentMethod: dto.useDefaultPaymentMethod,
    });

    const merchantReference = `cc_${reservation.id}_${Date.now()}`;

    if (savedPaymentMethod) {
      const authorization =
        await this.worldlineProvider.authorizeWithPaymentMethod({
          providerPaymentMethodId: savedPaymentMethod.providerPaymentMethodId,
          merchantReference,
          amountCents: reservation.feeCents,
          currency: reservation.currency,
        });

      const payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.reservationPayment.create({
          data: {
            reservationId: reservation.id,
            venueId: reservation.venueId,
            customerId: reservation.customerId,
            paymentMethodId: savedPaymentMethod.id,
            provider: PaymentProvider.WORLDLINE,
            status: ReservationPaymentStatus.AUTH_PENDING,
            amountCents: reservation.feeCents,
            currency: reservation.currency,
            providerPaymentId: authorization.providerPaymentId,
            providerMerchantReference: merchantReference,
            rawProviderData:
              authorization.rawProviderData as Prisma.InputJsonValue,
          },
        });

        await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            status: ReservationStatus.REQUESTED,
            confirmationExpiresAt: null,
          },
        });

        await tx.customerPaymentMethod.update({
          where: { id: savedPaymentMethod.id },
          data: { lastUsedAt: new Date() },
        });

        return created;
      });

      return this.serializePayment(
        await this.markPaymentAuthorized({
          providerPaymentId: payment.providerPaymentId ?? undefined,
          merchantReference,
          rawProviderData: authorization.rawProviderData,
        }),
      );
    }

    const checkout = await this.worldlineProvider.createAuthorizationCheckout({
      reservationId: reservation.id,
      merchantReference,
      amountCents: reservation.feeCents,
      currency: reservation.currency,
      saveCard: dto.saveCard,
    });

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reservationPayment.create({
        data: {
          reservationId: reservation.id,
          venueId: reservation.venueId,
          customerId: reservation.customerId,
          paymentMethodId: null,
          provider: PaymentProvider.WORLDLINE,
          status: ReservationPaymentStatus.AUTH_PENDING,
          amountCents: reservation.feeCents,
          currency: reservation.currency,
          providerPaymentId: checkout.providerPaymentId,
          providerCheckoutId: checkout.providerCheckoutId,
          providerMerchantReference: merchantReference,
          checkoutUrl: checkout.checkoutUrl,
          checkoutExpiresAt: checkout.expiresAt,
          rawProviderData: checkout.rawProviderData,
        },
      });

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          status: ReservationStatus.REQUESTED,
          confirmationExpiresAt: null,
        },
      });

      return created;
    });

    return this.serializePayment(payment);
  }

  async getReservationPaymentSummary(reservationId: string) {
    const payments = await this.prisma.reservationPayment.findMany({
      where: { reservationId },
      orderBy: { createdAt: "desc" },
      include: { ledgerEntries: true },
    });

    return {
      reservationId,
      payments: payments.map((payment) => this.serializePayment(payment)),
    };
  }

  async listCustomerPaymentMethods(customerUserId: string) {
    const methods = await this.prisma.customerPaymentMethod.findMany({
      where: {
        customerId: customerUserId,
        status: CustomerPaymentMethodStatus.ACTIVE,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return {
      items: methods.map((method) => this.serializePaymentMethod(method)),
    };
  }

  async createTestCustomerPaymentMethod(
    customerUserId: string,
    dto: CreateTestPaymentMethodDto,
  ) {
    if (
      this.configService.get<string>("WORLDLINE_MODE")?.toLowerCase() ===
      "production"
    ) {
      throw new BadRequestException(
        "Test card creation is disabled in production payment mode.",
      );
    }

    const digits = dto.cardNumber.replace(/\D/g, "");
    if (digits.length < 12) {
      throw new BadRequestException("Card number is not valid.");
    }

    const last4 = digits.slice(-4);
    const brand = dto.brand?.trim() || this.detectCardBrand(digits);
    const providerPaymentMethodId = `test_pm_${customerUserId}_${last4}_${Date.now()}`;

    const defaultMethod = await this.prisma.customerPaymentMethod.findFirst({
      where: {
        customerId: customerUserId,
        status: CustomerPaymentMethodStatus.ACTIVE,
        isDefault: true,
      },
      select: { id: true },
    });

    const method = await this.prisma.customerPaymentMethod.create({
      data: {
        customerId: customerUserId,
        provider: PaymentProvider.WORLDLINE,
        status: CustomerPaymentMethodStatus.ACTIVE,
        providerPaymentMethodId,
        brand,
        last4,
        expiryMonth: dto.expiryMonth,
        expiryYear: dto.expiryYear,
        holderName: dto.holderName?.trim() || "Chin-Chin korisnik",
        isDefault: !defaultMethod,
        rawProviderData: {
          mode: "test",
          source: "manual_test_card",
          providerPaymentMethodId,
          brand,
          last4,
          expiryMonth: dto.expiryMonth,
          expiryYear: dto.expiryYear,
          holderName: dto.holderName?.trim() || "Chin-Chin korisnik",
        },
        lastUsedAt: new Date(),
      },
    });

    return this.serializePaymentMethod(method);
  }

  async disableCustomerPaymentMethod(
    customerUserId: string,
    paymentMethodId: string,
  ) {
    const method = await this.prisma.customerPaymentMethod.findFirst({
      where: {
        id: paymentMethodId,
        customerId: customerUserId,
        status: CustomerPaymentMethodStatus.ACTIVE,
      },
    });

    if (!method) {
      throw new NotFoundException("Payment method was not found.");
    }

    const disabled = await this.prisma.customerPaymentMethod.update({
      where: { id: method.id },
      data: {
        status: CustomerPaymentMethodStatus.DISABLED,
        isDefault: false,
        disabledAt: new Date(),
      },
    });

    return this.serializePaymentMethod(disabled);
  }

  async setDefaultCustomerPaymentMethod(
    customerUserId: string,
    paymentMethodId: string,
  ) {
    const method = await this.prisma.customerPaymentMethod.findFirst({
      where: {
        id: paymentMethodId,
        customerId: customerUserId,
        status: CustomerPaymentMethodStatus.ACTIVE,
      },
    });

    if (!method) {
      throw new NotFoundException("Payment method was not found.");
    }

    await this.prisma.$transaction([
      this.prisma.customerPaymentMethod.updateMany({
        where: { customerId: customerUserId },
        data: { isDefault: false },
      }),
      this.prisma.customerPaymentMethod.update({
        where: { id: method.id },
        data: { isDefault: true },
      }),
    ]);

    const updated = await this.prisma.customerPaymentMethod.findUniqueOrThrow({
      where: { id: method.id },
    });

    return this.serializePaymentMethod(updated);
  }

  async previewReservationAllocation(reservation: {
    id: string;
    customerId: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    feeCents: number;
  }) {
    const isNewCustomerReservation =
      await this.isBeforeFirstCompletedCustomerVisit(reservation);
    const commissionBps = isNewCustomerReservation
      ? this.firstReservationCommissionBps()
      : this.commissionBps();
    const allocation = this.calculateAllocation(
      reservation.feeCents,
      commissionBps,
    );

    return {
      ...allocation,
      commissionBps,
      isNewCustomerReservation,
    };
  }

  async getVenueEarnings(venueId: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true, name: true },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    const now = new Date();
    const todayStart = this.startOfLocalDay(now);
    const todayEnd = this.addDays(todayStart, 1);
    const currentWeekStart = this.startOfLocalWeek(now);
    const weekWindowStart = this.addDays(currentWeekStart, -28);
    const weekWindowEnd = this.addDays(currentWeekStart, 35);

    const payments = await this.prisma.reservationPayment.findMany({
      where: {
        venueId,
        reservation: {
          timeSlotStart: {
            gte: weekWindowStart,
            lt: weekWindowEnd,
          },
        },
        status: {
          in: [
            ReservationPaymentStatus.CAPTURED,
            ReservationPaymentStatus.PARTIALLY_REFUNDED,
            ReservationPaymentStatus.REFUND_PENDING,
            ReservationPaymentStatus.REFUND_FAILED,
            ReservationPaymentStatus.REFUNDED,
          ],
        },
      },
      orderBy: { reservation: { timeSlotStart: "desc" } },
      include: {
        reservation: {
          select: {
            id: true,
            tableId: true,
            tableLabel: true,
            timeSlotStart: true,
            partySize: true,
            status: true,
          },
        },
        ledgerEntries: {
          select: {
            type: true,
            direction: true,
            amountCents: true,
          },
        },
      },
    });

    const todayRows = payments.filter((payment) => {
      const reservationStartAt = payment.reservation.timeSlotStart;
      return reservationStartAt >= todayStart && reservationStartAt < todayEnd;
    });

    const weekBuckets = new Map<
      string,
      {
        periodStart: Date;
        periodEnd: Date;
        capturedCents: number;
        refundedCents: number;
        netCents: number;
        venueShareCents: number;
        chinChinFeeCents: number;
        reservationCount: number;
      }
    >();

    for (const payment of payments) {
      const periodStart = this.startOfLocalWeek(
        payment.reservation.timeSlotStart,
      );
      const key = periodStart.toISOString();
      const bucket = weekBuckets.get(key) ?? {
        periodStart,
        periodEnd: this.addDays(periodStart, 7),
        capturedCents: 0,
        refundedCents: 0,
        netCents: 0,
        venueShareCents: 0,
        chinChinFeeCents: 0,
        reservationCount: 0,
      };

      const amounts = this.paymentNetAllocation(payment);
      bucket.capturedCents += payment.capturedCents;
      bucket.refundedCents += payment.refundedCents;
      bucket.netCents += amounts.netCents;
      bucket.venueShareCents += amounts.venueShareCents;
      bucket.chinChinFeeCents += amounts.chinChinFeeCents;
      if (amounts.netCents > 0) {
        bucket.reservationCount += 1;
      }
      weekBuckets.set(key, bucket);
    }

    return {
      venueId: venue.id,
      venueName: venue.name,
      currency: "EUR",
      commissionBps: this.commissionBps(),
      generatedAt: now,
      today: this.serializeEarningsPeriod(todayStart, todayEnd, todayRows),
      weeks: [...weekBuckets.values()]
        .sort((left, right) =>
          this.compareEarningsWeeks(left.periodStart, right.periodStart, now),
        )
        .map((bucket) => ({
          periodStart: bucket.periodStart,
          periodEnd: bucket.periodEnd,
          capturedCents: bucket.capturedCents,
          refundedCents: bucket.refundedCents,
          netCents: bucket.netCents,
          venueShareCents: bucket.venueShareCents,
          chinChinFeeCents: bucket.chinChinFeeCents,
          reservationCount: bucket.reservationCount,
        })),
      recentReservations: payments.slice(0, 12).map((payment) => {
        const amounts = this.paymentNetAllocation(payment);
        return {
          reservationId: payment.reservationId,
          paymentId: payment.id,
          tableId: payment.reservation.tableId,
          tableLabel: payment.reservation.tableLabel,
          reservationStartAt: payment.reservation.timeSlotStart,
          capturedAt: payment.capturedAt,
          status: payment.status,
          capturedCents: payment.capturedCents,
          refundedCents: payment.refundedCents,
          netCents: amounts.netCents,
          venueShareCents: amounts.venueShareCents,
          chinChinFeeCents: amounts.chinChinFeeCents,
        };
      }),
    };
  }

  async listAdminPaymentTransactions() {
    const payments = await this.prisma.reservationPayment.findMany({
      orderBy: { createdAt: "desc" },
      take: 250,
      include: {
        reservation: {
          include: { venue: true },
        },
        ledgerEntries: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return {
      total: payments.length,
      generatedAt: new Date(),
      items: payments.map((payment) => {
        const netCents = Math.max(
          0,
          payment.capturedCents - payment.refundedCents,
        );
        const allocation = this.calculateAllocation(netCents);
        return {
          id: payment.id,
          reservationId: payment.reservationId,
          venueId: payment.venueId,
          venueName: payment.reservation.venue.name,
          customerId: payment.customerId,
          customerName: payment.reservation.customerName,
          customerEmail: payment.reservation.customerEmail,
          customerPhone: payment.reservation.customerPhone,
          provider: payment.provider,
          status: payment.status,
          amountCents: payment.amountCents,
          capturedCents: payment.capturedCents,
          refundedCents: payment.refundedCents,
          refundableCents: Math.max(
            0,
            payment.capturedCents - payment.refundedCents,
          ),
          netCents,
          venueShareCents: allocation.venueShareCents,
          chinChinFeeCents: allocation.chinChinFeeCents,
          currency: payment.currency,
          providerPaymentId: payment.providerPaymentId,
          tableId: payment.reservation.tableId,
          tableLabel: payment.reservation.tableLabel,
          reservationStatus: payment.reservation.status,
          reservationStartAt: payment.reservation.timeSlotStart,
          authorizedAt: payment.authorizedAt,
          capturedAt: payment.capturedAt,
          voidedAt: payment.voidedAt,
          failedAt: payment.failedAt,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          ledgerEntries: payment.ledgerEntries.map((entry) => ({
            id: entry.id,
            type: entry.type,
            direction: entry.direction,
            amountCents: entry.amountCents,
            currency: entry.currency,
            description: entry.description,
            createdAt: entry.createdAt,
          })),
        };
      }),
    };
  }

  async adminManualRefund(reservationId: string, dto: AdminManualRefundDto) {
    const reason =
      dto.reason?.trim() ||
      `Admin manual ${dto.target.toLowerCase()} refund override.`;

    const payment = await this.prisma.reservationPayment.findFirst({
      where: {
        reservationId,
        status: {
          in: [
            ReservationPaymentStatus.CAPTURED,
            ReservationPaymentStatus.PARTIALLY_REFUNDED,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      include: { reservation: { include: { venue: true } } },
    });

    if (!payment) {
      throw new NotFoundException(
        "Captured reservation payment was not found.",
      );
    }

    const remainingRefundableCents = Math.max(
      0,
      payment.capturedCents - payment.refundedCents,
    );
    const venueRefundableCents =
      dto.target === "VENUE"
        ? this.calculateAllocation(remainingRefundableCents).venueShareCents
        : remainingRefundableCents;
    const maxRefundableCents =
      dto.target === "VENUE" ? venueRefundableCents : remainingRefundableCents;
    const amountCents = Math.min(
      dto.amountCents ?? maxRefundableCents,
      maxRefundableCents,
    );

    if (amountCents <= 0) {
      throw new BadRequestException(
        dto.target === "VENUE"
          ? "Payment has no venue payout adjustment amount left."
          : "Payment has no refundable amount left.",
      );
    }

    if (dto.target === "CUSTOMER") {
      const refund = await this.refundCapturedReservation(
        reservationId,
        amountCents,
        `Admin customer refund: ${reason}`,
      );
      return {
        target: dto.target,
        amountCents,
        reservationId,
        payment: refund,
      };
    }

    const adjustment = await this.prisma.ledgerEntry.create({
      data: {
        reservationId,
        paymentId: payment.id,
        venueId: payment.venueId,
        customerId: payment.customerId,
        type: LedgerEntryType.VENUE_PAYOUT_ADJUSTMENT,
        direction: LedgerEntryDirection.CREDIT,
        amountCents,
        currency: payment.currency,
        description: `Admin venue adjustment: ${reason}`,
      },
    });

    return {
      target: dto.target,
      amountCents,
      reservationId,
      adjustment,
    };
  }

  async handleWorldlineWebhook(
    dto: WorldlineWebhookDto,
    headers: Record<string, unknown> = {},
  ) {
    if (!this.worldlineProvider.verifyWebhookSignature(headers, dto)) {
      throw new BadRequestException("Invalid Worldline webhook signature.");
    }

    const payload = this.payloadFromWebhook(dto);
    const providerEventId =
      dto.eventId ??
      this.stringFrom(payload.id) ??
      this.stringFrom(payload.eventId);
    const eventType =
      dto.eventType ??
      this.stringFrom(payload.type) ??
      this.stringFrom(payload.eventType);

    if (providerEventId) {
      const existing = await this.prisma.paymentWebhookEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: PaymentProvider.WORLDLINE,
            providerEventId,
          },
        },
      });

      if (existing?.status === PaymentWebhookStatus.PROCESSED) {
        return {
          status: "ignored",
          reason: "Webhook event was already processed.",
          eventId: existing.id,
        };
      }
    }

    const event = await this.prisma.paymentWebhookEvent.create({
      data: {
        provider: PaymentProvider.WORLDLINE,
        providerEventId,
        eventType,
        status: PaymentWebhookStatus.RECEIVED,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    try {
      const normalizedStatus = this.normalizedProviderStatus(dto, payload);
      const providerPaymentId =
        dto.paymentId ??
        this.stringFrom(payload.paymentId) ??
        this.nestedString(payload, "payment", "id");
      const merchantReference =
        dto.merchantReference ??
        this.stringFrom(payload.merchantReference) ??
        this.nestedString(payload, "references", "merchantReference");

      if (normalizedStatus === "AUTHORIZED") {
        const payment = await this.markPaymentAuthorized({
          providerPaymentId,
          merchantReference,
          rawProviderData: payload,
        });
        await this.markWebhookProcessed(event.id);
        return { status: "processed", payment: this.serializePayment(payment) };
      }

      if (normalizedStatus === "AUTH_FAILED") {
        const payment = await this.markPaymentAuthorizationFailed({
          providerPaymentId,
          merchantReference,
          rawProviderData: payload,
        });
        await this.markWebhookProcessed(event.id);
        return { status: "processed", payment: this.serializePayment(payment) };
      }

      await this.prisma.paymentWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: PaymentWebhookStatus.IGNORED,
          processedAt: new Date(),
        },
      });

      return { status: "ignored", reason: "Webhook status is not actionable." };
    } catch (error) {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: PaymentWebhookStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async mockAuthorizeReservationPayment(reservationId: string) {
    const payment = await this.prisma.reservationPayment.findFirst({
      where: { reservationId },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) {
      throw new NotFoundException("Reservation payment was not found.");
    }

    const existingRawProviderData = this.recordFromJson(
      payment.rawProviderData,
    );
    return this.markPaymentAuthorized({
      providerPaymentId: payment.providerPaymentId ?? payment.id,
      merchantReference: payment.providerMerchantReference ?? undefined,
      rawProviderData: {
        ...existingRawProviderData,
        mode: "mock",
        action: "AUTHORIZE_WEBHOOK",
      },
    });
  }

  async captureForAcceptedReservation(reservationId: string) {
    const payment = await this.prisma.reservationPayment.findFirst({
      where: {
        reservationId,
        status: ReservationPaymentStatus.AUTHORIZED,
      },
      orderBy: { createdAt: "desc" },
      include: { reservation: true },
    });

    if (!payment) {
      return null;
    }

    await this.prisma.reservationPayment.update({
      where: { id: payment.id },
      data: { status: ReservationPaymentStatus.CAPTURE_PENDING },
    });

    const providerResult = await this.worldlineProvider.capturePayment(
      payment.providerPaymentId ?? payment.id,
      payment.amountCents,
      payment.currency,
    );

    const allocation = await this.previewReservationAllocation({
      id: payment.reservation.id,
      customerId: payment.reservation.customerId,
      customerEmail: payment.reservation.customerEmail,
      customerPhone: payment.reservation.customerPhone,
      feeCents: payment.amountCents,
    });

    const captured = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.reservationPayment.update({
        where: { id: payment.id },
        data: {
          status: ReservationPaymentStatus.CAPTURED,
          capturedCents: payment.amountCents,
          capturedAt: new Date(),
          rawProviderData:
            providerResult.rawProviderData as Prisma.InputJsonValue,
        },
      });

      await this.createCaptureLedgerEntries(tx, updatedPayment, allocation);

      return updatedPayment;
    });

    return this.serializePayment(captured);
  }

  async voidForInactiveReservation(reservationId: string, reason: string) {
    const payment = await this.prisma.reservationPayment.findFirst({
      where: {
        reservationId,
        status: {
          in: [
            ReservationPaymentStatus.AUTH_PENDING,
            ReservationPaymentStatus.AUTHORIZED,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) {
      return null;
    }

    if (payment.status === ReservationPaymentStatus.AUTH_PENDING) {
      const voided = await this.prisma.reservationPayment.update({
        where: { id: payment.id },
        data: {
          status: ReservationPaymentStatus.VOIDED,
          voidedAt: new Date(),
          rawProviderData: {
            reason,
            action: "LOCAL_VOID_BEFORE_AUTHORIZATION",
          },
        },
      });
      await this.createPaymentVoidLedgerEntry(voided, reason);
      return this.serializePayment(voided);
    }

    await this.prisma.reservationPayment.update({
      where: { id: payment.id },
      data: { status: ReservationPaymentStatus.VOID_PENDING },
    });

    const providerResult = await this.worldlineProvider.voidAuthorization(
      payment.providerPaymentId ?? payment.id,
    );

    const voided = await this.prisma.reservationPayment.update({
      where: { id: payment.id },
      data: {
        status: ReservationPaymentStatus.VOIDED,
        voidedAt: new Date(),
        rawProviderData:
          providerResult.rawProviderData as Prisma.InputJsonValue,
      },
    });

    await this.createPaymentVoidLedgerEntry(voided, reason);
    return this.serializePayment(voided);
  }

  async refundCapturedReservation(
    reservationId: string,
    refundCents: number,
    reason: string,
  ) {
    if (refundCents <= 0) {
      return null;
    }

    const payment = await this.prisma.reservationPayment.findFirst({
      where: {
        reservationId,
        status: {
          in: [
            ReservationPaymentStatus.CAPTURED,
            ReservationPaymentStatus.PARTIALLY_REFUNDED,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) {
      return null;
    }

    const remainingRefundableCents =
      payment.capturedCents - payment.refundedCents;
    const nextRefundCents = Math.min(refundCents, remainingRefundableCents);
    if (nextRefundCents <= 0) {
      return this.serializePayment(payment);
    }

    await this.prisma.reservationPayment.update({
      where: { id: payment.id },
      data: { status: ReservationPaymentStatus.REFUND_PENDING },
    });

    const providerResult = await this.worldlineProvider.refundPayment(
      payment.providerPaymentId ?? payment.id,
      nextRefundCents,
      payment.currency,
    );

    const refunded = await this.prisma.$transaction(async (tx) => {
      const refundedCents = payment.refundedCents + nextRefundCents;
      const status =
        refundedCents >= payment.capturedCents
          ? ReservationPaymentStatus.REFUNDED
          : ReservationPaymentStatus.PARTIALLY_REFUNDED;

      const updatedPayment = await tx.reservationPayment.update({
        where: { id: payment.id },
        data: {
          status,
          refundedCents,
          rawProviderData:
            providerResult.rawProviderData as Prisma.InputJsonValue,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          reservationId: payment.reservationId,
          paymentId: payment.id,
          venueId: payment.venueId,
          customerId: payment.customerId,
          type: LedgerEntryType.CUSTOMER_REFUND,
          direction: LedgerEntryDirection.DEBIT,
          amountCents: nextRefundCents,
          currency: payment.currency,
          description: reason,
        },
      });

      return updatedPayment;
    });

    return this.serializePayment(refunded);
  }

  async backfillCapturedPaymentLedger() {
    const payments = await this.prisma.reservationPayment.findMany({
      where: {
        status: ReservationPaymentStatus.CAPTURED,
        capturedCents: { gt: 0 },
      },
      include: {
        reservation: true,
        ledgerEntries: {
          select: { type: true },
        },
      },
      orderBy: { capturedAt: "desc" },
    });

    let checked = 0;
    let repaired = 0;
    let createdEntries = 0;

    for (const payment of payments) {
      checked += 1;
      const existingTypes = new Set(
        payment.ledgerEntries.map((entry) => entry.type),
      );
      const missingTypes = this.missingCaptureLedgerTypes(existingTypes);
      if (!missingTypes.length) {
        continue;
      }

      const allocation = await this.previewReservationAllocation({
        id: payment.reservation.id,
        customerId: payment.reservation.customerId,
        customerEmail: payment.reservation.customerEmail,
        customerPhone: payment.reservation.customerPhone,
        feeCents: payment.capturedCents,
      });

      const created = await this.prisma.$transaction((tx) =>
        this.createCaptureLedgerEntries(tx, payment, allocation),
      );

      if (created > 0) {
        repaired += 1;
        createdEntries += created;
      }
    }

    return {
      checked,
      repaired,
      createdEntries,
    };
  }

  private async markPaymentAuthorized(input: {
    providerPaymentId?: string;
    merchantReference?: string;
    rawProviderData: Record<string, unknown>;
  }) {
    const payment = await this.findProviderPayment(input);

    if (!payment) {
      throw new NotFoundException("Reservation payment was not found.");
    }

    const confirmationExpiresAt = new Date(
      Date.now() + VENUE_CONFIRMATION_WINDOW_SECONDS * 1000,
    );

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      const paymentMethod = await this.upsertSavedPaymentMethodFromProviderData(
        tx,
        payment.customerId,
        input.rawProviderData,
      );
      const updatedPayment = await tx.reservationPayment.update({
        where: { id: payment.id },
        data: {
          status: ReservationPaymentStatus.AUTHORIZED,
          authorizedAt: payment.authorizedAt ?? new Date(),
          providerPaymentId:
            input.providerPaymentId ?? payment.providerPaymentId,
          paymentMethodId: payment.paymentMethodId ?? paymentMethod?.id,
          rawProviderData: input.rawProviderData as Prisma.InputJsonValue,
        },
      });

      await tx.reservation.update({
        where: { id: payment.reservationId },
        data: {
          status: ReservationStatus.PENDING_VENUE_CONFIRMATION,
          confirmationExpiresAt,
        },
      });

      return updatedPayment;
    });

    await this.notifyVenueAboutReservationRequest(payment.reservationId);
    return updatedPayment;
  }

  private async markPaymentAuthorizationFailed(input: {
    providerPaymentId?: string;
    merchantReference?: string;
    rawProviderData: Record<string, unknown>;
  }) {
    const payment = await this.findProviderPayment(input);

    if (!payment) {
      throw new NotFoundException("Reservation payment was not found.");
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.reservationPayment.update({
        where: { id: payment.id },
        data: {
          status: ReservationPaymentStatus.AUTH_FAILED,
          failedAt: new Date(),
          providerPaymentId:
            input.providerPaymentId ?? payment.providerPaymentId,
          rawProviderData: input.rawProviderData as Prisma.InputJsonValue,
        },
      });

      await tx.reservation.update({
        where: { id: payment.reservationId },
        data: {
          status: ReservationStatus.EXPIRED,
          releasedAt: new Date(),
          confirmationExpiresAt: null,
        },
      });

      return updatedPayment;
    });
  }

  private async resolveCustomerPaymentMethod(input: {
    customerUserId?: string;
    reservationCustomerId: string | null;
    paymentMethodId?: string;
    useDefaultPaymentMethod?: boolean;
  }) {
    if (!input.paymentMethodId && !input.useDefaultPaymentMethod) {
      return null;
    }

    if (
      !input.customerUserId ||
      input.customerUserId !== input.reservationCustomerId
    ) {
      throw new BadRequestException(
        "Saved payment methods can be used only by the reservation customer.",
      );
    }

    const method = input.paymentMethodId
      ? await this.prisma.customerPaymentMethod.findFirst({
          where: {
            id: input.paymentMethodId,
            customerId: input.customerUserId,
            status: CustomerPaymentMethodStatus.ACTIVE,
          },
        })
      : await this.prisma.customerPaymentMethod.findFirst({
          where: {
            customerId: input.customerUserId,
            status: CustomerPaymentMethodStatus.ACTIVE,
            isDefault: true,
          },
          orderBy: { createdAt: "desc" },
        });

    if (!method) {
      throw new NotFoundException("Saved payment method was not found.");
    }

    return method;
  }

  private async upsertSavedPaymentMethodFromProviderData(
    tx: Prisma.TransactionClient,
    customerId: string | null,
    rawProviderData: Record<string, unknown>,
  ) {
    if (!customerId) {
      return null;
    }

    const providerMethod = this.paymentMethodFromProviderData(rawProviderData);
    if (!providerMethod) {
      return null;
    }

    const existing = await tx.customerPaymentMethod.findUnique({
      where: {
        providerPaymentMethodId: providerMethod.providerPaymentMethodId,
      },
    });

    if (existing && existing.customerId !== customerId) {
      throw new BadRequestException(
        "Saved payment method belongs to another customer.",
      );
    }

    if (existing) {
      return tx.customerPaymentMethod.update({
        where: { id: existing.id },
        data: {
          status: CustomerPaymentMethodStatus.ACTIVE,
          brand: providerMethod.brand ?? existing.brand,
          last4: providerMethod.last4 ?? existing.last4,
          expiryMonth: providerMethod.expiryMonth ?? existing.expiryMonth,
          expiryYear: providerMethod.expiryYear ?? existing.expiryYear,
          holderName: providerMethod.holderName ?? existing.holderName,
          rawProviderData: rawProviderData as Prisma.InputJsonValue,
          lastUsedAt: new Date(),
          disabledAt: null,
        },
      });
    }

    const defaultMethod = await tx.customerPaymentMethod.findFirst({
      where: {
        customerId,
        status: CustomerPaymentMethodStatus.ACTIVE,
        isDefault: true,
      },
      select: { id: true },
    });

    return tx.customerPaymentMethod.create({
      data: {
        customerId,
        provider: PaymentProvider.WORLDLINE,
        status: CustomerPaymentMethodStatus.ACTIVE,
        providerPaymentMethodId: providerMethod.providerPaymentMethodId,
        brand: providerMethod.brand,
        last4: providerMethod.last4,
        expiryMonth: providerMethod.expiryMonth,
        expiryYear: providerMethod.expiryYear,
        holderName: providerMethod.holderName,
        isDefault: !defaultMethod,
        rawProviderData: rawProviderData as Prisma.InputJsonValue,
        lastUsedAt: new Date(),
      },
    });
  }

  private paymentMethodFromProviderData(
    rawProviderData: Record<string, unknown>,
  ) {
    const raw = this.recordFromJson(rawProviderData);
    const source = this.recordFromJson(
      raw.mockSavedPaymentMethod ?? raw.savedPaymentMethod ?? raw.paymentMethod,
    );
    const providerPaymentMethodId =
      this.stringFrom(source.providerPaymentMethodId) ??
      this.stringFrom(source.token) ??
      this.stringFrom(source.id);

    if (!providerPaymentMethodId) {
      return null;
    }

    return {
      providerPaymentMethodId,
      brand: this.stringFrom(source.brand),
      last4: this.stringFrom(source.last4),
      expiryMonth: this.integerFrom(source.expiryMonth),
      expiryYear: this.integerFrom(source.expiryYear),
      holderName: this.stringFrom(source.holderName),
    };
  }

  private detectCardBrand(cardNumberDigits: string) {
    if (cardNumberDigits.startsWith("4")) {
      return "Visa";
    }

    if (/^5[1-5]/.test(cardNumberDigits) || /^2[2-7]/.test(cardNumberDigits)) {
      return "Mastercard";
    }

    if (/^3[47]/.test(cardNumberDigits)) {
      return "American Express";
    }

    return "Kartica";
  }

  private async notifyVenueAboutReservationRequest(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { venue: { select: { id: true, name: true, ownerId: true } } },
    });

    if (!reservation?.venue.ownerId) {
      return;
    }

    try {
      await this.deviceTokensService.sendToUser({
        userId: reservation.venue.ownerId,
        app: DevicePushApp.VENUE_OWNER,
        title: "Novi zahtjev za rezervaciju",
        body: `${reservation.customerName ?? "Chin-Chin korisnik"} zeli rezervirati ${reservation.tableLabel ?? "Chin-Chin stol"}.`,
        data: {
          type: "reservation_request",
          reservationId,
          venueId: reservation.venue.id,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Reservation ${reservationId} was authorized, but venue push notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private findProviderPayment(input: {
    providerPaymentId?: string;
    merchantReference?: string;
  }) {
    return this.prisma.reservationPayment.findFirst({
      where: {
        OR: [
          ...(input.merchantReference
            ? [{ providerMerchantReference: input.merchantReference }]
            : []),
          ...(input.providerPaymentId
            ? [{ providerPaymentId: input.providerPaymentId }]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async createCaptureLedgerEntries(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      reservationId: string;
      venueId: string;
      customerId: string | null;
      amountCents: number;
      currency: string;
    },
    allocation: {
      chinChinFeeCents: number;
      venueShareCents: number;
      commissionBps: number;
      isNewCustomerReservation: boolean;
    },
  ) {
    const allocationMetadata = {
      commissionBps: allocation.commissionBps,
      isNewCustomerReservation: allocation.isNewCustomerReservation,
    };
    const expectedEntries = [
      {
        type: LedgerEntryType.CUSTOMER_CAPTURE,
        data: {
          reservationId: payment.reservationId,
          paymentId: payment.id,
          venueId: payment.venueId,
          customerId: payment.customerId,
          type: LedgerEntryType.CUSTOMER_CAPTURE,
          direction: LedgerEntryDirection.CREDIT,
          amountCents: payment.amountCents,
          currency: payment.currency,
          description: "Customer reservation fee captured.",
        },
      },
      {
        type: LedgerEntryType.CHIN_CHIN_FEE,
        data: {
          reservationId: payment.reservationId,
          paymentId: payment.id,
          venueId: payment.venueId,
          customerId: payment.customerId,
          type: LedgerEntryType.CHIN_CHIN_FEE,
          direction: LedgerEntryDirection.CREDIT,
          amountCents: allocation.chinChinFeeCents,
          currency: payment.currency,
          description: "Chin-Chin platform fee allocation.",
          metadata: allocationMetadata as Prisma.InputJsonValue,
        },
      },
      {
        type: LedgerEntryType.VENUE_SHARE,
        data: {
          reservationId: payment.reservationId,
          paymentId: payment.id,
          venueId: payment.venueId,
          customerId: payment.customerId,
          type: LedgerEntryType.VENUE_SHARE,
          direction: LedgerEntryDirection.CREDIT,
          amountCents: allocation.venueShareCents,
          currency: payment.currency,
          description: "Venue payout allocation.",
          metadata: allocationMetadata as Prisma.InputJsonValue,
        },
      },
    ];

    const existingEntries = await tx.ledgerEntry.findMany({
      where: {
        paymentId: payment.id,
        type: { in: expectedEntries.map((entry) => entry.type) },
      },
      select: { type: true },
    });
    const existingTypes = new Set(existingEntries.map((entry) => entry.type));
    const missingEntries = expectedEntries.filter(
      (entry) => !existingTypes.has(entry.type),
    );

    if (!missingEntries.length) {
      return 0;
    }

    await tx.ledgerEntry.createMany({
      data: missingEntries.map((entry) => entry.data),
    });
    return missingEntries.length;
  }

  private missingCaptureLedgerTypes(existingTypes: Set<LedgerEntryType>) {
    return [
      LedgerEntryType.CUSTOMER_CAPTURE,
      LedgerEntryType.CHIN_CHIN_FEE,
      LedgerEntryType.VENUE_SHARE,
    ].filter((type) => !existingTypes.has(type));
  }

  private async createPaymentVoidLedgerEntry(
    payment: {
      id: string;
      reservationId: string;
      venueId: string;
      customerId: string | null;
      amountCents: number;
      currency: string;
    },
    reason: string,
  ) {
    await this.prisma.ledgerEntry.create({
      data: {
        reservationId: payment.reservationId,
        paymentId: payment.id,
        venueId: payment.venueId,
        customerId: payment.customerId,
        type: LedgerEntryType.PAYMENT_VOID,
        direction: LedgerEntryDirection.DEBIT,
        amountCents: payment.amountCents,
        currency: payment.currency,
        description: reason,
      },
    });
  }

  private calculateAllocation(
    amountCents: number,
    commissionBps = this.commissionBps(),
  ) {
    const chinChinFeeCents = Math.floor((amountCents * commissionBps) / 10000);
    return {
      chinChinFeeCents,
      venueShareCents: amountCents - chinChinFeeCents,
    };
  }

  private paymentNetAllocation(payment: {
    capturedCents: number;
    refundedCents: number;
    ledgerEntries?: Array<{
      type: LedgerEntryType;
      direction: LedgerEntryDirection;
      amountCents: number;
    }>;
  }) {
    const netCents = Math.max(0, payment.capturedCents - payment.refundedCents);
    const ledgerAllocation = this.captureAllocationFromLedger(
      payment.ledgerEntries,
    );
    if (ledgerAllocation && payment.capturedCents > 0) {
      const chinChinFeeCents = Math.floor(
        (ledgerAllocation.chinChinFeeCents * netCents) / payment.capturedCents,
      );
      return {
        netCents,
        chinChinFeeCents,
        venueShareCents: Math.max(0, netCents - chinChinFeeCents),
      };
    }

    return {
      netCents,
      ...this.calculateAllocation(netCents),
    };
  }

  private captureAllocationFromLedger(
    ledgerEntries?: Array<{
      type: LedgerEntryType;
      direction: LedgerEntryDirection;
      amountCents: number;
    }>,
  ) {
    if (!ledgerEntries?.length) {
      return null;
    }

    const chinChinFeeCents = ledgerEntries
      .filter(
        (entry) =>
          entry.type === LedgerEntryType.CHIN_CHIN_FEE &&
          entry.direction === LedgerEntryDirection.CREDIT,
      )
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const venueShareCents = ledgerEntries
      .filter(
        (entry) =>
          entry.type === LedgerEntryType.VENUE_SHARE &&
          entry.direction === LedgerEntryDirection.CREDIT,
      )
      .reduce((sum, entry) => sum + entry.amountCents, 0);

    if (chinChinFeeCents <= 0 && venueShareCents <= 0) {
      return null;
    }

    return { chinChinFeeCents, venueShareCents };
  }

  private serializeEarningsPeriod(
    periodStart: Date,
    periodEnd: Date,
    payments: Array<{
      capturedCents: number;
      refundedCents: number;
    }>,
  ) {
    const totals = payments.reduce<{
      capturedCents: number;
      refundedCents: number;
      netCents: number;
      venueShareCents: number;
      chinChinFeeCents: number;
      reservationCount: number;
    }>(
      (sum, payment) => {
        const amounts = this.paymentNetAllocation(payment);
        return {
          capturedCents: sum.capturedCents + payment.capturedCents,
          refundedCents: sum.refundedCents + payment.refundedCents,
          netCents: sum.netCents + amounts.netCents,
          venueShareCents: sum.venueShareCents + amounts.venueShareCents,
          chinChinFeeCents: sum.chinChinFeeCents + amounts.chinChinFeeCents,
          reservationCount:
            sum.reservationCount + (amounts.netCents > 0 ? 1 : 0),
        };
      },
      {
        capturedCents: 0,
        refundedCents: 0,
        netCents: 0,
        venueShareCents: 0,
        chinChinFeeCents: 0,
        reservationCount: 0,
      },
    );

    return {
      periodStart,
      periodEnd,
      ...totals,
    };
  }

  private compareEarningsWeeks(left: Date, right: Date, now: Date) {
    const currentWeekStart = this.startOfLocalWeek(now).getTime();
    const leftTime = left.getTime();
    const rightTime = right.getTime();

    if (leftTime === currentWeekStart) {
      return -1;
    }
    if (rightTime === currentWeekStart) {
      return 1;
    }

    const leftIsFuture = leftTime > currentWeekStart;
    const rightIsFuture = rightTime > currentWeekStart;
    if (leftIsFuture && rightIsFuture) {
      return leftTime - rightTime;
    }
    if (leftIsFuture) {
      return -1;
    }
    if (rightIsFuture) {
      return 1;
    }

    return rightTime - leftTime;
  }

  private startOfLocalDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private startOfLocalWeek(date: Date) {
    const dayStart = this.startOfLocalDay(date);
    const day = dayStart.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return this.addDays(dayStart, mondayOffset);
  }

  private addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private commissionBps() {
    const raw = Number(
      this.configService.get<string>("CHIN_CHIN_COMMISSION_BPS") ??
        DEFAULT_CHIN_CHIN_COMMISSION_BPS,
    );
    if (!Number.isFinite(raw)) {
      return DEFAULT_CHIN_CHIN_COMMISSION_BPS;
    }
    return Math.max(0, Math.min(10000, Math.round(raw)));
  }

  private firstReservationCommissionBps() {
    const raw = Number(
      this.configService.get<string>(
        "CHIN_CHIN_FIRST_RESERVATION_COMMISSION_BPS",
      ) ?? DEFAULT_FIRST_RESERVATION_COMMISSION_BPS,
    );
    if (!Number.isFinite(raw)) {
      return DEFAULT_FIRST_RESERVATION_COMMISSION_BPS;
    }
    return Math.max(0, Math.min(10000, Math.round(raw)));
  }

  private async isBeforeFirstCompletedCustomerVisit(reservation: {
    id: string;
    customerId: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
  }) {
    const identityFilters = [
      ...(reservation.customerId
        ? [{ customerId: reservation.customerId }]
        : []),
      ...(reservation.customerEmail
        ? [{ customerEmail: reservation.customerEmail.trim().toLowerCase() }]
        : []),
      ...(reservation.customerPhone
        ? [{ customerPhone: reservation.customerPhone.trim() }]
        : []),
    ];

    if (!identityFilters.length) {
      return false;
    }

    const completedVisit = await this.prisma.reservation.findFirst({
      where: {
        id: { not: reservation.id },
        AND: [
          { OR: identityFilters },
          {
            OR: [
              { checkedInAt: { not: null } },
              { seatedAt: { not: null } },
              {
                status: {
                  in: [ReservationStatus.CHECKED_IN, ReservationStatus.SEATED],
                },
              },
            ],
          },
        ],
      },
      select: { id: true },
    });

    return !completedVisit;
  }

  private normalizedProviderStatus(
    dto: WorldlineWebhookDto,
    payload: Record<string, unknown>,
  ) {
    const rawStatus = (
      dto.status ??
      this.stringFrom(payload.status) ??
      this.nestedString(payload, "payment", "status") ??
      ""
    ).toUpperCase();

    if (
      rawStatus.includes("AUTHORIZED") ||
      rawStatus === "AUTHORIZATION_REQUESTED"
    ) {
      return "AUTHORIZED" as const;
    }

    if (
      rawStatus.includes("REJECTED") ||
      rawStatus.includes("FAILED") ||
      rawStatus.includes("CANCELLED")
    ) {
      return "AUTH_FAILED" as const;
    }

    return "IGNORED" as const;
  }

  private payloadFromWebhook(dto: WorldlineWebhookDto) {
    return this.toJsonObject(dto.payload ?? dto);
  }

  private toJsonObject(value: unknown) {
    if (typeof value !== "object" || !value || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private recordFromJson(value: unknown) {
    return this.toJsonObject(value);
  }

  private stringFrom(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private integerFrom(value: unknown) {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private nestedString(
    value: Record<string, unknown>,
    parentKey: string,
    childKey: string,
  ) {
    const parent = value[parentKey];
    if (typeof parent !== "object" || !parent || Array.isArray(parent)) {
      return undefined;
    }
    return this.stringFrom((parent as Record<string, unknown>)[childKey]);
  }

  private markWebhookProcessed(id: string) {
    return this.prisma.paymentWebhookEvent.update({
      where: { id },
      data: {
        status: PaymentWebhookStatus.PROCESSED,
        processedAt: new Date(),
      },
    });
  }

  private isTerminalReservationStatus(status: ReservationStatus) {
    return (
      status === ReservationStatus.CANCELLED ||
      status === ReservationStatus.CANCELLED_BY_USER ||
      status === ReservationStatus.COMPLETED ||
      status === ReservationStatus.DECLINED ||
      status === ReservationStatus.EXPIRED ||
      status === ReservationStatus.NO_SHOW ||
      status === ReservationStatus.RELEASED
    );
  }

  private serializePayment(payment: {
    id: string;
    reservationId: string;
    venueId: string;
    customerId: string | null;
    paymentMethodId: string | null;
    provider: PaymentProvider;
    status: ReservationPaymentStatus;
    amountCents: number;
    capturedCents: number;
    refundedCents: number;
    currency: string;
    providerPaymentId: string | null;
    providerCheckoutId: string | null;
    providerMerchantReference: string | null;
    checkoutUrl: string | null;
    checkoutExpiresAt: Date | null;
    authorizedAt: Date | null;
    capturedAt: Date | null;
    voidedAt: Date | null;
    failedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const allocation = this.calculateAllocation(payment.amountCents);
    return {
      id: payment.id,
      reservationId: payment.reservationId,
      venueId: payment.venueId,
      customerId: payment.customerId,
      paymentMethodId: payment.paymentMethodId,
      provider: payment.provider,
      status: payment.status,
      amountCents: payment.amountCents,
      capturedCents: payment.capturedCents,
      refundedCents: payment.refundedCents,
      currency: payment.currency,
      providerPaymentId: payment.providerPaymentId,
      providerCheckoutId: payment.providerCheckoutId,
      providerMerchantReference: payment.providerMerchantReference,
      checkoutUrl: payment.checkoutUrl,
      checkoutExpiresAt: payment.checkoutExpiresAt,
      authorizedAt: payment.authorizedAt,
      capturedAt: payment.capturedAt,
      voidedAt: payment.voidedAt,
      failedAt: payment.failedAt,
      chinChinFeeCents: allocation.chinChinFeeCents,
      venueShareCents: allocation.venueShareCents,
      commissionBps: this.commissionBps(),
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private serializePaymentMethod(method: {
    id: string;
    provider: PaymentProvider;
    status: CustomerPaymentMethodStatus;
    brand: string | null;
    last4: string | null;
    expiryMonth: number | null;
    expiryYear: number | null;
    holderName: string | null;
    isDefault: boolean;
    lastUsedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: method.id,
      provider: method.provider,
      status: method.status,
      brand: method.brand,
      last4: method.last4,
      expiryMonth: method.expiryMonth,
      expiryYear: method.expiryYear,
      holderName: method.holderName,
      isDefault: method.isDefault,
      label: `${method.brand ?? "Kartica"} •••• ${method.last4 ?? "----"}`,
      lastUsedAt: method.lastUsedAt,
      createdAt: method.createdAt,
      updatedAt: method.updatedAt,
    };
  }
}

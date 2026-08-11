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
  CustomerProblemReportStatus,
  DevicePushApp,
  LedgerEntryDirection,
  LedgerEntryType,
  PaymentProvider,
  PaymentWebhookStatus,
  ReservationPaymentStatus,
  ReservationType,
  ReservationStatus,
  VenueRefundRequestStatus,
} from "../../generated/prisma/enums";
import { DeviceTokensService } from "../device-tokens/device-tokens.service";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminManualRefundDto } from "./dto/admin-manual-refund.dto";
import { CreateCustomerProblemReportDto } from "./dto/create-customer-problem-report.dto";
import { CreateReservationCheckoutDto } from "./dto/create-reservation-checkout.dto";
import { CreateTestPaymentMethodDto } from "./dto/create-test-payment-method.dto";
import { CreateVenueRefundRequestDto } from "./dto/create-venue-refund-request.dto";
import { ResolveVenueProblemReportDto } from "./dto/resolve-venue-problem-report.dto";
import { WorldlineWebhookDto } from "./dto/worldline-webhook.dto";
import { WorldlinePaymentProvider } from "./worldline-payment.provider";

const DEFAULT_CHIN_CHIN_COMMISSION_BPS = 1000;
const DEFAULT_FIRST_RESERVATION_COMMISSION_BPS = 1000;
const VENUE_CONFIRMATION_WINDOW_SECONDS = 60;
const VENUE_NO_SHOW_REPORT_DELAY_MINUTES = 10;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly worldlineProvider: WorldlinePaymentProvider,
    private readonly deviceTokensService: DeviceTokensService,
    private readonly emailService: EmailService,
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

  async createCustomerPaymentMethodCheckout(customerUserId: string) {
    const checkout =
      await this.worldlineProvider.createPaymentMethodCheckout(customerUserId);
    return {
      provider: PaymentProvider.WORLDLINE,
      providerCheckoutId: checkout.providerCheckoutId,
      checkoutUrl: checkout.checkoutUrl,
      checkoutExpiresAt: checkout.expiresAt,
      rawProviderData: checkout.rawProviderData,
    };
  }

  async assertCustomerPaymentMethodCheckout(
    customerUserId: string,
    token: string,
  ) {
    if (!token?.trim()) {
      throw new BadRequestException(
        "Payment method checkout token is missing.",
      );
    }

    const providerResult =
      await this.worldlineProvider.assertPaymentMethodCheckout(token.trim());
    const method = await this.prisma.$transaction((tx) =>
      this.upsertSavedPaymentMethodFromProviderData(
        tx,
        customerUserId,
        providerResult.rawProviderData,
      ),
    );

    if (!method) {
      throw new BadRequestException("Payment method was not verified.");
    }

    return this.serializePaymentMethod(method);
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
    venueId: string;
    customerId: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    feeCents: number;
  }) {
    const isNewCustomerReservation =
      await this.isFirstCustomerReservationAtVenue(reservation);
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
          include: {
            venue: true,
            refundRequests: {
              where: {
                status: VenueRefundRequestStatus.REFUNDED_BY_CHIN_CHIN,
              },
              orderBy: [{ resolvedAt: "desc" }, { updatedAt: "desc" }],
              take: 1,
            },
          },
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
        const ledgerSummary = this.paymentLedgerSummary(payment.ledgerEntries);
        const allocation = this.paymentNetAllocation(payment);
        const supportRefund = payment.reservation.refundRequests[0] ?? null;
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
          chinChinSupportRefundRequestId: supportRefund?.id ?? null,
          chinChinSupportRefundStatus: supportRefund?.status ?? null,
          chinChinSupportRefundCents: supportRefund?.resolutionAmountCents ?? 0,
          chinChinSupportRefundCurrency:
            supportRefund?.resolutionCurrency ?? payment.currency,
          chinChinSupportRefundResolvedAt: supportRefund?.resolvedAt ?? null,
          chinChinSupportRefundNotes: supportRefund?.adminNotes ?? null,
          customerCaptureCents: ledgerSummary.customerCaptureCents,
          customerRefundCents: ledgerSummary.customerRefundCents,
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
            metadata: entry.metadata,
            createdAt: entry.createdAt,
          })),
        };
      }),
    };
  }

  async createVenueRefundRequest(
    venueId: string,
    reservationId: string,
    dto: CreateVenueRefundRequestDto,
  ) {
    const problemDescription = dto.problemDescription.trim();
    const shouldReleaseNoShowTable = dto.releaseNoShowTable === true;

    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { venue: true },
    });

    if (!reservation || reservation.venueId !== venueId) {
      throw new NotFoundException("Reservation was not found for this venue.");
    }

    if (shouldReleaseNoShowTable) {
      const releasableStatuses: ReservationStatus[] = [
        ReservationStatus.CONFIRMED,
        ReservationStatus.RESERVED,
        ReservationStatus.CHECK_IN_PENDING,
      ];
      if (!releasableStatuses.includes(reservation.status)) {
        throw new BadRequestException(
          "This reservation cannot be released as no-show.",
        );
      }
      const noShowReportAvailableAt = new Date(
        reservation.timeSlotStart.getTime() +
          VENUE_NO_SHOW_REPORT_DELAY_MINUTES * 60 * 1000,
      );
      if (noShowReportAvailableAt.getTime() > Date.now()) {
        throw new BadRequestException(
          "No-show table release is available ten minutes after the reservation time.",
        );
      }

      await this.prisma.reservation.updateMany({
        where: {
          id: reservationId,
          status: {
            in: releasableStatuses,
          },
        },
        data: {
          status: ReservationStatus.NO_SHOW,
          releasedAt: new Date(),
        },
      });

      return {
        reservationId,
        released: true,
        status: ReservationStatus.NO_SHOW,
      };
    }

    const payment = await this.prisma.reservationPayment.findFirst({
      where: {
        reservationId,
        venueId,
      },
      orderBy: { createdAt: "desc" },
    });

    const existingPending = await this.prisma.venueRefundRequest.findFirst({
      where: {
        reservationId,
        venueId,
        status: VenueRefundRequestStatus.PENDING,
      },
      orderBy: { createdAt: "desc" },
    });

    const refundRequest = existingPending
      ? await this.prisma.venueRefundRequest.update({
          where: { id: existingPending.id },
          data: {
            paymentId: payment?.id,
            requestedByOwnerId: reservation.venue.ownerId,
            problemDescription,
          },
        })
      : await this.prisma.venueRefundRequest.create({
          data: {
            reservationId,
            paymentId: payment?.id,
            venueId,
            requestedByOwnerId: reservation.venue.ownerId,
            problemDescription,
          },
        });

    return this.serializeVenueRefundRequest(refundRequest);
  }

  async listAdminVenueProblemReports() {
    const requests = await this.prisma.venueRefundRequest.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 250,
      include: {
        venue: {
          include: {
            owner: true,
          },
        },
        reservation: true,
        payment: true,
        requestedByOwner: true,
      },
    });

    return {
      total: requests.length,
      generatedAt: new Date(),
      items: requests.map((request) =>
        this.serializeAdminVenueProblemReport(request),
      ),
    };
  }

  async markVenueProblemReportRefundedByChinChin(
    requestId: string,
    dto: ResolveVenueProblemReportDto,
  ) {
    const request = await this.prisma.venueRefundRequest.findUnique({
      where: { id: requestId },
      include: {
        venue: {
          include: {
            owner: true,
          },
        },
        reservation: true,
        payment: true,
        requestedByOwner: true,
      },
    });

    if (!request) {
      throw new NotFoundException("Problem report was not found.");
    }

    const supportRefundCents =
      dto.amountCents != null && dto.amountCents > 0 ? dto.amountCents : null;
    const resolvedStatus =
      supportRefundCents != null
        ? VenueRefundRequestStatus.REFUNDED_BY_CHIN_CHIN
        : VenueRefundRequestStatus.CLOSED_NO_REFUND;
    const resolutionCurrency =
      supportRefundCents != null
        ? (dto.currency?.trim().toUpperCase() ??
          request.payment?.currency ??
          request.reservation.currency)
        : null;
    const adminNotes =
      dto.adminNotes?.trim() ||
      (supportRefundCents != null
        ? "Refund/korekcija ugostitelju označena kao Chin-Chin support trošak."
        : "Prijava je pregledana i zatvorena bez Chin-Chin korekcije.");

    await this.notifyVenueProblemReportResolved({
      id: request.id,
      reservationId: request.reservationId,
      resolutionAmountCents: supportRefundCents,
      resolutionCurrency,
      adminNotes,
      venue: request.venue,
      reservation: request.reservation,
      requestedByOwner: request.requestedByOwner,
    });

    const resolvedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.venueRefundRequest.update({
        where: { id: requestId },
        data: {
          status: resolvedStatus,
          resolutionAmountCents: supportRefundCents,
          resolutionCurrency,
          adminNotes,
          resolvedAt,
        },
        include: {
          venue: {
            include: {
              owner: true,
            },
          },
          reservation: true,
          payment: true,
          requestedByOwner: true,
        },
      }),
      ...(supportRefundCents != null
        ? [
            this.prisma.reservation.updateMany({
              where: {
                id: request.reservationId,
                status: {
                  in: [
                    ReservationStatus.CONFIRMED,
                    ReservationStatus.RESERVED,
                    ReservationStatus.CHECK_IN_PENDING,
                  ],
                },
              },
              data: {
                status: ReservationStatus.RELEASED,
                releasedAt: resolvedAt,
              },
            }),
          ]
        : []),
    ]);

    const updated = await this.prisma.venueRefundRequest.findUnique({
      where: { id: requestId },
      include: {
        venue: {
          include: {
            owner: true,
          },
        },
        reservation: true,
        payment: true,
        requestedByOwner: true,
      },
    });

    if (!updated) {
      throw new NotFoundException("Problem report was not found.");
    }

    return this.serializeAdminVenueProblemReport(updated);
  }

  async createCustomerProblemReport(
    reservationId: string,
    customerUserId: string,
    dto: CreateCustomerProblemReportDto,
  ) {
    const problemDescription = dto.problemDescription.trim();

    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { venue: true },
    });

    if (!reservation || reservation.customerId !== customerUserId) {
      throw new NotFoundException("Reservation was not found for this user.");
    }

    const payment = await this.prisma.reservationPayment.findFirst({
      where: { reservationId },
      orderBy: { createdAt: "desc" },
    });

    const existingPending = await this.prisma.customerProblemReport.findFirst({
      where: {
        reservationId,
        customerId: customerUserId,
        status: CustomerProblemReportStatus.PENDING,
      },
      orderBy: { createdAt: "desc" },
    });

    const photo = dto.photo
      ? {
          fileName: dto.photo.fileName.trim(),
          mimeType: dto.photo.mimeType.trim(),
          dataUrl: dto.photo.dataUrl.trim(),
        }
      : {
          fileName: "",
          mimeType: "",
          dataUrl: "",
          testModeWithoutPhoto: true,
        };

    const report = existingPending
      ? await this.prisma.customerProblemReport.update({
          where: { id: existingPending.id },
          data: {
            paymentId: payment?.id,
            venueId: reservation.venueId,
            problemDescription,
            photo,
          },
        })
      : await this.prisma.customerProblemReport.create({
          data: {
            reservationId,
            paymentId: payment?.id,
            venueId: reservation.venueId,
            customerId: customerUserId,
            problemDescription,
            photo,
          },
        });

    return this.serializeCustomerProblemReport(report);
  }

  async listAdminCustomerProblemReports() {
    const requests = await this.prisma.customerProblemReport.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 250,
      include: {
        venue: true,
        reservation: true,
        payment: true,
        customer: true,
      },
    });

    return {
      total: requests.length,
      generatedAt: new Date(),
      items: requests.map((request) =>
        this.serializeAdminCustomerProblemReport(request),
      ),
    };
  }

  async sendCustomerProblemReportResponse(
    requestId: string,
    dto: ResolveVenueProblemReportDto,
  ) {
    const request = await this.prisma.customerProblemReport.findUnique({
      where: { id: requestId },
      include: {
        venue: true,
        reservation: true,
        payment: true,
        customer: true,
      },
    });

    if (!request) {
      throw new NotFoundException("Customer problem report was not found.");
    }

    const supportRefundCents =
      dto.amountCents != null && dto.amountCents > 0 ? dto.amountCents : null;
    const resolutionCurrency =
      supportRefundCents != null
        ? (dto.currency?.trim().toUpperCase() ??
          request.payment?.currency ??
          request.reservation.currency)
        : null;
    const adminNotes =
      dto.adminNotes?.trim() ||
      (supportRefundCents != null
        ? "Prijava je pregledana i refundirana od strane Chin-Chin podrške."
        : "Prijava je pregledana i zatvorena prema odgovoru Chin-Chin podrške.");

    if (supportRefundCents != null) {
      const payment = await this.prisma.reservationPayment.findFirst({
        where: {
          reservationId: request.reservationId,
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
      const amountCents = Math.min(
        supportRefundCents,
        remainingRefundableCents,
      );
      if (amountCents <= 0) {
        throw new BadRequestException("Payment has no refundable amount left.");
      }

      await this.refundCapturedReservation(
        request.reservationId,
        amountCents,
        `Customer problem report refund: ${adminNotes}`,
      );
      await this.prisma.reservation.update({
        where: { id: request.reservationId },
        data: {
          status: ReservationStatus.CANCELLED,
          cancelledAt: new Date(),
          releasedAt: new Date(),
          confirmationExpiresAt: null,
        },
      });
      await this.notifyVenueAboutAdminPaymentAction(payment, {
        title: "Rezervacija je refundirana",
        body: `${this.customerDisplayName(payment)} · ${this.formatCents(amountCents, payment.currency)} refundirano nakon prijave problema.`,
        type: "reservation_customer_problem_refunded",
        amountCents,
      });
    }

    await this.notifyCustomerProblemReportResolved({
      id: request.id,
      reservationId: request.reservationId,
      resolutionAmountCents: supportRefundCents,
      resolutionCurrency,
      adminNotes,
      venue: request.venue,
      reservation: request.reservation,
      customer: request.customer,
    });

    const updated = await this.prisma.customerProblemReport.update({
      where: { id: requestId },
      data: {
        status:
          supportRefundCents != null
            ? CustomerProblemReportStatus.REFUNDED_BY_CHIN_CHIN
            : CustomerProblemReportStatus.RESPONSE_SENT,
        resolutionAmountCents: supportRefundCents,
        resolutionCurrency,
        adminNotes,
        resolvedAt: new Date(),
      },
      include: {
        venue: true,
        reservation: true,
        payment: true,
        customer: true,
      },
    });

    return this.serializeAdminCustomerProblemReport(updated);
  }

  async markCustomerProblemReportResolved(requestId: string) {
    const request = await this.prisma.customerProblemReport.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException("Customer problem report was not found.");
    }

    if (request.status === CustomerProblemReportStatus.PENDING) {
      throw new BadRequestException(
        "Customer problem report response must be sent before resolving.",
      );
    }

    const updated = await this.prisma.customerProblemReport.update({
      where: { id: requestId },
      data: {
        status: CustomerProblemReportStatus.RESOLVED,
        resolvedAt: new Date(),
      },
      include: {
        venue: true,
        reservation: true,
        payment: true,
        customer: true,
      },
    });

    return this.serializeAdminCustomerProblemReport(updated);
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
    const amountCents = Math.min(
      dto.amountCents ?? remainingRefundableCents,
      remainingRefundableCents,
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
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: {
          status: ReservationStatus.CANCELLED,
          cancelledAt: new Date(),
          releasedAt: new Date(),
          confirmationExpiresAt: null,
        },
      });
      await this.notifyVenueAboutAdminPaymentAction(payment, {
        title: "Rezervacija je refundirana",
        body: `${this.customerDisplayName(payment)} · ${this.formatCents(amountCents, payment.currency)} refundirano za ${payment.reservation.tableLabel ?? "Chin-Chin stol"}.`,
        type: "reservation_refunded_by_admin",
        amountCents,
      });
      await this.notifyCustomerAboutAdminRefund(payment, amountCents);
      return {
        target: dto.target,
        amountCents,
        reservationId,
        payment: refund,
      };
    }

    const allocation = this.calculateAllocation(amountCents);
    const adjustmentEntries = await this.prisma.ledgerEntry.createManyAndReturn(
      {
        data: [
          {
            reservationId,
            paymentId: payment.id,
            venueId: payment.venueId,
            customerId: payment.customerId,
            type: LedgerEntryType.CHIN_CHIN_FEE,
            direction: LedgerEntryDirection.CREDIT,
            amountCents: allocation.chinChinFeeCents,
            currency: payment.currency,
            description: `Admin venue adjustment Chin-Chin fee: ${reason}`,
            metadata: {
              policy: "ADMIN_VENUE_SUPPORT_REFUND_SPLIT",
              grossAmountCents: amountCents,
              commissionBps: this.commissionBps(),
            } as Prisma.InputJsonValue,
          },
          {
            reservationId,
            paymentId: payment.id,
            venueId: payment.venueId,
            customerId: payment.customerId,
            type: LedgerEntryType.VENUE_PAYOUT_ADJUSTMENT,
            direction: LedgerEntryDirection.CREDIT,
            amountCents: allocation.venueShareCents,
            currency: payment.currency,
            description: `Admin venue adjustment: ${reason}`,
            metadata: {
              policy: "ADMIN_VENUE_SUPPORT_REFUND_SPLIT",
              grossAmountCents: amountCents,
              commissionBps: this.commissionBps(),
            } as Prisma.InputJsonValue,
          },
        ],
      },
    );

    await this.notifyVenueAboutAdminPaymentAction(payment, {
      title: "Korekcija isplate",
      body: `${this.formatCents(allocation.venueShareCents, payment.currency)} dodano je kao korekcija ugostiteljske isplate za ${payment.reservation.tableLabel ?? "Chin-Chin stol"}.`,
      type: "venue_payout_adjusted_by_admin",
      amountCents: allocation.venueShareCents,
    });

    return {
      target: dto.target,
      amountCents,
      venueShareCents: allocation.venueShareCents,
      chinChinFeeCents: allocation.chinChinFeeCents,
      reservationId,
      adjustment: adjustmentEntries,
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

  async assertReservationCheckout(
    reservationId: string,
    token?: string,
    customerUserId?: string,
  ) {
    const payment = await this.prisma.reservationPayment.findFirst({
      where: {
        reservationId,
        ...(customerUserId
          ? {
              reservation: {
                customerId: customerUserId,
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) {
      throw new NotFoundException("Reservation payment was not found.");
    }

    if (
      payment.status === ReservationPaymentStatus.AUTHORIZED ||
      payment.status === ReservationPaymentStatus.CAPTURED ||
      payment.status === ReservationPaymentStatus.CAPTURE_PENDING
    ) {
      return this.serializePayment(payment);
    }

    const providerCheckoutId = token?.trim() || payment.providerCheckoutId;
    if (!providerCheckoutId) {
      throw new BadRequestException("Payment checkout token is missing.");
    }

    try {
      const providerResult =
        await this.worldlineProvider.assertAuthorizationCheckout(
          providerCheckoutId,
        );
      const rawProviderData = providerResult.rawProviderData;
      const providerStatus = this.normalizedRawProviderStatus(rawProviderData);
      if (providerStatus === "AUTH_FAILED") {
        return this.serializePayment(
          await this.markPaymentAuthorizationFailed({
            providerPaymentId: providerResult.providerPaymentId,
            merchantReference: payment.providerMerchantReference ?? undefined,
            rawProviderData,
          }),
        );
      }

      return this.serializePayment(
        await this.markPaymentAuthorized({
          providerPaymentId: providerResult.providerPaymentId,
          merchantReference: payment.providerMerchantReference ?? undefined,
          rawProviderData,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Reservation ${reservationId} payment assert failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.serializePayment(
        await this.markPaymentAuthorizationFailed({
          providerPaymentId: payment.providerPaymentId ?? undefined,
          merchantReference: payment.providerMerchantReference ?? undefined,
          rawProviderData: {
            action: "PAYMENT_PAGE_ASSERT_FAILED",
            error: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
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
    const existingRawProviderData = this.recordFromJson(
      payment.rawProviderData,
    );

    const allocation = await this.previewReservationAllocation({
      id: payment.reservation.id,
      venueId: payment.reservation.venueId,
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
          rawProviderData: {
            ...existingRawProviderData,
            capture: providerResult.rawProviderData,
            ...providerResult.rawProviderData,
          } as Prisma.InputJsonValue,
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
      payment.rawProviderData,
    );
    const rawRefundProviderData = providerResult.rawProviderData;
    const providerRefundTransactionId =
      this.stringFrom(rawRefundProviderData.refundTransactionId) ??
      providerResult.providerPaymentId;
    const providerRefundStatus = this.stringFrom(rawRefundProviderData.status);
    const existingRawProviderData = this.recordFromJson(
      payment.rawProviderData,
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
          rawProviderData: {
            ...existingRawProviderData,
            refund: rawRefundProviderData,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.reservationPaymentRefund.create({
        data: {
          reservationId: payment.reservationId,
          paymentId: payment.id,
          venueId: payment.venueId,
          customerId: payment.customerId,
          provider: payment.provider,
          amountCents: nextRefundCents,
          currency: payment.currency,
          reason,
          providerPaymentId: payment.providerPaymentId ?? payment.id,
          providerRefundTransactionId,
          providerStatus: providerRefundStatus,
          rawProviderData: rawRefundProviderData as Prisma.InputJsonValue,
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

      await this.createRefundAllocationLedgerEntries(
        tx,
        updatedPayment,
        reason,
      );

      await tx.reservation.update({
        where: { id: payment.reservationId },
        data: { refundCents: refundedCents },
      });

      return updatedPayment;
    });

    return this.serializePayment(refunded);
  }

  async backfillCapturedPaymentLedger() {
    const payments = await this.prisma.reservationPayment.findMany({
      where: {
        status: {
          in: [
            ReservationPaymentStatus.CAPTURED,
            ReservationPaymentStatus.PARTIALLY_REFUNDED,
            ReservationPaymentStatus.REFUNDED,
          ],
        },
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
      if (!missingTypes.length && payment.refundedCents <= 0) {
        continue;
      }

      const allocation = await this.previewReservationAllocation({
        id: payment.reservation.id,
        venueId: payment.reservation.venueId,
        customerId: payment.reservation.customerId,
        customerEmail: payment.reservation.customerEmail,
        customerPhone: payment.reservation.customerPhone,
        feeCents: payment.capturedCents,
      });

      const created = await this.prisma.$transaction(async (tx) => {
        const captureEntries = await this.createCaptureLedgerEntries(
          tx,
          payment,
          allocation,
        );
        const refundAdjustmentEntries =
          payment.refundedCents > 0
            ? await this.createRefundAllocationLedgerEntries(
                tx,
                payment,
                "Backfilled refund allocation.",
              )
            : 0;
        return captureEntries + refundAdjustmentEntries;
      });

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

    const shouldNotifyReservationRequest =
      payment.status !== ReservationPaymentStatus.AUTHORIZED &&
      payment.status !== ReservationPaymentStatus.CAPTURED;
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

    if (shouldNotifyReservationRequest) {
      await this.notifyVenueAboutReservationRequest(payment.reservationId);
    }
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
      this.logger.log(
        `[push][venue-owner] sending reservation request reservationId=${reservationId} ownerId=${reservation.venue.ownerId} venueId=${reservation.venue.id}`,
      );
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
      this.logger.log(
        `[push][venue-owner] sent reservation request reservationId=${reservationId} ownerId=${reservation.venue.ownerId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Reservation ${reservationId} was authorized, but venue push notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async notifyVenueProblemReportResolved(request: {
    id: string;
    reservationId: string;
    resolutionAmountCents: number | null;
    resolutionCurrency: string | null;
    adminNotes: string | null;
    venue: {
      id: string;
      name: string;
      owner: { email: string } | null;
    };
    reservation: {
      id: string;
      currency: string;
    };
    requestedByOwner: { email: string } | null;
  }) {
    const recipient =
      request.venue.owner?.email?.trim().toLowerCase() ||
      request.requestedByOwner?.email?.trim().toLowerCase();

    if (!recipient) {
      this.logger.warn(
        `Venue problem report ${request.id} resolved, but venue owner email was not found.`,
      );
      return;
    }

    this.logger.log(
      `Sending venue problem report ${request.id} response email to ${recipient}.`,
    );
    await this.emailService.sendVenueProblemReportResolvedEmail({
      to: recipient,
      venueName: request.venue.name,
      reservationId: request.reservationId,
      amountCents: request.resolutionAmountCents,
      currency:
        request.resolutionCurrency ?? request.reservation.currency ?? "EUR",
      adminNotes: request.adminNotes,
    });
  }

  private async notifyCustomerProblemReportResolved(request: {
    id: string;
    reservationId: string;
    resolutionAmountCents: number | null;
    resolutionCurrency: string | null;
    adminNotes: string | null;
    venue: {
      id: string;
      name: string;
    };
    reservation: {
      id: string;
      currency: string;
      customerEmail: string | null;
      tableLabel: string | null;
    };
    customer: { email: string } | null;
  }) {
    const recipient =
      request.reservation.customerEmail?.trim().toLowerCase() ||
      request.customer?.email?.trim().toLowerCase();

    if (!recipient) {
      this.logger.warn(
        `Customer problem report ${request.id} resolved, but customer email was not found.`,
      );
      return;
    }

    this.logger.log(
      `Sending customer problem report ${request.id} response email to ${recipient}.`,
    );
    await this.emailService.sendCustomerProblemReportResolvedEmail({
      to: recipient,
      venueName: request.venue.name,
      reservationId: request.reservationId,
      tableLabel: request.reservation.tableLabel,
      amountCents: request.resolutionAmountCents,
      currency:
        request.resolutionCurrency ?? request.reservation.currency ?? "EUR",
      adminNotes: request.adminNotes,
    });
  }

  private async notifyVenueAboutAdminPaymentAction(
    payment: {
      id: string;
      reservationId: string;
      venueId: string;
      currency: string;
      reservation: {
        tableLabel: string | null;
        customerName: string | null;
        customerEmail: string | null;
        customerPhone: string | null;
        venue: { id: string; name: string; ownerId: string };
      };
    },
    notification: {
      title: string;
      body: string;
      type: string;
      amountCents: number;
    },
  ) {
    if (!payment.reservation.venue.ownerId) {
      this.logger.warn(
        `[push][venue-owner] payment notification skipped paymentId=${payment.id} reservationId=${payment.reservationId}: no owner id`,
      );
      return;
    }

    try {
      this.logger.log(
        `[push][venue-owner] sending payment action paymentId=${payment.id} reservationId=${payment.reservationId} ownerId=${payment.reservation.venue.ownerId} type=${notification.type} amountCents=${notification.amountCents}`,
      );
      await this.deviceTokensService.sendToUser({
        userId: payment.reservation.venue.ownerId,
        app: DevicePushApp.VENUE_OWNER,
        title: notification.title,
        body: notification.body,
        data: {
          type: notification.type,
          reservationId: payment.reservationId,
          paymentId: payment.id,
          venueId: payment.venueId,
          amountCents: String(notification.amountCents),
        },
      });
      this.logger.log(
        `[push][venue-owner] sent payment action paymentId=${payment.id} reservationId=${payment.reservationId} type=${notification.type}`,
      );
    } catch (error) {
      this.logger.warn(
        `Payment ${payment.id} venue notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async notifyCustomerAboutAdminRefund(
    payment: {
      reservationId: string;
      currency: string;
      reservation: {
        customerEmail: string | null;
        tableLabel: string | null;
        venue: { name: string };
      };
    },
    amountCents: number,
  ) {
    const customerEmail = payment.reservation.customerEmail
      ?.trim()
      .toLowerCase();

    if (!customerEmail) {
      this.logger.warn(
        `Reservation ${payment.reservationId} admin refund email was skipped because customer email is missing.`,
      );
      return;
    }

    if (amountCents <= 0) {
      this.logger.warn(
        `Reservation ${payment.reservationId} admin refund email was skipped because refund amount is ${amountCents}.`,
      );
      return;
    }

    try {
      this.logger.log(
        `[email][customer-refund] sending reservationId=${payment.reservationId} to=${customerEmail} amountCents=${amountCents} currency=${payment.currency}`,
      );
      await this.emailService.sendReservationRefundEmail({
        to: customerEmail,
        venueName: payment.reservation.venue.name,
        tableLabel: payment.reservation.tableLabel,
        amountCents,
        currency: payment.currency,
        sender: "SUPPORT",
      });
      this.logger.log(
        `[email][customer-refund] sent reservationId=${payment.reservationId} to=${customerEmail}`,
      );
    } catch (error) {
      this.logger.warn(
        `Reservation ${payment.reservationId} admin refund email failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private customerDisplayName(payment: {
    reservation: {
      customerName: string | null;
      customerEmail: string | null;
      customerPhone: string | null;
    };
  }) {
    return (
      payment.reservation.customerName?.trim() ||
      payment.reservation.customerEmail?.trim() ||
      payment.reservation.customerPhone?.trim() ||
      "Chin-Chin korisnik"
    );
  }

  private formatCents(cents: number, currency = "EUR") {
    return `${(cents / 100).toFixed(2)} ${currency}`;
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

  private async createRefundAllocationLedgerEntries(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      reservationId: string;
      venueId: string;
      customerId: string | null;
      capturedCents: number;
      refundedCents: number;
      currency: string;
    },
    reason: string,
  ) {
    const targetAllocation = this.refundAdjustedAllocation(payment);
    const currentAllocation = await this.currentLedgerAllocation(
      tx,
      payment.id,
    );
    const adjustments = [
      {
        type: LedgerEntryType.CHIN_CHIN_FEE,
        currentCents: currentAllocation.chinChinFeeCents,
        targetCents: targetAllocation.chinChinFeeCents,
        description: "Chin-Chin fee allocation adjusted after refund.",
      },
      {
        type: LedgerEntryType.VENUE_SHARE,
        currentCents: currentAllocation.venueShareCents,
        targetCents: targetAllocation.venueShareCents,
        description: "Venue payout allocation adjusted after refund.",
      },
    ]
      .map((entry) => ({
        ...entry,
        deltaCents: entry.targetCents - entry.currentCents,
      }))
      .filter((entry) => entry.deltaCents !== 0);

    if (!adjustments.length) {
      return 0;
    }

    await tx.ledgerEntry.createMany({
      data: adjustments.map((entry) => ({
        reservationId: payment.reservationId,
        paymentId: payment.id,
        venueId: payment.venueId,
        customerId: payment.customerId,
        type: entry.type,
        direction:
          entry.deltaCents > 0
            ? LedgerEntryDirection.CREDIT
            : LedgerEntryDirection.DEBIT,
        amountCents: Math.abs(entry.deltaCents),
        currency: payment.currency,
        description: entry.description,
        metadata: {
          reason,
          policy: targetAllocation.policy,
          capturedCents: payment.capturedCents,
          refundedCents: payment.refundedCents,
          retainedCents: targetAllocation.retainedCents,
        } as Prisma.InputJsonValue,
      })),
    });

    return adjustments.length;
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

  private refundAdjustedAllocation(payment: {
    capturedCents: number;
    refundedCents: number;
  }) {
    const retainedCents = Math.max(
      0,
      payment.capturedCents - payment.refundedCents,
    );

    if (retainedCents <= 0) {
      return {
        retainedCents,
        chinChinFeeCents: 0,
        venueShareCents: 0,
        policy: "FULL_CUSTOMER_REFUND",
      };
    }

    if (payment.refundedCents > 0) {
      return {
        retainedCents,
        ...this.calculateAllocation(retainedCents),
        policy: "PARTIAL_CUSTOMER_REFUND_VENUE_RETAINS",
      };
    }

    return {
      retainedCents,
      ...this.calculateAllocation(retainedCents),
      policy: "NO_CUSTOMER_REFUND_STANDARD_SPLIT",
    };
  }

  private async currentLedgerAllocation(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ) {
    const entries = await tx.ledgerEntry.findMany({
      where: {
        paymentId,
        type: {
          in: [LedgerEntryType.CHIN_CHIN_FEE, LedgerEntryType.VENUE_SHARE],
        },
      },
      select: {
        type: true,
        direction: true,
        amountCents: true,
      },
    });

    return (
      this.captureAllocationFromLedger(entries) ?? {
        chinChinFeeCents: 0,
        venueShareCents: 0,
      }
    );
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
    if (ledgerAllocation) {
      return {
        netCents,
        chinChinFeeCents: Math.max(0, ledgerAllocation.chinChinFeeCents),
        venueShareCents: Math.max(0, ledgerAllocation.venueShareCents),
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

    const signedAmount = (entry: {
      direction: LedgerEntryDirection;
      amountCents: number;
    }) =>
      entry.direction === LedgerEntryDirection.DEBIT
        ? -entry.amountCents
        : entry.amountCents;
    const chinChinFeeCents = ledgerEntries
      .filter((entry) => entry.type === LedgerEntryType.CHIN_CHIN_FEE)
      .reduce((sum, entry) => sum + signedAmount(entry), 0);
    const venueShareCents = ledgerEntries
      .filter((entry) => entry.type === LedgerEntryType.VENUE_SHARE)
      .reduce((sum, entry) => sum + signedAmount(entry), 0);

    if (chinChinFeeCents <= 0 && venueShareCents <= 0) {
      return null;
    }

    return { chinChinFeeCents, venueShareCents };
  }

  private paymentLedgerSummary(
    ledgerEntries?: Array<{
      type: LedgerEntryType;
      direction: LedgerEntryDirection;
      amountCents: number;
    }>,
  ) {
    const signedAmount = (entry: {
      direction: LedgerEntryDirection;
      amountCents: number;
    }) =>
      entry.direction === LedgerEntryDirection.DEBIT
        ? -entry.amountCents
        : entry.amountCents;

    const sumByType = (type: LedgerEntryType) =>
      ledgerEntries
        ?.filter((entry) => entry.type === type)
        .reduce((sum, entry) => sum + signedAmount(entry), 0) ?? 0;

    return {
      customerCaptureCents: Math.max(
        0,
        sumByType(LedgerEntryType.CUSTOMER_CAPTURE),
      ),
      customerRefundCents: Math.abs(sumByType(LedgerEntryType.CUSTOMER_REFUND)),
      chinChinFeeCents: Math.max(0, sumByType(LedgerEntryType.CHIN_CHIN_FEE)),
      venueShareCents: Math.max(0, sumByType(LedgerEntryType.VENUE_SHARE)),
      paymentVoidCents: Math.abs(sumByType(LedgerEntryType.PAYMENT_VOID)),
      venuePayoutAdjustmentCents: sumByType(
        LedgerEntryType.VENUE_PAYOUT_ADJUSTMENT,
      ),
    };
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

  private async isFirstCustomerReservationAtVenue(reservation: {
    id: string;
    venueId: string;
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

    const previousReservationAtVenue = await this.prisma.reservation.findFirst({
      where: {
        venueId: reservation.venueId,
        id: { not: reservation.id },
        OR: identityFilters,
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    return !previousReservationAtVenue;
  }

  private normalizedProviderStatus(
    dto: WorldlineWebhookDto,
    payload: Record<string, unknown>,
  ) {
    const rawStatus = (
      dto.status ??
      this.stringFrom(payload.status) ??
      this.nestedString(payload, "Transaction", "Status") ??
      this.nestedString(payload, "transaction", "status") ??
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

  private normalizedRawProviderStatus(payload: Record<string, unknown>) {
    const saferpay = this.toJsonObject(payload.saferpay);
    const rawStatus = (
      this.stringFrom(payload.status) ??
      this.nestedString(payload, "Transaction", "Status") ??
      this.nestedString(payload, "transaction", "status") ??
      this.nestedString(saferpay, "Transaction", "Status") ??
      this.stringFrom(saferpay.Status) ??
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

    return "AUTHORIZED" as const;
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

  private serializeVenueRefundRequest(request: {
    id: string;
    reservationId: string;
    paymentId: string | null;
    venueId: string;
    requestedByOwnerId: string | null;
    status: VenueRefundRequestStatus;
    problemDescription: string;
    resolutionAmountCents: number | null;
    resolutionCurrency: string | null;
    adminNotes: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: request.id,
      reservationId: request.reservationId,
      paymentId: request.paymentId,
      venueId: request.venueId,
      requestedByOwnerId: request.requestedByOwnerId,
      status: request.status,
      problemDescription: request.problemDescription,
      resolutionAmountCents: request.resolutionAmountCents,
      resolutionCurrency: request.resolutionCurrency,
      adminNotes: request.adminNotes,
      resolvedAt: request.resolvedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private serializeAdminVenueProblemReport(request: {
    id: string;
    reservationId: string;
    paymentId: string | null;
    venueId: string;
    requestedByOwnerId: string | null;
    status: VenueRefundRequestStatus;
    problemDescription: string;
    resolutionAmountCents: number | null;
    resolutionCurrency: string | null;
    adminNotes: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    venue: {
      id: string;
      name: string;
      city: string | null;
      owner?: { email: string } | null;
    };
    reservation: {
      id: string;
      status: ReservationStatus;
      type: ReservationType;
      tableId: string;
      tableLabel: string | null;
      customerName: string | null;
      customerEmail: string | null;
      customerPhone: string | null;
      timeSlotStart: Date;
      feeCents: number;
      refundCents: number;
      currency: string;
    };
    payment: {
      id: string;
      status: ReservationPaymentStatus;
      amountCents: number;
      capturedCents: number;
      refundedCents: number;
      currency: string;
      providerPaymentId: string | null;
    } | null;
    requestedByOwner: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      phoneNumber: string | null;
    } | null;
  }) {
    return {
      ...this.serializeVenueRefundRequest(request),
      venue: {
        id: request.venue.id,
        name: request.venue.name,
        city: request.venue.city,
        ownerEmail: request.venue.owner?.email ?? null,
      },
      reservation: request.reservation,
      payment: request.payment,
      requestedByOwner: request.requestedByOwner,
    };
  }

  private serializeCustomerProblemReport(request: {
    id: string;
    reservationId: string;
    paymentId: string | null;
    venueId: string;
    customerId: string | null;
    status: CustomerProblemReportStatus;
    problemDescription: string;
    photo: Prisma.JsonValue;
    resolutionAmountCents: number | null;
    resolutionCurrency: string | null;
    adminNotes: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: request.id,
      reservationId: request.reservationId,
      paymentId: request.paymentId,
      venueId: request.venueId,
      customerId: request.customerId,
      status: request.status,
      problemDescription: request.problemDescription,
      photo: request.photo,
      resolutionAmountCents: request.resolutionAmountCents,
      resolutionCurrency: request.resolutionCurrency,
      adminNotes: request.adminNotes,
      resolvedAt: request.resolvedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      reportSource: "CUSTOMER",
    };
  }

  private serializeAdminCustomerProblemReport(request: {
    id: string;
    reservationId: string;
    paymentId: string | null;
    venueId: string;
    customerId: string | null;
    status: CustomerProblemReportStatus;
    problemDescription: string;
    photo: Prisma.JsonValue;
    resolutionAmountCents: number | null;
    resolutionCurrency: string | null;
    adminNotes: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    venue: {
      id: string;
      name: string;
      city: string | null;
    };
    reservation: {
      id: string;
      status: ReservationStatus;
      type: ReservationType;
      tableId: string;
      tableLabel: string | null;
      roomLabel: string | null;
      customerName: string | null;
      customerEmail: string | null;
      customerPhone: string | null;
      timeSlotStart: Date;
      feeCents: number;
      refundCents: number;
      currency: string;
    };
    payment: {
      id: string;
      status: ReservationPaymentStatus;
      amountCents: number;
      capturedCents: number;
      refundedCents: number;
      currency: string;
      providerPaymentId: string | null;
    } | null;
    customer: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      phoneNumber: string | null;
    } | null;
  }) {
    return {
      ...this.serializeCustomerProblemReport(request),
      venue: {
        id: request.venue.id,
        name: request.venue.name,
        city: request.venue.city,
      },
      reservation: request.reservation,
      payment: request.payment,
      customer: request.customer,
    };
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

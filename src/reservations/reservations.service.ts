import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import {
  DevicePushApp,
  ReservationStatus,
  ReservationType,
  SpaceLayoutStatus,
  UserRole,
} from "../../generated/prisma/enums";
import { DeviceTokensService } from "../device-tokens/device-tokens.service";
import { EmailService } from "../email/email.service";
import { PaymentsService } from "../payments/payments.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import { DeclineReservationDto } from "./dto/decline-reservation.dto";
import { ReservationAvailabilityQueryDto } from "./dto/reservation-availability-query.dto";
import { UpdateReservationStatusDto } from "./dto/update-reservation-status.dto";
import { UpdateVenueLiveStatusDto } from "./dto/update-venue-live-status.dto";
import { UpdateVenueReservationSettingsDto } from "./dto/update-venue-reservation-settings.dto";

type ReservableTable = {
  tableId: string;
  tableLabel: string;
  roomLabel: string;
  chinChinTier: "STANDARD" | "LARGE";
  minPartySize: number;
  maxPartySize: number;
  reservable: boolean;
};

type ReservationSlot = {
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  arrivalDeadlineAt: Date;
};

type VenueReservationState = {
  id: string;
  isLive: boolean;
  latitude: number | null;
  longitude: number | null;
  liveChinChinTableIds: string[];
  reservationWindowStartMinutes: number;
  reservationWindowEndMinutes: number;
};

const ADVANCE_BASE_PRICE_CENTS = 400;
const LIVE_BASE_PRICE_CENTS = 500;
const LARGE_TABLE_SURCHARGE_CENTS = 100;
const LARGE_TABLE_MIN_CAPACITY = 6;
const LIVE_RADIUS_METERS = 1000;
const ARRIVAL_GRACE_MINUTES = 15;
const VENUE_CONFIRMATION_WINDOW_SECONDS = 60;
const LIVE_CUSTOMER_CHECK_IN_WINDOW_MINUTES = 10;
const RESERVATION_WINDOW_MIN_START_MINUTES = 12 * 60;
const RESERVATION_WINDOW_MAX_END_MINUTES = 23 * 60;
const DEFAULT_RESERVATION_WINDOW_START_MINUTES = 18 * 60;
const DEFAULT_RESERVATION_WINDOW_END_MINUTES = 22 * 60;
const LAST_RESERVATION_REQUEST_BUFFER_MINUTES = 15;
const LIVE_PROMOTIONAL_PRICE_START_MINUTES = 18 * 60;

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly deviceTokensService: DeviceTokensService,
    private readonly emailService: EmailService,
  ) {}

  async getVenueAvailability(
    venueId: string,
    query: ReservationAvailabilityQueryDto,
  ) {
    const venue = await this.getVenueReservationState(venueId);
    const slot = this.parseSlot(query.startAt, query.endAt, venue);
    const liveDistanceMeters = this.validateReservationRuleContext(
      venue,
      query.type,
      query.userLatitude,
      query.userLongitude,
    );
    await this.releaseExpiredReservationLocks(venueId);
    const tables = this.filterTablesForReservationType(
      await this.getApprovedChinChinTables(venueId),
      venue,
      query.type,
      slot.startAt,
    );
    const blockingReservations = await this.findBlockingReservations(
      venueId,
      slot.startAt,
      slot.endAt,
    );
    const blockedTableKeys = new Set(
      blockingReservations.flatMap((reservation) =>
        this.tableIdentityKeys(reservation.tableId, reservation.tableLabel),
      ),
    );

    return {
      venueId,
      type: query.type,
      startAt: slot.startAt.toISOString(),
      endAt: slot.endAt.toISOString(),
      checkInOpensAt: slot.checkInOpensAt.toISOString(),
      checkInClosesAt: slot.checkInClosesAt.toISOString(),
      arrivalDeadlineAt: slot.arrivalDeadlineAt.toISOString(),
      partySize: query.partySize,
      liveRadiusMeters: query.type === "LIVE" ? LIVE_RADIUS_METERS : null,
      distanceMeters: liveDistanceMeters,
      tables: tables.map((table) => {
        const reserved = this.isTableReservedByKeys(table, blockedTableKeys);
        return {
          ...table,
          priceCents: this.calculateFeeCents(query.type, table, slot.startAt),
          currency: "EUR",
          available:
            table.reservable &&
            query.partySize >= table.minPartySize &&
            query.partySize <= table.maxPartySize &&
            !reserved,
          unavailableReason: this.unavailableReason(
            table,
            query.partySize,
            reserved,
          ),
        };
      }),
    };
  }

  async createReservation(
    venueId: string,
    dto: CreateReservationDto,
    options?: { customerId?: string },
  ) {
    const venue = await this.getVenueReservationState(venueId);
    const slot = this.parseSlot(dto.startAt, dto.endAt, venue);
    const liveDistanceMeters = this.validateReservationRuleContext(
      venue,
      dto.type,
      dto.userLatitude,
      dto.userLongitude,
    );
    await this.releaseExpiredReservationLocks(venueId);
    const tables = this.filterTablesForReservationType(
      await this.getApprovedChinChinTables(venueId),
      venue,
      dto.type,
      slot.startAt,
    );
    const table = tables.find((item) => item.tableId === dto.tableId);

    if (!table) {
      throw new BadRequestException(
        "Selected table is not an approved Chin-Chin table.",
      );
    }

    if (!table.reservable) {
      throw new BadRequestException("Selected table is not reservable.");
    }

    if (
      dto.partySize < table.minPartySize ||
      dto.partySize > table.maxPartySize
    ) {
      throw new BadRequestException(
        "Party size does not match table capacity.",
      );
    }

    const blockingReservations = await this.findBlockingReservations(
      venueId,
      slot.startAt,
      slot.endAt,
      { tableId: dto.tableId, tableLabel: table.tableLabel },
    );

    if (blockingReservations.length) {
      throw new ConflictException(
        "Selected table is already reserved for this time slot.",
      );
    }

    await this.assertSingleActiveCustomerReservationPerDay(dto, slot.startAt);

    const reservation = await this.prisma.reservation.create({
      data: {
        venueId,
        customerId: options?.customerId,
        tableId: table.tableId,
        tableLabel: table.tableLabel,
        roomLabel: table.roomLabel,
        type: dto.type as ReservationType,
        status: ReservationStatus.REQUESTED,
        partySize: dto.partySize,
        timeSlotStart: slot.startAt,
        timeSlotEnd: slot.endAt,
        checkInOpensAt: slot.checkInOpensAt,
        checkInClosesAt: slot.checkInClosesAt,
        arrivalDeadlineAt: slot.arrivalDeadlineAt,
        confirmationExpiresAt: null,
        feeCents: this.calculateFeeCents(dto.type, table, slot.startAt),
        refundCents: 0,
        currency: "EUR",
        userLatitude: dto.userLatitude,
        userLongitude: dto.userLongitude,
        distanceMeters: liveDistanceMeters,
        customerName: dto.customerName?.trim(),
        customerEmail: dto.customerEmail?.trim().toLowerCase(),
        customerPhone: dto.customerPhone?.trim(),
        notes: dto.notes?.trim(),
      },
      include: { venue: true },
    });

    return this.serializeReservation(reservation);
  }

  async createCustomerReservation(
    customerId: string,
    venueId: string,
    dto: CreateReservationDto,
  ) {
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
      },
    });

    if (!customer) {
      throw new BadRequestException("Customer account was not found.");
    }
    if (customer.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(
        "Only customer accounts can reserve tables.",
      );
    }

    return this.createReservation(
      venueId,
      {
        ...dto,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        customerEmail: customer.email,
        customerPhone: customer.phoneNumber ?? dto.customerPhone,
      },
      { customerId },
    );
  }

  async listVenueReservations(venueId: string) {
    await this.releaseExpiredReservationLocks(venueId);
    const reservations = await this.prisma.reservation.findMany({
      where: { venueId },
      orderBy: { timeSlotStart: "desc" },
      take: 100,
      include: { venue: true },
    });

    return Promise.all(
      reservations.map((reservation) =>
        this.serializeVenueReservationRequest(reservation),
      ),
    );
  }

  async listPendingVenueReservationRequests(venueId: string) {
    await this.releaseExpiredReservationLocks(venueId);
    const reservations = await this.prisma.reservation.findMany({
      where: {
        venueId,
        status: ReservationStatus.PENDING_VENUE_CONFIRMATION,
      },
      orderBy: { createdAt: "asc" },
      include: { venue: true },
    });

    return reservations.map((reservation) =>
      this.serializeReservation(reservation),
    );
  }

  async listCustomerReservations(customerEmail?: string) {
    const normalizedEmail = customerEmail?.trim().toLowerCase();
    const reservations = await this.prisma.reservation.findMany({
      where: {
        source: "user-app",
        ...(normalizedEmail ? { customerEmail: normalizedEmail } : {}),
      },
      orderBy: { timeSlotStart: "desc" },
      take: 100,
      include: { venue: true },
    });

    const venueIds = Array.from(
      new Set(reservations.map((reservation) => reservation.venueId)),
    );
    await Promise.all(
      venueIds.map((venueId) => this.releaseExpiredReservationLocks(venueId)),
    );

    const refreshedReservations = await this.prisma.reservation.findMany({
      where: {
        source: "user-app",
        ...(normalizedEmail ? { customerEmail: normalizedEmail } : {}),
      },
      orderBy: { timeSlotStart: "desc" },
      take: 100,
      include: { venue: true },
    });

    return {
      items: refreshedReservations.map((reservation) =>
        this.serializeReservation(reservation),
      ),
    };
  }

  async listCustomerReservationsForUser(customerId: string) {
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { id: true, email: true, role: true },
    });

    if (!customer) {
      throw new BadRequestException("Customer account was not found.");
    }
    if (customer.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(
        "Only customer accounts can list customer reservations.",
      );
    }

    return this.listCustomerReservations(customer.email);
  }

  async listReservationMonitoring(filters?: {
    status?: string;
    venueId?: string;
  }) {
    const status = filters?.status?.trim();
    const venueId = filters?.venueId?.trim();

    const reservations = await this.prisma.reservation.findMany({
      where: {
        ...(status &&
        Object.values(ReservationStatus).includes(status as ReservationStatus)
          ? { status: status as ReservationStatus }
          : {}),
        ...(venueId ? { venueId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 250,
      include: { venue: true },
    });

    const venueIds = Array.from(
      new Set(reservations.map((reservation) => reservation.venueId)),
    );
    await Promise.all(
      venueIds.map((id) => this.releaseExpiredReservationLocks(id)),
    );

    const refreshedReservations = await this.prisma.reservation.findMany({
      where: {
        ...(status &&
        Object.values(ReservationStatus).includes(status as ReservationStatus)
          ? { status: status as ReservationStatus }
          : {}),
        ...(venueId ? { venueId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 250,
      include: { venue: true },
    });

    return {
      items: refreshedReservations.map((reservation) =>
        this.serializeReservation(reservation),
      ),
      total: refreshedReservations.length,
      generatedAt: new Date(),
    };
  }

  async adminCancelReservation(id: string, dto?: DeclineReservationDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    const now = new Date();
    const notes =
      dto?.notes?.trim() ??
      reservation.notes ??
      "Reservation was cancelled by Chin-Chin admin override.";

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: now,
        releasedAt: now,
        confirmationExpiresAt: null,
        notes,
      },
      include: { venue: true },
    });

    await this.notifyCustomer(updated, {
      title: "Rezervacija otkazana",
      body: `${updated.venue.name} je otkazao rezervaciju za ${updated.tableLabel ?? "Chin-Chin stol"}.`,
      type: "reservation_cancelled_by_admin",
    });

    return this.serializeReservation(updated);
  }

  async adminDeleteReservation(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    await this.prisma.$transaction([
      this.prisma.venueReservationPenalty.deleteMany({
        where: { reservationId: id },
      }),
      this.prisma.reservation.delete({
        where: { id },
      }),
    ]);

    return {
      deletedId: id,
      venueId: reservation.venueId,
      tableId: reservation.tableId,
    };
  }

  async adminCustomerCheckInReservation(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    await this.releaseExpiredReservationLocks(reservation.venueId);

    const refreshed = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!refreshed) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (this.isTerminalReservationStatus(refreshed.status)) {
      throw new BadRequestException(
        "Terminal reservations cannot be customer checked in by admin.",
      );
    }

    const checkedIn = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CHECK_IN_PENDING,
        customerCheckedInAt: refreshed.customerCheckedInAt ?? new Date(),
      },
      include: { venue: true },
    });

    await this.notifyCustomer(checkedIn, {
      title: "Dolazak potvrden",
      body: `${checkedIn.venue.name} je potvrdio da si u lokalu.`,
      type: "venue_check_in_confirmed",
    });

    return this.serializeReservation(checkedIn);
  }

  async adminVenueCheckInReservation(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    await this.releaseExpiredReservationLocks(reservation.venueId);

    const refreshed = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!refreshed) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (this.isTerminalReservationStatus(refreshed.status)) {
      throw new BadRequestException(
        "Terminal reservations cannot be venue checked in by admin.",
      );
    }

    const checkedIn = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CHECKED_IN,
        checkedInAt: refreshed.checkedInAt ?? new Date(),
        confirmationExpiresAt: null,
      },
      include: { venue: true },
    });

    await this.notifyVenueOwner(checkedIn, {
      title: "Gost je potvrdio dolazak",
      body: `${checkedIn.customerName ?? "Chin-Chin korisnik"} je potvrdio dolazak za ${checkedIn.tableLabel ?? "Chin-Chin stol"}.`,
      type: "customer_check_in_confirmed",
    });

    return this.serializeReservation(checkedIn);
  }

  async getReservation(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    await this.releaseExpiredReservationLocks(reservation.venueId);

    const refreshed = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!refreshed) {
      throw new NotFoundException("Reservation was not found.");
    }

    return this.serializeReservation(refreshed);
  }

  async acceptReservation(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    await this.releaseExpiredReservationLocks(reservation.venueId);

    if (reservation.status !== ReservationStatus.PENDING_VENUE_CONFIRMATION) {
      throw new BadRequestException(
        "Only pending reservation requests can be accepted.",
      );
    }

    if (
      reservation.confirmationExpiresAt &&
      reservation.confirmationExpiresAt.getTime() < Date.now() &&
      reservation.type === ReservationType.LIVE
    ) {
      const expired = await this.prisma.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.EXPIRED,
          releasedAt: new Date(),
        },
        include: { venue: true },
      });
      await this.paymentsService.voidForInactiveReservation(
        reservation.id,
        "Venue confirmation window expired.",
      );
      return this.serializeReservation(expired);
    }

    const blockers = await this.findBlockingReservations(
      reservation.venueId,
      reservation.timeSlotStart,
      reservation.timeSlotEnd,
      {
        tableId: reservation.tableId,
        tableLabel: reservation.tableLabel,
      },
      reservation.id,
    );

    if (blockers.length) {
      throw new ConflictException(
        "Selected table is already reserved for this time slot.",
      );
    }

    const now = new Date();
    const liveCustomerCheckInClosesAt = new Date(
      now.getTime() + LIVE_CUSTOMER_CHECK_IN_WINDOW_MINUTES * 60 * 1000,
    );
    const isLiveReservation = reservation.type === ReservationType.LIVE;
    await this.paymentsService.captureForAcceptedReservation(reservation.id);

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CONFIRMED,
        confirmedAt: now,
        confirmationExpiresAt: null,
        ...(isLiveReservation
          ? {
              checkInOpensAt: now,
              checkInClosesAt: liveCustomerCheckInClosesAt,
            }
          : {}),
      },
      include: { venue: true },
    });

    return this.serializeReservation(updated);
  }

  async checkInReservation(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    await this.releaseExpiredReservationLocks(reservation.venueId);

    const refreshed = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!refreshed) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (
      refreshed.status !== ReservationStatus.CONFIRMED &&
      refreshed.status !== ReservationStatus.RESERVED &&
      refreshed.status !== ReservationStatus.CHECK_IN_PENDING
    ) {
      throw new BadRequestException(
        "Only accepted active reservations can be checked in.",
      );
    }

    if (refreshed.timeSlotStart.getTime() > Date.now()) {
      throw new BadRequestException(
        "Reservation check-in is available from the reservation start time.",
      );
    }

    const checkedIn = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CHECKED_IN,
        checkedInAt: new Date(),
        confirmationExpiresAt: null,
      },
      include: { venue: true },
    });

    return this.serializeReservation(checkedIn);
  }

  async customerCheckInReservation(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    await this.releaseExpiredReservationLocks(reservation.venueId);

    const refreshed = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!refreshed) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (
      refreshed.status !== ReservationStatus.CONFIRMED &&
      refreshed.status !== ReservationStatus.RESERVED &&
      refreshed.status !== ReservationStatus.CHECK_IN_PENDING
    ) {
      throw new BadRequestException(
        "Only accepted active reservations can be confirmed by customer.",
      );
    }

    if (refreshed.customerCheckedInAt) {
      return this.serializeReservation(refreshed);
    }

    const now = new Date();
    const opensAt = this.effectiveCustomerCheckInOpensAt(refreshed);
    const closesAt = this.effectiveCustomerCheckInClosesAt(refreshed);

    if (now.getTime() < opensAt.getTime()) {
      throw new BadRequestException(
        refreshed.type === ReservationType.LIVE
          ? "Live customer check-in is not open yet."
          : "Customer check-in opens three hours before the reservation.",
      );
    }

    if (now.getTime() > closesAt.getTime()) {
      throw new BadRequestException("Customer check-in window has expired.");
    }

    const checkedIn = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CHECK_IN_PENDING,
        customerCheckedInAt: now,
      },
      include: { venue: true },
    });

    return this.serializeReservation(checkedIn);
  }

  async declineReservation(id: string, dto?: DeclineReservationDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (reservation.status !== ReservationStatus.PENDING_VENUE_CONFIRMATION) {
      throw new BadRequestException(
        "Only pending reservation requests can be declined.",
      );
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.DECLINED,
        declinedAt: new Date(),
        releasedAt: new Date(),
        confirmationExpiresAt: null,
        notes: dto?.notes?.trim() ?? reservation.notes,
      },
      include: { venue: true },
    });

    await this.paymentsService.voidForInactiveReservation(
      reservation.id,
      "Reservation request was declined by venue.",
    );

    await this.notifyCustomer(updated, {
      title: "Rezervacija odbijena",
      body: `${updated.venue.name} nije prihvatio zahtjev za rezervaciju.`,
      type: "reservation_declined",
    });

    return this.serializeReservation(updated);
  }

  async cancelReservationByCustomer(id: string, dto?: DeclineReservationDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (this.isTerminalReservationStatus(reservation.status)) {
      throw new BadRequestException("Reservation is not active.");
    }

    if (
      reservation.status === ReservationStatus.CHECKED_IN ||
      reservation.status === ReservationStatus.SEATED ||
      this.isNightLocked(reservation)
    ) {
      throw new BadRequestException(
        "Reservation is already confirmed in the venue and cannot be cancelled by customer.",
      );
    }

    const now = new Date();
    const refundCents = this.customerCancellationRefundCents(reservation, now);
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CANCELLED_BY_USER,
        cancelledAt: now,
        releasedAt: now,
        confirmationExpiresAt: null,
        refundCents,
        notes: dto?.notes?.trim() ?? reservation.notes,
      },
      include: { venue: true },
    });

    await this.paymentsService.refundCapturedReservation(
      reservation.id,
      refundCents,
      "Reservation was cancelled by customer.",
    );
    await this.paymentsService.voidForInactiveReservation(
      reservation.id,
      "Reservation was cancelled by customer before capture.",
    );

    await this.notifyVenueOwner(updated, {
      title: "Gost je otkazao rezervaciju",
      body: `${updated.customerName ?? "Chin-Chin korisnik"} je otkazao rezervaciju za ${updated.tableLabel ?? "Chin-Chin stol"}.`,
      type: "reservation_cancelled_by_customer",
    });

    return this.serializeReservation(updated);
  }

  async cancelReservationByVenue(id: string, dto?: DeclineReservationDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    if (
      reservation.status === ReservationStatus.CANCELLED ||
      reservation.status === ReservationStatus.CANCELLED_BY_USER ||
      reservation.status === ReservationStatus.COMPLETED ||
      reservation.status === ReservationStatus.DECLINED ||
      reservation.status === ReservationStatus.EXPIRED ||
      reservation.status === ReservationStatus.NO_SHOW ||
      reservation.status === ReservationStatus.RELEASED
    ) {
      throw new BadRequestException("Reservation is not active.");
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.CANCELLED,
          cancelledAt: now,
          releasedAt: now,
          refundCents: reservation.feeCents,
          confirmationExpiresAt: null,
          notes: dto?.notes?.trim() ?? reservation.notes,
        },
        include: { venue: true },
      });

      await tx.venueReservationPenalty.create({
        data: {
          venueId: reservation.venueId,
          reservationId: reservation.id,
          monthKey: this.monthKey(now),
          reason: "VENUE_CANCELLED_RESERVATION",
          notes:
            dto?.notes?.trim() ??
            "Reservation was cancelled by venue from dashboard.",
        },
      });

      return cancelled;
    });

    await this.paymentsService.refundCapturedReservation(
      reservation.id,
      reservation.feeCents,
      "Reservation was cancelled by venue.",
    );
    await this.paymentsService.voidForInactiveReservation(
      reservation.id,
      "Reservation was cancelled by venue before capture.",
    );

    await this.notifyCustomer(updated, {
      title: "Rezervacija otkazana",
      body: `${updated.venue.name} je otkazao rezervaciju za ${updated.tableLabel ?? "Chin-Chin stol"}.`,
      type: "reservation_cancelled_by_venue",
    });
    await this.notifyCustomerReservationRefundByEmail(
      updated,
      reservation,
      now,
    );

    return {
      reservation: this.serializeReservation(updated),
      penalty: {
        monthKey: this.monthKey(now),
        reason: "VENUE_CANCELLED_RESERVATION",
        monthlyAllowedWithoutCharge: 5,
      },
    };
  }

  async updateReservationStatus(id: string, dto: UpdateReservationStatusDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: dto.status as ReservationStatus,
        notes: dto.notes?.trim() ?? reservation.notes,
        ...this.statusTimestampsAndRefunds(
          reservation,
          dto.status as ReservationStatus,
        ),
      },
      include: { venue: true },
    });

    return this.serializeReservation(updated);
  }

  async getVenueLiveStatus(venueId: string) {
    const venue = await this.getVenueReservationState(venueId);
    return {
      id: venue.id,
      isLive: venue.isLive,
      latitude: venue.latitude,
      longitude: venue.longitude,
      liveChinChinTableIds: venue.liveChinChinTableIds,
      reservationWindowStartMinutes: venue.reservationWindowStartMinutes,
      reservationWindowEndMinutes: venue.reservationWindowEndMinutes,
    };
  }

  async getVenueReservationSettings(venueId: string) {
    const venue = await this.getVenueReservationState(venueId);
    return {
      venueId: venue.id,
      reservationWindowStartMinutes: venue.reservationWindowStartMinutes,
      reservationWindowEndMinutes: venue.reservationWindowEndMinutes,
      minReservationWindowStartMinutes: RESERVATION_WINDOW_MIN_START_MINUTES,
      maxReservationWindowEndMinutes: RESERVATION_WINDOW_MAX_END_MINUTES,
    };
  }

  async updateVenueReservationSettings(
    venueId: string,
    dto: UpdateVenueReservationSettingsDto,
  ) {
    this.assertReservationWindow(
      dto.reservationWindowStartMinutes,
      dto.reservationWindowEndMinutes,
    );

    const venue = await this.prisma.venue.update({
      where: { id: venueId },
      data: {
        reservationWindowStartMinutes: dto.reservationWindowStartMinutes,
        reservationWindowEndMinutes: dto.reservationWindowEndMinutes,
      },
      select: {
        id: true,
        reservationWindowStartMinutes: true,
        reservationWindowEndMinutes: true,
      },
    });

    return {
      venueId: venue.id,
      reservationWindowStartMinutes: venue.reservationWindowStartMinutes,
      reservationWindowEndMinutes: venue.reservationWindowEndMinutes,
      minReservationWindowStartMinutes: RESERVATION_WINDOW_MIN_START_MINUTES,
      maxReservationWindowEndMinutes: RESERVATION_WINDOW_MAX_END_MINUTES,
    };
  }

  async updateVenueLiveStatus(venueId: string, dto: UpdateVenueLiveStatusDto) {
    const existingVenue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true },
    });

    if (!existingVenue) {
      throw new NotFoundException("Venue was not found.");
    }

    const liveChinChinTableIds =
      dto.isLive || dto.liveChinChinTableIds !== undefined
        ? this.uniqueNonEmptyStrings(dto.liveChinChinTableIds ?? [])
        : undefined;

    const venue = await this.prisma.venue.update({
      where: { id: venueId },
      data: {
        isLive: dto.isLive,
        latitude: dto.latitude,
        longitude: dto.longitude,
        liveChinChinTableIds:
          liveChinChinTableIds === undefined ? undefined : liveChinChinTableIds,
        liveStartedAt: dto.isLive ? new Date() : undefined,
        liveEndedAt: dto.isLive ? null : new Date(),
      },
    });

    return {
      id: venue.id,
      isLive: venue.isLive,
      latitude: venue.latitude,
      longitude: venue.longitude,
      liveChinChinTableIds: this.jsonStringArray(venue.liveChinChinTableIds),
      liveStartedAt: venue.liveStartedAt,
      liveEndedAt: venue.liveEndedAt,
    };
  }

  private parseSlot(
    startAtValue: string,
    endAtValue: string,
    venue: VenueReservationState,
  ): ReservationSlot {
    const startAt = new Date(startAtValue);
    const endAt = new Date(endAtValue);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException("Invalid reservation time slot.");
    }

    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException(
        "Reservation end time must be after start time.",
      );
    }

    const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
    const latestReservationStartMinutes =
      venue.reservationWindowEndMinutes -
      LAST_RESERVATION_REQUEST_BUFFER_MINUTES;
    if (
      startMinutes < venue.reservationWindowStartMinutes ||
      startMinutes > latestReservationStartMinutes
    ) {
      throw new BadRequestException(
        `Reservations are available from ${this.formatMinutes(
          venue.reservationWindowStartMinutes,
        )} to ${this.formatMinutes(latestReservationStartMinutes)}.`,
      );
    }

    const checkInOpensAt = this.customerCheckInOpensAt(startAt);
    const checkInClosesAt = this.customerCheckInClosesAt(startAt);
    const arrivalDeadlineAt = new Date(
      startAt.getTime() + ARRIVAL_GRACE_MINUTES * 60 * 1000,
    );

    return {
      startAt,
      endAt,
      checkInOpensAt,
      checkInClosesAt,
      arrivalDeadlineAt,
    };
  }

  private async getVenueReservationState(
    venueId: string,
  ): Promise<VenueReservationState> {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        isLive: true,
        latitude: true,
        longitude: true,
        liveChinChinTableIds: true,
        reservationWindowStartMinutes: true,
        reservationWindowEndMinutes: true,
      },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    return {
      ...venue,
      liveChinChinTableIds: this.jsonStringArray(venue.liveChinChinTableIds),
      reservationWindowStartMinutes:
        venue.reservationWindowStartMinutes ??
        DEFAULT_RESERVATION_WINDOW_START_MINUTES,
      reservationWindowEndMinutes:
        venue.reservationWindowEndMinutes ??
        DEFAULT_RESERVATION_WINDOW_END_MINUTES,
    };
  }

  private filterTablesForReservationType(
    tables: ReservableTable[],
    venue: VenueReservationState,
    type: "ADVANCE" | "LIVE",
    startAt: Date,
  ) {
    const activeTableIds = new Set(venue.liveChinChinTableIds);
    if (type !== "LIVE") {
      if (
        !activeTableIds.size ||
        !this.isSameLocalCalendarDay(new Date(), startAt)
      ) {
        return tables;
      }

      return tables.filter((table) => activeTableIds.has(table.tableId));
    }

    if (!activeTableIds.size) {
      return [];
    }

    return tables.filter((table) => activeTableIds.has(table.tableId));
  }

  private validateReservationRuleContext(
    venue: VenueReservationState,
    type: "ADVANCE" | "LIVE",
    userLatitude?: number,
    userLongitude?: number,
  ) {
    if (type === "ADVANCE") {
      return null;
    }

    if (!venue.isLive) {
      throw new BadRequestException(
        "Live reservations are available only while the venue is live.",
      );
    }

    if (!venue.liveChinChinTableIds.length) {
      throw new BadRequestException(
        "Live reservations require active live Chin-Chin tables.",
      );
    }

    if (venue.latitude == null || venue.longitude == null) {
      throw new BadRequestException(
        "Venue location is required for live reservations.",
      );
    }

    if (userLatitude == null || userLongitude == null) {
      throw new BadRequestException(
        "User location is required for live reservations.",
      );
    }

    const distanceMeters = this.distanceMeters(
      venue.latitude,
      venue.longitude,
      userLatitude,
      userLongitude,
    );

    if (distanceMeters > LIVE_RADIUS_METERS) {
      throw new BadRequestException(
        "User is outside the live reservation radius.",
      );
    }

    return Math.round(distanceMeters);
  }

  private calculateFeeCents(
    type: "ADVANCE" | "LIVE",
    table: ReservableTable,
    startAt: Date,
  ) {
    const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
    const usesLivePromotionalPrice =
      type === "LIVE" && startMinutes >= LIVE_PROMOTIONAL_PRICE_START_MINUTES;
    const basePrice = usesLivePromotionalPrice
      ? LIVE_BASE_PRICE_CENTS
      : ADVANCE_BASE_PRICE_CENTS;
    const surcharge =
      table.chinChinTier === "LARGE" ||
      table.maxPartySize >= LARGE_TABLE_MIN_CAPACITY
        ? LARGE_TABLE_SURCHARGE_CENTS
        : 0;

    return basePrice + surcharge;
  }

  private async getApprovedChinChinTables(venueId: string) {
    const project = await this.prisma.spaceLayoutProject.findFirst({
      where: { venueId, status: SpaceLayoutStatus.APPROVED },
      orderBy: { approvedAt: "desc" },
    });

    const savedLayout = this.asJsonObject(project?.savedLayout ?? null);
    const layout = this.asJsonObject(savedLayout?.layout ?? null);
    const rooms = Array.isArray(layout?.rooms) ? layout.rooms : [];

    if (!project || !layout || !rooms.length) {
      throw new NotFoundException("Approved venue layout was not found.");
    }

    const tables: ReservableTable[] = [];
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
      const room = rooms[roomIndex];
      if (typeof room !== "object" || !room || Array.isArray(room)) {
        continue;
      }

      const roomMap = room as Record<string, unknown>;
      const roomLabel =
        roomMap.roomLabel?.toString().trim() || `Prostorija ${roomIndex + 1}`;
      const roomTables = Array.isArray(roomMap.tables) ? roomMap.tables : [];
      for (const table of roomTables) {
        if (typeof table !== "object" || !table || Array.isArray(table)) {
          continue;
        }

        const tableMap = table as Record<string, unknown>;
        const tableId = tableMap.id?.toString();
        if (!tableId) {
          continue;
        }

        const tablePhotoId = tableMap.tablePhotoId?.toString().trim() ?? "";
        const isChinChinTable =
          tableMap.tableRole === "CHIN_CHIN_TABLE" &&
          tablePhotoId.length > 0 &&
          !tablePhotoId.includes("change-request-photo");
        if (!isChinChinTable) {
          continue;
        }

        tables.push({
          tableId,
          tableLabel: tableMap.label?.toString() || tableId,
          roomLabel,
          chinChinTier: this.chinChinTierFrom(tableMap),
          minPartySize: this.numberFrom(tableMap.minPartySize, 1),
          maxPartySize: this.maxPartySizeFrom(tableMap),
          reservable: tableMap.reservable !== false,
        });
      }
    }

    return tables;
  }

  private findBlockingReservations(
    venueId: string,
    startAt: Date,
    endAt: Date,
    tableIdentity?: { tableId?: string | null; tableLabel?: string | null },
    excludeReservationId?: string,
  ) {
    const now = new Date();
    const dayStart = this.startOfLocalCalendarDay(startAt);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const tableKeys = tableIdentity
      ? new Set(
          this.tableIdentityKeys(
            tableIdentity.tableId,
            tableIdentity.tableLabel,
          ),
        )
      : null;

    return this.prisma.reservation
      .findMany({
        where: {
          ...(excludeReservationId
            ? { id: { not: excludeReservationId } }
            : {}),
          venueId,
          AND: [
            {
              OR: [
                {
                  status: ReservationStatus.PENDING_VENUE_CONFIRMATION,
                  OR: [
                    { confirmationExpiresAt: null },
                    { confirmationExpiresAt: { gt: now } },
                  ],
                },
                {
                  status: {
                    in: [
                      ReservationStatus.CONFIRMED,
                      ReservationStatus.RESERVED,
                      ReservationStatus.CHECK_IN_PENDING,
                      ReservationStatus.CHECKED_IN,
                      ReservationStatus.SEATED,
                    ],
                  },
                },
              ],
            },
            {
              OR: [
                {
                  timeSlotStart: {
                    gte: dayStart,
                    lt: dayEnd,
                  },
                },
                {
                  status: {
                    in: [
                      ReservationStatus.CHECKED_IN,
                      ReservationStatus.SEATED,
                    ],
                  },
                },
              ],
            },
          ],
        },
      })
      .then((reservations) =>
        reservations
          .filter((reservation) => {
            const blockEnd = this.effectiveReservationBlockEnd(reservation);
            return (
              this.isSameLocalCalendarDay(reservation.timeSlotStart, startAt) ||
              blockEnd.getTime() > startAt.getTime()
            );
          })
          .filter((reservation) => {
            if (!tableKeys) {
              return true;
            }
            return this.hasSharedTableIdentity(
              tableKeys,
              this.tableIdentityKeys(
                reservation.tableId,
                reservation.tableLabel,
              ),
            );
          }),
      );
  }

  private async assertSingleActiveCustomerReservationPerDay(
    dto: CreateReservationDto,
    startAt: Date,
  ) {
    const normalizedEmail = dto.customerEmail?.trim().toLowerCase();
    const normalizedPhone = dto.customerPhone?.trim();

    if (!normalizedEmail && !normalizedPhone) {
      return;
    }

    const dayStart = this.startOfLocalCalendarDay(startAt);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const existing = await this.prisma.reservation.findFirst({
      where: {
        OR: [
          ...(normalizedEmail ? [{ customerEmail: normalizedEmail }] : []),
          ...(normalizedPhone ? [{ customerPhone: normalizedPhone }] : []),
        ],
        timeSlotStart: {
          gte: dayStart,
          lt: dayEnd,
        },
        status: {
          in: [
            ReservationStatus.PENDING_VENUE_CONFIRMATION,
            ReservationStatus.CONFIRMED,
            ReservationStatus.RESERVED,
            ReservationStatus.CHECK_IN_PENDING,
            ReservationStatus.CHECKED_IN,
            ReservationStatus.SEATED,
          ],
        },
      },
      select: {
        id: true,
        venueId: true,
        timeSlotStart: true,
        venue: {
          select: {
            name: true,
          },
        },
      },
    });

    if (existing) {
      throw new ConflictException({
        code: "CUSTOMER_ACTIVE_RESERVATION_FOR_DAY",
        message: "Customer already has an active reservation for this day.",
        reservationId: existing.id,
        venueId: existing.venueId,
        venueName: existing.venue.name,
        reservationDate: existing.timeSlotStart,
      });
    }
  }

  private effectiveReservationBlockEnd(reservation: {
    status: ReservationStatus;
    timeSlotStart: Date;
    timeSlotEnd: Date;
  }) {
    if (
      reservation.status === ReservationStatus.CHECKED_IN ||
      reservation.status === ReservationStatus.SEATED
    ) {
      return this.nightLockUntil(reservation.timeSlotStart);
    }

    return reservation.timeSlotEnd;
  }

  private nightLockUntil(startAt: Date) {
    const lockEnd = new Date(startAt);
    lockEnd.setDate(lockEnd.getDate() + 1);
    lockEnd.setHours(6, 0, 0, 0);
    return lockEnd;
  }

  private customerCheckInOpensAt(startAt: Date) {
    return new Date(startAt.getTime() - 3 * 60 * 60 * 1000);
  }

  private customerCheckInClosesAt(startAt: Date) {
    return new Date(startAt.getTime() - 2 * 60 * 60 * 1000);
  }

  private effectiveCustomerCheckInOpensAt(reservation: {
    timeSlotStart: Date;
    checkInOpensAt: Date | null;
  }) {
    return (
      reservation.checkInOpensAt ??
      this.customerCheckInOpensAt(reservation.timeSlotStart)
    );
  }

  private effectiveCustomerCheckInClosesAt(reservation: {
    timeSlotStart: Date;
    checkInClosesAt: Date | null;
  }) {
    return (
      reservation.checkInClosesAt ??
      this.customerCheckInClosesAt(reservation.timeSlotStart)
    );
  }

  private chinChinTierFrom(tableMap: Record<string, unknown>) {
    const tier = tableMap.chinChinTier?.toString().trim().toUpperCase();
    if (tier === "LARGE") {
      return "LARGE" as const;
    }

    if (this.numberFrom(tableMap.maxPartySize, 4) >= LARGE_TABLE_MIN_CAPACITY) {
      return "LARGE" as const;
    }

    return "STANDARD" as const;
  }

  private maxPartySizeFrom(tableMap: Record<string, unknown>) {
    const fallback =
      this.chinChinTierFrom(tableMap) === "LARGE"
        ? LARGE_TABLE_MIN_CAPACITY
        : 4;
    return Math.max(fallback, this.numberFrom(tableMap.maxPartySize, fallback));
  }

  private assertReservationWindow(startMinutes: number, endMinutes: number) {
    if (
      startMinutes < RESERVATION_WINDOW_MIN_START_MINUTES ||
      endMinutes > RESERVATION_WINDOW_MAX_END_MINUTES ||
      endMinutes < startMinutes
    ) {
      throw new BadRequestException(
        "Reservation window must be between 12:00 and 23:00.",
      );
    }
  }

  private formatMinutes(totalMinutes: number) {
    const hour = Math.floor(totalMinutes / 60)
      .toString()
      .padStart(2, "0");
    const minute = (totalMinutes % 60).toString().padStart(2, "0");
    return `${hour}:${minute}`;
  }

  private isNightLocked(reservation: {
    status: ReservationStatus;
    timeSlotStart: Date;
  }) {
    if (
      reservation.status !== ReservationStatus.CHECKED_IN &&
      reservation.status !== ReservationStatus.SEATED
    ) {
      return false;
    }

    return (
      this.nightLockUntil(reservation.timeSlotStart).getTime() > Date.now()
    );
  }

  private lockedUntilForReservation(reservation: {
    status: ReservationStatus;
    timeSlotStart: Date;
  }) {
    if (
      reservation.status !== ReservationStatus.CHECKED_IN &&
      reservation.status !== ReservationStatus.SEATED
    ) {
      return null;
    }

    return this.nightLockUntil(reservation.timeSlotStart);
  }

  private async releaseExpiredReservationLocks(venueId: string) {
    await this.releaseExpiredVenueConfirmationRequests(venueId);
    await this.releaseExpiredArrivalLocks(venueId);
    await this.releaseExpiredNightLocks(venueId);
  }

  private async releaseExpiredVenueConfirmationRequests(venueId: string) {
    const now = new Date();
    const expiredReservations = await this.prisma.reservation.findMany({
      where: {
        venueId,
        status: ReservationStatus.PENDING_VENUE_CONFIRMATION,
        type: ReservationType.LIVE,
        OR: [
          { confirmationExpiresAt: { lt: now } },
          {
            confirmationExpiresAt: null,
            timeSlotEnd: { lt: now },
          },
        ],
      },
      select: { id: true },
    });

    if (!expiredReservations.length) {
      return;
    }

    await this.prisma.reservation.updateMany({
      where: {
        id: { in: expiredReservations.map((reservation) => reservation.id) },
      },
      data: {
        status: ReservationStatus.EXPIRED,
        releasedAt: now,
      },
    });

    await Promise.all(
      expiredReservations.map((reservation) =>
        this.paymentsService.voidForInactiveReservation(
          reservation.id,
          "Venue confirmation window expired.",
        ),
      ),
    );
  }

  private async releaseExpiredArrivalLocks(venueId: string) {
    const now = new Date();
    const expiredReservations = await this.prisma.reservation.findMany({
      where: {
        venueId,
        OR: [
          { arrivalDeadlineAt: { lt: now } },
          {
            arrivalDeadlineAt: null,
            timeSlotEnd: { lt: now },
          },
        ],
        status: {
          in: [
            ReservationStatus.CONFIRMED,
            ReservationStatus.RESERVED,
            ReservationStatus.CHECK_IN_PENDING,
          ],
        },
      },
      select: {
        id: true,
        type: true,
        feeCents: true,
        customerCheckedInAt: true,
        checkedInAt: true,
        seatedAt: true,
      },
    });

    if (!expiredReservations.length) {
      return;
    }

    await this.prisma.$transaction(
      expiredReservations.map((reservation) =>
        this.prisma.reservation.update({
          where: { id: reservation.id },
          data: {
            status: ReservationStatus.NO_SHOW,
            releasedAt: now,
            refundCents: this.noShowRefundCents(reservation),
          },
        }),
      ),
    );

    await Promise.all(
      expiredReservations.map((reservation) =>
        this.paymentsService.refundCapturedReservation(
          reservation.id,
          this.noShowRefundCents(reservation),
          "Reservation was released as no-show.",
        ),
      ),
    );
  }

  private async releaseExpiredNightLocks(venueId: string) {
    const now = new Date();
    const nightLockedReservations = await this.prisma.reservation.findMany({
      where: {
        venueId,
        status: {
          in: [ReservationStatus.CHECKED_IN, ReservationStatus.SEATED],
        },
      },
      select: {
        id: true,
        timeSlotStart: true,
      },
    });

    const expiredIds = nightLockedReservations
      .filter(
        (reservation) =>
          this.nightLockUntil(reservation.timeSlotStart).getTime() <=
          now.getTime(),
      )
      .map((reservation) => reservation.id);

    if (!expiredIds.length) {
      return;
    }

    await this.prisma.reservation.updateMany({
      where: { id: { in: expiredIds } },
      data: {
        status: ReservationStatus.COMPLETED,
        releasedAt: now,
      },
    });
  }

  private unavailableReason(
    table: ReservableTable,
    partySize: number,
    reserved: boolean,
  ) {
    if (reserved) {
      return "RESERVED";
    }
    if (!table.reservable) {
      return "NOT_RESERVABLE";
    }
    if (partySize < table.minPartySize || partySize > table.maxPartySize) {
      return "CAPACITY_MISMATCH";
    }
    return null;
  }

  private isTableReservedByKeys(
    table: ReservableTable,
    reservedTableKeys: Set<string>,
  ) {
    return this.hasSharedTableIdentity(
      reservedTableKeys,
      this.tableIdentityKeys(table.tableId, table.tableLabel),
    );
  }

  private hasSharedTableIdentity(left: Set<string>, right: string[]) {
    return right.some((key) => left.has(key));
  }

  private tableIdentityKeys(
    tableId?: string | null,
    tableLabel?: string | null,
  ) {
    const keys = new Set<string>();
    for (const value of [tableId, tableLabel]) {
      const text = value?.trim();
      if (!text) {
        continue;
      }
      keys.add(this.normalizeTableIdentity(text));
      const numbers = text.match(/\d+/g);
      if (numbers?.length) {
        keys.add(`number:${numbers[numbers.length - 1]}`);
      }
    }
    return [...keys];
  }

  private normalizeTableIdentity(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
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

  private statusTimestampsAndRefunds(
    reservation: {
      type: ReservationType;
      status: ReservationStatus;
      feeCents: number;
      notes: string | null;
      customerCheckedInAt?: Date | null;
      checkedInAt?: Date | null;
      seatedAt?: Date | null;
    },
    nextStatus: ReservationStatus,
  ) {
    const now = new Date();
    const data: {
      checkedInAt?: Date;
      seatedAt?: Date;
      cancelledAt?: Date;
      releasedAt?: Date;
      confirmedAt?: Date;
      declinedAt?: Date;
      confirmationExpiresAt?: Date | null;
      refundCents?: number;
    } = {};

    if (nextStatus === ReservationStatus.CONFIRMED) {
      data.confirmedAt = now;
      data.confirmationExpiresAt = null;
    }

    if (nextStatus === ReservationStatus.DECLINED) {
      data.declinedAt = now;
      data.releasedAt = now;
      data.confirmationExpiresAt = null;
    }

    if (nextStatus === ReservationStatus.EXPIRED) {
      data.releasedAt = now;
      data.confirmationExpiresAt = null;
    }

    if (nextStatus === ReservationStatus.CHECKED_IN) {
      data.checkedInAt = now;
    }

    if (nextStatus === ReservationStatus.SEATED) {
      data.seatedAt = now;
      if (reservation.status !== ReservationStatus.CHECKED_IN) {
        data.checkedInAt = now;
      }
    }

    if (
      nextStatus === ReservationStatus.CANCELLED_BY_USER ||
      nextStatus === ReservationStatus.CANCELLED
    ) {
      data.cancelledAt = now;
      data.refundCents = this.refundForCancellation(reservation);
    }

    if (nextStatus === ReservationStatus.NO_SHOW) {
      data.releasedAt = now;
      data.refundCents = this.noShowRefundCents(reservation);
    }

    if (nextStatus === ReservationStatus.RELEASED) {
      data.releasedAt = now;
    }

    return data;
  }

  private refundForCancellation(reservation: {
    type: ReservationType;
    status: ReservationStatus;
    feeCents: number;
  }) {
    if (reservation.type === ReservationType.LIVE) {
      return 0;
    }

    if (
      reservation.status === ReservationStatus.CHECKED_IN ||
      reservation.status === ReservationStatus.SEATED
    ) {
      return 0;
    }

    return reservation.feeCents;
  }

  private noShowRefundCents(reservation: {
    type: ReservationType;
    feeCents: number;
    customerCheckedInAt?: Date | null;
    checkedInAt?: Date | null;
    seatedAt?: Date | null;
  }) {
    if (reservation.type === ReservationType.LIVE) {
      return 0;
    }

    const customerConfirmedArrival = Boolean(reservation.customerCheckedInAt);
    const venueConfirmedArrival = Boolean(
      reservation.checkedInAt || reservation.seatedAt,
    );
    if (customerConfirmedArrival && !venueConfirmedArrival) {
      return 0;
    }

    return Math.floor(reservation.feeCents * 0.5);
  }

  private customerCancellationRefundCents(
    reservation: {
      status: ReservationStatus;
      timeSlotStart: Date;
      feeCents: number;
      refundCents: number;
      customerCheckedInAt: Date | null;
    },
    now: Date,
  ) {
    return Math.max(
      0,
      reservation.feeCents -
        this.customerCancellationChargeCents(reservation, now),
    );
  }

  private customerCancellationChargeCents(
    reservation: {
      status: ReservationStatus;
      timeSlotStart: Date;
      feeCents: number;
      refundCents: number;
      customerCheckedInAt: Date | null;
    },
    now: Date,
  ) {
    if (reservation.status === ReservationStatus.CANCELLED_BY_USER) {
      return Math.max(0, reservation.feeCents - reservation.refundCents);
    }

    if (
      reservation.status === ReservationStatus.PENDING_VENUE_CONFIRMATION ||
      reservation.status === ReservationStatus.REQUESTED
    ) {
      return 0;
    }

    if (
      reservation.customerCheckedInAt ||
      reservation.status === ReservationStatus.CHECK_IN_PENDING
    ) {
      return reservation.feeCents;
    }

    if (this.isSameLocalCalendarDay(now, reservation.timeSlotStart)) {
      return Math.floor(reservation.feeCents * 0.5);
    }

    return 0;
  }

  private isSameLocalCalendarDay(left: Date, right: Date) {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  private startOfLocalCalendarDay(value: Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private distanceMeters(
    venueLatitude: number,
    venueLongitude: number,
    userLatitude: number,
    userLongitude: number,
  ) {
    const earthRadiusMeters = 6371000;
    const venueLatRad = this.degreesToRadians(venueLatitude);
    const userLatRad = this.degreesToRadians(userLatitude);
    const deltaLat = this.degreesToRadians(userLatitude - venueLatitude);
    const deltaLon = this.degreesToRadians(userLongitude - venueLongitude);
    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(venueLatRad) *
        Math.cos(userLatRad) *
        Math.sin(deltaLon / 2) *
        Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
  }

  private degreesToRadians(value: number) {
    return (value * Math.PI) / 180;
  }

  private monthKey(value: Date) {
    const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
    return `${value.getUTCFullYear()}-${month}`;
  }

  private numberFrom(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }

  private asJsonObject(value: Prisma.JsonValue | null | undefined) {
    if (typeof value !== "object" || !value || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private jsonStringArray(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }

    return this.uniqueNonEmptyStrings(value.map((item) => item?.toString()));
  }

  private uniqueNonEmptyStrings(values: Array<string | undefined | null>) {
    return Array.from(
      new Set(
        values
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
  }

  private async notifyCustomer(
    reservation: {
      id: string;
      customerId: string | null;
      customerEmail?: string | null;
      tableLabel: string | null;
      venue: { id: string; name: string };
    },
    notification: { title: string; body: string; type: string },
  ) {
    let customerId = reservation.customerId;
    if (!customerId && reservation.customerEmail) {
      const customer = await this.prisma.user.findUnique({
        where: { email: reservation.customerEmail.trim().toLowerCase() },
        select: { id: true },
      });
      customerId = customer?.id ?? null;
    }

    if (!customerId) {
      this.logger.warn(
        `Reservation ${reservation.id} customer notification skipped: no customer id.`,
      );
      return;
    }

    try {
      await this.deviceTokensService.sendToUser({
        userId: customerId,
        app: DevicePushApp.CUSTOMER,
        title: notification.title,
        body: notification.body,
        data: {
          type: notification.type,
          reservationId: reservation.id,
          venueId: reservation.venue.id,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Reservation ${reservation.id} customer notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async notifyCustomerReservationRefundByEmail(
    reservation: {
      id: string;
      customerEmail: string | null;
      tableLabel: string | null;
      refundCents: number;
      currency: string;
      venue: { name: string };
    },
    cancellationContext: {
      status: ReservationStatus;
      timeSlotStart: Date;
      confirmedAt: Date | null;
      customerCheckedInAt: Date | null;
      checkedInAt: Date | null;
      seatedAt: Date | null;
    },
    cancelledAt: Date,
  ) {
    const customerEmail = reservation.customerEmail?.trim().toLowerCase();
    if (
      !customerEmail ||
      reservation.refundCents <= 0 ||
      !this.shouldSendVenueCancellationRefundEmail(
        cancellationContext,
        cancelledAt,
      )
    ) {
      return;
    }

    try {
      await this.emailService.sendReservationRefundEmail({
        to: customerEmail,
        venueName: reservation.venue.name,
        tableLabel: reservation.tableLabel,
        amountCents: reservation.refundCents,
        currency: reservation.currency,
      });
    } catch (error) {
      this.logger.warn(
        `Reservation ${reservation.id} refund email failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private shouldSendVenueCancellationRefundEmail(
    reservation: {
      status: ReservationStatus;
      timeSlotStart: Date;
      confirmedAt: Date | null;
      customerCheckedInAt: Date | null;
      checkedInAt: Date | null;
      seatedAt: Date | null;
    },
    cancelledAt: Date,
  ) {
    const wasConfirmed =
      Boolean(reservation.confirmedAt) ||
      (
        [
          ReservationStatus.CONFIRMED,
          ReservationStatus.RESERVED,
          ReservationStatus.CHECK_IN_PENDING,
          ReservationStatus.CHECKED_IN,
          ReservationStatus.SEATED,
        ] as ReservationStatus[]
      ).includes(reservation.status);
    const hadAnyCheckIn = Boolean(
      reservation.customerCheckedInAt ||
      reservation.checkedInAt ||
      reservation.seatedAt,
    );
    const isCancellationOnReservationDay = this.isSameLocalCalendarDay(
      cancelledAt,
      reservation.timeSlotStart,
    );
    const tomorrow = new Date(
      cancelledAt.getFullYear(),
      cancelledAt.getMonth(),
      cancelledAt.getDate() + 1,
    );
    const isCancellationDayBeforeReservation = this.isSameLocalCalendarDay(
      tomorrow,
      reservation.timeSlotStart,
    );

    return (
      wasConfirmed ||
      hadAnyCheckIn ||
      isCancellationOnReservationDay ||
      isCancellationDayBeforeReservation
    );
  }

  private async notifyVenueOwner(
    reservation: {
      id: string;
      venueId: string;
      tableLabel: string | null;
      customerName: string | null;
      venue: { id: string; name: string; ownerId: string };
    },
    notification: { title: string; body: string; type: string },
  ) {
    try {
      await this.deviceTokensService.sendToUser({
        userId: reservation.venue.ownerId,
        app: DevicePushApp.VENUE_OWNER,
        title: notification.title,
        body: notification.body,
        data: {
          type: notification.type,
          reservationId: reservation.id,
          venueId: reservation.venueId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Reservation ${reservation.id} venue notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private serializeReservation(reservation: {
    id: string;
    venueId: string;
    customerId: string | null;
    tableId: string;
    tableLabel: string | null;
    roomLabel: string | null;
    type: ReservationType;
    status: ReservationStatus;
    partySize: number;
    timeSlotStart: Date;
    timeSlotEnd: Date;
    checkInOpensAt: Date | null;
    checkInClosesAt: Date | null;
    arrivalDeadlineAt: Date | null;
    confirmationExpiresAt: Date | null;
    confirmedAt: Date | null;
    declinedAt: Date | null;
    customerCheckedInAt: Date | null;
    checkedInAt: Date | null;
    seatedAt: Date | null;
    cancelledAt: Date | null;
    releasedAt: Date | null;
    feeCents: number;
    refundCents: number;
    currency: string;
    userLatitude: number | null;
    userLongitude: number | null;
    distanceMeters: number | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    notes: string | null;
    source: string;
    createdAt: Date;
    updatedAt: Date;
    venue: {
      id: string;
      name: string;
      slug: string;
    };
  }) {
    const lockedUntil = this.lockedUntilForReservation(reservation);
    const customerCancellationChargeCents =
      this.customerCancellationChargeCents(reservation, new Date());

    return {
      id: reservation.id,
      venueId: reservation.venueId,
      venue: reservation.venue,
      tableId: reservation.tableId,
      tableLabel: reservation.tableLabel,
      roomLabel: reservation.roomLabel,
      type: reservation.type,
      status: reservation.status,
      partySize: reservation.partySize,
      startAt: reservation.timeSlotStart,
      endAt: reservation.timeSlotEnd,
      checkInOpensAt: this.effectiveCustomerCheckInOpensAt(reservation),
      checkInClosesAt: this.effectiveCustomerCheckInClosesAt(reservation),
      arrivalDeadlineAt: reservation.arrivalDeadlineAt,
      confirmationExpiresAt: reservation.confirmationExpiresAt,
      confirmedAt: reservation.confirmedAt,
      declinedAt: reservation.declinedAt,
      customerCheckedInAt: reservation.customerCheckedInAt,
      checkedInAt: reservation.checkedInAt,
      seatedAt: reservation.seatedAt,
      cancelledAt: reservation.cancelledAt,
      releasedAt: reservation.releasedAt,
      lockedUntil,
      isNightLocked: this.isNightLocked(reservation),
      feeCents: reservation.feeCents,
      refundCents: reservation.refundCents,
      customerCancellationChargeCents,
      customerCancellationRefundCents: Math.max(
        0,
        reservation.feeCents - customerCancellationChargeCents,
      ),
      currency: reservation.currency,
      userLatitude: reservation.userLatitude,
      userLongitude: reservation.userLongitude,
      distanceMeters: reservation.distanceMeters,
      customerName: reservation.customerName,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      notes: reservation.notes,
      source: reservation.source,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  }

  private async serializeVenueReservationRequest(reservation: {
    id: string;
    venueId: string;
    customerId: string | null;
    tableId: string;
    tableLabel: string | null;
    roomLabel: string | null;
    type: ReservationType;
    status: ReservationStatus;
    partySize: number;
    timeSlotStart: Date;
    timeSlotEnd: Date;
    checkInOpensAt: Date | null;
    checkInClosesAt: Date | null;
    arrivalDeadlineAt: Date | null;
    confirmationExpiresAt: Date | null;
    confirmedAt: Date | null;
    declinedAt: Date | null;
    customerCheckedInAt: Date | null;
    checkedInAt: Date | null;
    seatedAt: Date | null;
    cancelledAt: Date | null;
    releasedAt: Date | null;
    feeCents: number;
    refundCents: number;
    currency: string;
    userLatitude: number | null;
    userLongitude: number | null;
    distanceMeters: number | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    notes: string | null;
    source: string;
    createdAt: Date;
    updatedAt: Date;
    venue: {
      id: string;
      name: string;
      slug: string;
    };
  }) {
    const allocation = await this.paymentsService.previewReservationAllocation({
      id: reservation.id,
      customerId: reservation.customerId,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      feeCents: reservation.feeCents,
    });

    return {
      ...this.serializeReservation(reservation),
      chinChinFeeCents: allocation.chinChinFeeCents,
      venueShareCents: allocation.venueShareCents,
      commissionBps: allocation.commissionBps,
      isNewCustomerReservation: allocation.isNewCustomerReservation,
    };
  }
}

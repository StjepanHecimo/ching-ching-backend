import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import {
  ReservationStatus,
  ReservationType,
  SpaceLayoutStatus,
} from "../../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import { DeclineReservationDto } from "./dto/decline-reservation.dto";
import { ReservationAvailabilityQueryDto } from "./dto/reservation-availability-query.dto";
import { UpdateReservationStatusDto } from "./dto/update-reservation-status.dto";
import { UpdateVenueLiveStatusDto } from "./dto/update-venue-live-status.dto";

type ReservableTable = {
  tableId: string;
  tableLabel: string;
  roomLabel: string;
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
};

const ADVANCE_BASE_PRICE_CENTS = 400;
const LIVE_BASE_PRICE_CENTS = 500;
const LARGE_TABLE_SURCHARGE_CENTS = 100;
const LARGE_TABLE_MIN_CAPACITY = 6;
const LIVE_RADIUS_METERS = 1000;
const ARRIVAL_GRACE_MINUTES = 15;
const VENUE_CONFIRMATION_WINDOW_SECONDS = 60;
const RESERVATION_WINDOW_START_MINUTES = 18 * 60;
const RESERVATION_WINDOW_END_MINUTES = 22 * 60;

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getVenueAvailability(
    venueId: string,
    query: ReservationAvailabilityQueryDto,
  ) {
    const slot = this.parseSlot(query.startAt, query.endAt);
    const venue = await this.getVenueReservationState(venueId);
    const liveDistanceMeters = this.validateReservationRuleContext(
      venue,
      query.type,
      query.userLatitude,
      query.userLongitude,
    );
    await this.releaseExpiredReservationLocks(venueId);
    const tables = this.filterTablesForVenueLiveState(
      await this.getApprovedChinChinTables(venueId),
      venue,
    );
    const blockingReservations = await this.findBlockingReservations(
      venueId,
      slot.startAt,
      slot.endAt,
    );
    const blockedTableIds = new Set(
      blockingReservations.map((reservation) => reservation.tableId),
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
      tables: tables.map((table) => ({
        ...table,
        priceCents: this.calculateFeeCents(query.type, table),
        currency: "EUR",
        available:
          table.reservable &&
          query.partySize >= table.minPartySize &&
          query.partySize <= table.maxPartySize &&
          !blockedTableIds.has(table.tableId),
        unavailableReason: this.unavailableReason(
          table,
          query.partySize,
          blockedTableIds,
        ),
      })),
    };
  }

  async createReservation(venueId: string, dto: CreateReservationDto) {
    const slot = this.parseSlot(dto.startAt, dto.endAt);
    const venue = await this.getVenueReservationState(venueId);
    const liveDistanceMeters = this.validateReservationRuleContext(
      venue,
      dto.type,
      dto.userLatitude,
      dto.userLongitude,
    );
    await this.releaseExpiredReservationLocks(venueId);
    const tables = this.filterTablesForVenueLiveState(
      await this.getApprovedChinChinTables(venueId),
      venue,
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
      dto.tableId,
    );

    if (blockingReservations.length) {
      throw new ConflictException(
        "Selected table is already reserved for this time slot.",
      );
    }

    const confirmationExpiresAt = new Date(
      Date.now() + VENUE_CONFIRMATION_WINDOW_SECONDS * 1000,
    );
    const reservation = await this.prisma.reservation.create({
      data: {
        venueId,
        tableId: table.tableId,
        tableLabel: table.tableLabel,
        roomLabel: table.roomLabel,
        type: dto.type as ReservationType,
        status: ReservationStatus.PENDING_VENUE_CONFIRMATION,
        partySize: dto.partySize,
        timeSlotStart: slot.startAt,
        timeSlotEnd: slot.endAt,
        checkInOpensAt: dto.type === "ADVANCE" ? slot.checkInOpensAt : null,
        checkInClosesAt: dto.type === "ADVANCE" ? slot.checkInClosesAt : null,
        arrivalDeadlineAt: slot.arrivalDeadlineAt,
        confirmationExpiresAt,
        feeCents: this.calculateFeeCents(dto.type, table),
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

  async listVenueReservations(venueId: string) {
    await this.releaseExpiredReservationLocks(venueId);
    const reservations = await this.prisma.reservation.findMany({
      where: { venueId },
      orderBy: { timeSlotStart: "desc" },
      take: 100,
      include: { venue: true },
    });

    return reservations.map((reservation) =>
      this.serializeReservation(reservation),
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
      reservation.confirmationExpiresAt.getTime() < Date.now()
    ) {
      const expired = await this.prisma.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.EXPIRED,
          releasedAt: new Date(),
        },
        include: { venue: true },
      });
      return this.serializeReservation(expired);
    }

    const blockers = await this.findBlockingReservations(
      reservation.venueId,
      reservation.timeSlotStart,
      reservation.timeSlotEnd,
      reservation.tableId,
      reservation.id,
    );

    if (blockers.length) {
      throw new ConflictException(
        "Selected table is already reserved for this time slot.",
      );
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status: ReservationStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmationExpiresAt: null,
      },
      include: { venue: true },
    });

    return this.serializeReservation(updated);
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

  async updateVenueLiveStatus(venueId: string, dto: UpdateVenueLiveStatusDto) {
    const existingVenue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true },
    });

    if (!existingVenue) {
      throw new NotFoundException("Venue was not found.");
    }

    const liveChinChinTableIds = dto.isLive
      ? this.uniqueNonEmptyStrings(dto.liveChinChinTableIds ?? [])
      : [];

    const venue = await this.prisma.venue.update({
      where: { id: venueId },
      data: {
        isLive: dto.isLive,
        latitude: dto.latitude,
        longitude: dto.longitude,
        liveChinChinTableIds,
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

  private parseSlot(startAtValue: string, endAtValue: string): ReservationSlot {
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
    if (
      startMinutes < RESERVATION_WINDOW_START_MINUTES ||
      startMinutes > RESERVATION_WINDOW_END_MINUTES
    ) {
      throw new BadRequestException(
        "Reservations are available from 18:00 to 22:00.",
      );
    }

    const checkInOpensAt = new Date(startAt);
    checkInOpensAt.setHours(17, 0, 0, 0);
    const checkInClosesAt = new Date(startAt);
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
      },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    return {
      ...venue,
      liveChinChinTableIds: this.jsonStringArray(venue.liveChinChinTableIds),
    };
  }

  private filterTablesForVenueLiveState(
    tables: ReservableTable[],
    venue: VenueReservationState,
  ) {
    if (!venue.isLive) {
      return tables;
    }

    const activeTableIds = new Set(venue.liveChinChinTableIds);
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

  private calculateFeeCents(type: "ADVANCE" | "LIVE", table: ReservableTable) {
    const basePrice =
      type === "LIVE" ? LIVE_BASE_PRICE_CENTS : ADVANCE_BASE_PRICE_CENTS;
    const surcharge =
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
    let totalTableCount = 0;
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
      const room = rooms[roomIndex];
      if (typeof room !== "object" || !room || Array.isArray(room)) {
        continue;
      }

      const roomMap = room as Record<string, unknown>;
      const roomLabel =
        roomMap.roomLabel?.toString().trim() || `Prostorija ${roomIndex + 1}`;
      const roomTables = Array.isArray(roomMap.tables) ? roomMap.tables : [];
      totalTableCount += roomTables.length;
      for (const table of roomTables) {
        if (typeof table !== "object" || !table || Array.isArray(table)) {
          continue;
        }

        const tableMap = table as Record<string, unknown>;
        const tableId = tableMap.id?.toString();
        if (!tableId) {
          continue;
        }

        const isChinChinTable = tableMap.tableRole === "CHIN_CHIN_TABLE";
        if (!isChinChinTable) {
          continue;
        }

        tables.push({
          tableId,
          tableLabel: tableMap.label?.toString() || tableId,
          roomLabel,
          minPartySize: this.numberFrom(tableMap.minPartySize, 1),
          maxPartySize: this.numberFrom(tableMap.maxPartySize, 4),
          reservable: tableMap.reservable !== false,
        });
      }
    }

    const maxChinChinCount = Math.max(1, Math.floor(totalTableCount / 4));
    return tables.slice(0, maxChinChinCount);
  }

  private findBlockingReservations(
    venueId: string,
    startAt: Date,
    endAt: Date,
    tableId?: string,
    excludeReservationId?: string,
  ) {
    const now = new Date();
    return this.prisma.reservation.findMany({
      where: {
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        venueId,
        ...(tableId ? { tableId } : {}),
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
                ReservationStatus.REQUESTED,
                ReservationStatus.CONFIRMED,
                ReservationStatus.RESERVED,
                ReservationStatus.CHECK_IN_PENDING,
                ReservationStatus.CHECKED_IN,
                ReservationStatus.SEATED,
              ],
            },
          },
        ],
        timeSlotStart: { lt: endAt },
        timeSlotEnd: { gt: startAt },
      },
    });
  }

  private async releaseExpiredReservationLocks(venueId: string) {
    await this.releaseExpiredVenueConfirmationRequests(venueId);
    await this.releaseExpiredArrivalLocks(venueId);
  }

  private async releaseExpiredVenueConfirmationRequests(venueId: string) {
    const now = new Date();
    await this.prisma.reservation.updateMany({
      where: {
        venueId,
        status: ReservationStatus.PENDING_VENUE_CONFIRMATION,
        confirmationExpiresAt: { lt: now },
      },
      data: {
        status: ReservationStatus.EXPIRED,
        releasedAt: now,
      },
    });
  }

  private async releaseExpiredArrivalLocks(venueId: string) {
    const now = new Date();
    const expiredReservations = await this.prisma.reservation.findMany({
      where: {
        venueId,
        arrivalDeadlineAt: { lt: now },
        status: {
          in: [
            ReservationStatus.REQUESTED,
            ReservationStatus.CONFIRMED,
            ReservationStatus.RESERVED,
            ReservationStatus.CHECK_IN_PENDING,
            ReservationStatus.CHECKED_IN,
          ],
        },
      },
      select: {
        id: true,
        type: true,
        feeCents: true,
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
            refundCents:
              reservation.type === ReservationType.ADVANCE
                ? Math.floor(reservation.feeCents * 0.5)
                : 0,
          },
        }),
      ),
    );
  }

  private unavailableReason(
    table: ReservableTable,
    partySize: number,
    blockedTableIds: Set<string>,
  ) {
    if (!table.reservable) {
      return "NOT_RESERVABLE";
    }
    if (partySize < table.minPartySize || partySize > table.maxPartySize) {
      return "CAPACITY_MISMATCH";
    }
    if (blockedTableIds.has(table.tableId)) {
      return "RESERVED";
    }
    return null;
  }

  private statusTimestampsAndRefunds(
    reservation: {
      type: ReservationType;
      status: ReservationStatus;
      feeCents: number;
      notes: string | null;
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
      data.refundCents =
        reservation.type === ReservationType.ADVANCE
          ? Math.floor(reservation.feeCents * 0.5)
          : 0;
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

  private serializeReservation(reservation: {
    id: string;
    venueId: string;
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
      checkInOpensAt: reservation.checkInOpensAt,
      checkInClosesAt: reservation.checkInClosesAt,
      arrivalDeadlineAt: reservation.arrivalDeadlineAt,
      confirmationExpiresAt: reservation.confirmationExpiresAt,
      confirmedAt: reservation.confirmedAt,
      declinedAt: reservation.declinedAt,
      checkedInAt: reservation.checkedInAt,
      seatedAt: reservation.seatedAt,
      cancelledAt: reservation.cancelledAt,
      releasedAt: reservation.releasedAt,
      feeCents: reservation.feeCents,
      refundCents: reservation.refundCents,
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
}

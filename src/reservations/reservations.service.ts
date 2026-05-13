import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import {
  ReservationStatus,
  ReservationType,
  SpaceLayoutStatus,
} from "../../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReservationDto } from "./dto/create-reservation.dto";
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
};

const ADVANCE_BASE_PRICE_CENTS = 400;
const LIVE_BASE_PRICE_CENTS = 500;
const LARGE_TABLE_SURCHARGE_CENTS = 100;
const LARGE_TABLE_MIN_CAPACITY = 6;
const LIVE_RADIUS_METERS = 1000;
const ARRIVAL_GRACE_MINUTES = 15;
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
    await this.releaseExpiredArrivalLocks(venueId);
    const tables = await this.getApprovedChinChinTables(venueId);
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
    await this.releaseExpiredArrivalLocks(venueId);
    const tables = await this.getApprovedChinChinTables(venueId);
    const table = tables.find((item) => item.tableId === dto.tableId);

    if (!table) {
      throw new BadRequestException("Selected table is not an approved Chin-Chin table.");
    }

    if (!table.reservable) {
      throw new BadRequestException("Selected table is not reservable.");
    }

    if (dto.partySize < table.minPartySize || dto.partySize > table.maxPartySize) {
      throw new BadRequestException("Party size does not match table capacity.");
    }

    const blockingReservations = await this.findBlockingReservations(
      venueId,
      slot.startAt,
      slot.endAt,
      dto.tableId,
    );

    if (blockingReservations.length) {
      throw new BadRequestException("Selected table is already reserved for this time slot.");
    }

    const reservation = await this.prisma.reservation.create({
      data: {
        venueId,
        tableId: table.tableId,
        tableLabel: table.tableLabel,
        roomLabel: table.roomLabel,
        type: dto.type as ReservationType,
        status: ReservationStatus.RESERVED,
        partySize: dto.partySize,
        timeSlotStart: slot.startAt,
        timeSlotEnd: slot.endAt,
        checkInOpensAt: dto.type === "ADVANCE" ? slot.checkInOpensAt : null,
        checkInClosesAt: dto.type === "ADVANCE" ? slot.checkInClosesAt : null,
        arrivalDeadlineAt: slot.arrivalDeadlineAt,
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
    await this.releaseExpiredArrivalLocks(venueId);
    const reservations = await this.prisma.reservation.findMany({
      where: { venueId },
      orderBy: { timeSlotStart: "desc" },
      take: 100,
      include: { venue: true },
    });

    return reservations.map((reservation) => this.serializeReservation(reservation));
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
        ...this.statusTimestampsAndRefunds(reservation, dto.status as ReservationStatus),
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

    const venue = await this.prisma.venue.update({
      where: { id: venueId },
      data: {
        isLive: dto.isLive,
        latitude: dto.latitude,
        longitude: dto.longitude,
        liveStartedAt: dto.isLive ? new Date() : undefined,
        liveEndedAt: dto.isLive ? null : new Date(),
      },
    });

    return {
      id: venue.id,
      isLive: venue.isLive,
      latitude: venue.latitude,
      longitude: venue.longitude,
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
      throw new BadRequestException("Reservation end time must be after start time.");
    }

    const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
    if (
      startMinutes < RESERVATION_WINDOW_START_MINUTES ||
      startMinutes > RESERVATION_WINDOW_END_MINUTES
    ) {
      throw new BadRequestException("Reservations are available from 18:00 to 22:00.");
    }

    const checkInOpensAt = new Date(startAt);
    checkInOpensAt.setHours(17, 0, 0, 0);
    const checkInClosesAt = new Date(startAt);
    const arrivalDeadlineAt = new Date(
      startAt.getTime() + ARRIVAL_GRACE_MINUTES * 60 * 1000,
    );

    return { startAt, endAt, checkInOpensAt, checkInClosesAt, arrivalDeadlineAt };
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
      },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    return venue;
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
      throw new BadRequestException("Live reservations are available only while the venue is live.");
    }

    if (venue.latitude == null || venue.longitude == null) {
      throw new BadRequestException("Venue location is required for live reservations.");
    }

    if (userLatitude == null || userLongitude == null) {
      throw new BadRequestException("User location is required for live reservations.");
    }

    const distanceMeters = this.distanceMeters(
      venue.latitude,
      venue.longitude,
      userLatitude,
      userLongitude,
    );

    if (distanceMeters > LIVE_RADIUS_METERS) {
      throw new BadRequestException("User is outside the live reservation radius.");
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

        const isChinChinTable =
          tableMap.tableRole === "CHIN_CHIN_TABLE" ||
          tableMap.chinChinCandidate === true;
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

    return tables;
  }

  private findBlockingReservations(
    venueId: string,
    startAt: Date,
    endAt: Date,
    tableId?: string,
  ) {
    return this.prisma.reservation.findMany({
      where: {
        venueId,
        ...(tableId ? { tableId } : {}),
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
        timeSlotStart: { lt: endAt },
        timeSlotEnd: { gt: startAt },
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
      refundCents?: number;
    } = {};

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

  private numberFrom(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private asJsonObject(value: Prisma.JsonValue | null | undefined) {
    if (typeof value !== "object" || !value || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
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

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertVenueChinChinPanelDto } from "./dto/upsert-venue-chin-chin-panel.dto";

@Injectable()
export class VenueChinChinPanelService {
  constructor(private readonly prisma: PrismaService) {}

  async getForVenue(venueId: string) {
    const panel = await this.prisma.venueChinChinPanel.findUnique({
      where: { venueId },
      include: { venue: true },
    });

    if (!panel) {
      throw new NotFoundException("Chin-Chin panel settings were not found.");
    }

    return this.serializePanel(panel);
  }

  async upsertForVenue(venueId: string, dto: UpsertVenueChinChinPanelDto) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    const promotionalDrinks = dto.promotionalDrinks
      .map((drink) => drink.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!promotionalDrinks.length) {
      throw new BadRequestException("Provide at least one promotional drink.");
    }

    const draftBeers = dto.hasDraftBeer
      ? (dto.draftBeers ?? []).map((beer) => beer.trim()).filter(Boolean)
      : [];
    if (dto.hasDraftBeer && !draftBeers.length) {
      throw new BadRequestException(
        "Provide draft beers when draft beer is enabled.",
      );
    }

    if (
      dto.hasEvent &&
      (!dto.eventDay?.trim() ||
        !dto.eventStartsAt?.trim() ||
        !dto.eventBand?.trim())
    ) {
      throw new BadRequestException(
        "Event day, start time and band are required when event is enabled.",
      );
    }
    const eventDescription = dto.eventDescription?.trim() || null;

    const panel = await this.prisma.venueChinChinPanel.upsert({
      where: { venueId },
      create: {
        venueId,
        promotionalDrinks: promotionalDrinks as Prisma.InputJsonValue,
        hasDraftBeer: dto.hasDraftBeer,
        draftBeers: draftBeers as Prisma.InputJsonValue,
        hasEvent: dto.hasEvent,
        eventDay: dto.hasEvent ? dto.eventDay?.trim() : null,
        eventStartsAt: dto.hasEvent ? dto.eventStartsAt?.trim() : null,
        eventBand: dto.hasEvent ? dto.eventBand?.trim() : null,
        eventDescription: dto.hasEvent ? eventDescription : null,
        updatedBy: "flutter-owner-panel",
      },
      update: {
        promotionalDrinks: promotionalDrinks as Prisma.InputJsonValue,
        hasDraftBeer: dto.hasDraftBeer,
        draftBeers: draftBeers as Prisma.InputJsonValue,
        hasEvent: dto.hasEvent,
        eventDay: dto.hasEvent ? dto.eventDay?.trim() : null,
        eventStartsAt: dto.hasEvent ? dto.eventStartsAt?.trim() : null,
        eventBand: dto.hasEvent ? dto.eventBand?.trim() : null,
        eventDescription: dto.hasEvent ? eventDescription : null,
        updatedBy: "flutter-owner-panel",
      },
      include: { venue: true },
    });

    return this.serializePanel(panel);
  }

  private serializePanel(panel: {
    id: string;
    venueId: string;
    promotionalDrinks: Prisma.JsonValue;
    hasDraftBeer: boolean;
    draftBeers: Prisma.JsonValue;
    hasEvent: boolean;
    eventDay: string | null;
    eventStartsAt: string | null;
    eventBand: string | null;
    eventDescription: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    venue: {
      id: string;
      name: string;
      slug: string;
    };
  }) {
    return {
      id: panel.id,
      venueId: panel.venueId,
      venue: panel.venue,
      promotionalDrinks: Array.isArray(panel.promotionalDrinks)
        ? panel.promotionalDrinks
        : [],
      hasDraftBeer: panel.hasDraftBeer,
      draftBeers: Array.isArray(panel.draftBeers) ? panel.draftBeers : [],
      hasEvent: panel.hasEvent,
      event: panel.hasEvent
        ? {
            day: panel.eventDay,
            startsAt: panel.eventStartsAt,
            band: panel.eventBand,
            description: panel.eventDescription,
          }
        : null,
      updatedBy: panel.updatedBy,
      createdAt: panel.createdAt,
      updatedAt: panel.updatedAt,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertVenueChinChinPanelDto } from "./dto/upsert-venue-chin-chin-panel.dto";

type DrinkBrandSeed = {
  name: string;
  brandKey: string;
  type:
    | "GIN"
    | "WHISKEY"
    | "DRAFT_BEER"
    | "BEER"
    | "COCKTAIL"
    | "WINE"
    | "OTHER";
  aliases: string[];
  logoAssetKey: string;
};

type NormalizedDrink = {
  name: string;
  type: string;
  brandKey: string | null;
  logoAssetKey: string | null;
  logoUrl: string | null;
  sourceText: string;
};

type DrinkBrandLookup = {
  name: string;
  brandKey: string;
  type: string;
  aliases: string[];
  logoAssetKey: string | null;
  logoUrl: string | null;
};

type ContentAssetSeed = {
  name: string;
  contentKey: string;
  type: "EVENT" | "TV_CONTENT" | "KARAOKE" | "OTHER";
  aliases: string[];
  logoAssetKey: string;
};

type NormalizedContent = {
  name: string;
  type: string;
  contentKey: string | null;
  logoAssetKey: string | null;
  logoUrl: string | null;
  sourceText: string;
};

type NormalizedPanelEvent = {
  id: string;
  day: string;
  startsAt: string;
  band: string;
  content: NormalizedContent;
  description: string | null;
};

type PanelEventInput = {
  day: string;
  startsAt: string;
  contentName: string;
  description: string | null;
};

type ContentAssetLookup = {
  name: string;
  contentKey: string;
  type: string;
  aliases: string[];
  logoAssetKey: string | null;
  logoUrl: string | null;
};

const DRINK_BRAND_SEEDS: DrinkBrandSeed[] = [
  {
    name: "Heineken",
    brandKey: "heineken",
    type: "DRAFT_BEER",
    aliases: ["heineken", "haineken", "heiniken"],
    logoAssetKey: "heineken",
  },
  {
    name: "Ozujsko",
    brandKey: "ozujsko",
    type: "DRAFT_BEER",
    aliases: ["ozujsko", "žuja", "zuja"],
    logoAssetKey: "ozujsko",
  },
  {
    name: "Staropramen",
    brandKey: "staropramen",
    type: "DRAFT_BEER",
    aliases: ["staropramen"],
    logoAssetKey: "staropramen",
  },
  {
    name: "Jameson",
    brandKey: "jameson",
    type: "WHISKEY",
    aliases: ["jameson"],
    logoAssetKey: "jameson",
  },
  {
    name: "Jack Daniel's",
    brandKey: "jack_daniels",
    type: "WHISKEY",
    aliases: ["jack daniels", "jack daniel's", "jack"],
    logoAssetKey: "jack_daniels",
  },
  {
    name: "Bombay Sapphire",
    brandKey: "bombay_sapphire",
    type: "GIN",
    aliases: ["bombay", "bombay sapphire"],
    logoAssetKey: "bombay_sapphire",
  },
  {
    name: "Hendrick's",
    brandKey: "hendricks",
    type: "GIN",
    aliases: ["hendricks", "hendrick's"],
    logoAssetKey: "hendricks",
  },
  {
    name: "Tanqueray",
    brandKey: "tanqueray",
    type: "GIN",
    aliases: ["tanqueray"],
    logoAssetKey: "tanqueray",
  },
];

const CONTENT_ASSET_SEEDS: ContentAssetSeed[] = [
  {
    name: "Band",
    contentKey: "band",
    type: "EVENT",
    aliases: ["band", "live band", "svirka", "muzika uživo"],
    logoAssetKey: "band",
  },
  {
    name: "DJ",
    contentKey: "dj",
    type: "EVENT",
    aliases: ["dj", "deejay", "party"],
    logoAssetKey: "dj",
  },
  {
    name: "Karaoke",
    contentKey: "karaoke",
    type: "KARAOKE",
    aliases: ["karaoke", "karaoke night"],
    logoAssetKey: "karaoke",
  },
  {
    name: "UEFA Champions League",
    contentKey: "uefa",
    type: "TV_CONTENT",
    aliases: [
      "uefa",
      "liga prvaka",
      "champions league",
      "champions_league",
      "ucl",
    ],
    logoAssetKey: "uefa",
  },
];

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

  async listPublicVenues(city?: string) {
    const normalizedCity = city?.trim();

    const venues = await this.prisma.venue.findMany({
      where: normalizedCity
        ? {
            city: {
              equals: normalizedCity,
              mode: "insensitive",
            },
          }
        : undefined,
      include: {
        chinChinPanel: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return {
      city: normalizedCity || null,
      count: venues.length,
      venues: venues.map((venue) => {
        const liveChinChinTableIds = this.jsonStringArray(
          venue.liveChinChinTableIds,
        );
        const isLive = this.isVenueEffectivelyLive(
          venue.isLive,
          liveChinChinTableIds,
          venue.liveStartedAt,
          venue.liveEndedAt,
        );

        return {
          id: venue.id,
          name: venue.name,
          slug: venue.slug,
          address: venue.address,
          city: venue.city,
          country: venue.country,
          latitude: venue.latitude,
          longitude: venue.longitude,
          isLive,
          liveChinChinTableIds: isLive ? liveChinChinTableIds : [],
          reservationWindowStartMinutes: venue.reservationWindowStartMinutes,
          reservationWindowEndMinutes: venue.reservationWindowEndMinutes,
          panel: venue.chinChinPanel
            ? this.serializePanel({
                ...venue.chinChinPanel,
                venue: {
                  id: venue.id,
                  name: venue.name,
                  slug: venue.slug,
                },
              })
            : null,
        };
      }),
    };
  }

  async listPublicEventVenues(city?: string) {
    const normalizedCity = city?.trim();
    const venues = await this.prisma.venue.findMany({
      where: {
        ...(normalizedCity
          ? {
              city: {
                equals: normalizedCity,
                mode: "insensitive",
              },
            }
          : {}),
        chinChinPanel: {
          is: {
            hasEvent: true,
          },
        },
      },
      include: {
        chinChinPanel: true,
      },
      orderBy: {
        name: "asc",
      },
      take: 100,
    });

    const eventVenues = venues
      .map((venue) => {
        if (!venue.chinChinPanel) {
          return null;
        }

        const panel = this.serializePanel({
          ...venue.chinChinPanel,
          venue: {
            id: venue.id,
            name: venue.name,
            slug: venue.slug,
          },
        });

        if (!panel.event) {
          return null;
        }

        const liveChinChinTableIds = this.jsonStringArray(
          venue.liveChinChinTableIds,
        );
        const isLive = this.isVenueEffectivelyLive(
          venue.isLive,
          liveChinChinTableIds,
          venue.liveStartedAt,
          venue.liveEndedAt,
        );

        return {
          id: venue.id,
          name: venue.name,
          slug: venue.slug,
          address: venue.address,
          city: venue.city,
          country: venue.country,
          latitude: venue.latitude,
          longitude: venue.longitude,
          isLive,
          liveChinChinTableIds: isLive ? liveChinChinTableIds : [],
          reservationWindowStartMinutes: venue.reservationWindowStartMinutes,
          reservationWindowEndMinutes: venue.reservationWindowEndMinutes,
          panel,
        };
      })
      .filter((venue): venue is NonNullable<typeof venue> => venue !== null)
      .sort((left, right) => {
        const leftEvent = left.panel.event;
        const rightEvent = right.panel.event;
        if (!leftEvent || !rightEvent) {
          return left.name.localeCompare(right.name);
        }
        return (
          this.eventTimestamp(leftEvent) - this.eventTimestamp(rightEvent) ||
          left.name.localeCompare(right.name)
        );
      });

    return {
      city: normalizedCity || null,
      count: eventVenues.length,
      venues: eventVenues,
    };
  }

  async listDrinkBrands() {
    await this.ensureDefaultDrinkBrands();

    return {
      brands: await this.loadDrinkBrands(),
    };
  }

  async listContentAssets() {
    await this.ensureDefaultContentAssets();

    return {
      assets: await this.loadContentAssets(),
    };
  }

  async upsertForVenue(venueId: string, dto: UpsertVenueChinChinPanelDto) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
    });
    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    await Promise.all([
      this.ensureDefaultDrinkBrands(),
      this.ensureDefaultContentAssets(),
    ]);

    const promotionalDrinkNames = dto.promotionalDrinks
      .map((drink) => drink.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!promotionalDrinkNames.length) {
      throw new BadRequestException("Provide at least one promotional drink.");
    }

    const draftBeerNames = dto.hasDraftBeer
      ? (dto.draftBeers ?? []).map((beer) => beer.trim()).filter(Boolean)
      : [];
    if (dto.hasDraftBeer && !draftBeerNames.length) {
      throw new BadRequestException(
        "Provide draft beers when draft beer is enabled.",
      );
    }

    const promotionalDrinks = await this.normalizeDrinks(
      promotionalDrinkNames,
      "OTHER",
    );
    const draftBeers = await this.normalizeDrinks(draftBeerNames, "DRAFT_BEER");
    const eventInputs = this.collectEventInputs(dto);
    if (dto.hasEvent && !eventInputs.length) {
      throw new BadRequestException(
        "At least one event is required when event is enabled.",
      );
    }
    const events = dto.hasEvent
      ? await this.normalizePanelEvents(eventInputs)
      : [];
    const primaryEvent = events[0] ?? null;

    const panel = await this.prisma.venueChinChinPanel.upsert({
      where: { venueId },
      create: {
        venueId,
        promotionalDrinks: promotionalDrinks as Prisma.InputJsonValue,
        hasDraftBeer: dto.hasDraftBeer,
        draftBeers: draftBeers as Prisma.InputJsonValue,
        hasEvent: dto.hasEvent,
        events: events as Prisma.InputJsonValue,
        eventDay: primaryEvent?.day ?? null,
        eventStartsAt: primaryEvent?.startsAt ?? null,
        eventBand: primaryEvent?.band ?? null,
        eventContent: primaryEvent?.content as Prisma.InputJsonValue,
        eventDescription: primaryEvent?.description ?? null,
        updatedBy: "flutter-owner-panel",
      },
      update: {
        promotionalDrinks: promotionalDrinks as Prisma.InputJsonValue,
        hasDraftBeer: dto.hasDraftBeer,
        draftBeers: draftBeers as Prisma.InputJsonValue,
        hasEvent: dto.hasEvent,
        events: events as Prisma.InputJsonValue,
        eventDay: primaryEvent?.day ?? null,
        eventStartsAt: primaryEvent?.startsAt ?? null,
        eventBand: primaryEvent?.band ?? null,
        eventContent: primaryEvent?.content as Prisma.InputJsonValue,
        eventDescription: primaryEvent?.description ?? null,
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
    events: Prisma.JsonValue | null;
    eventDay: string | null;
    eventStartsAt: string | null;
    eventBand: string | null;
    eventContent: Prisma.JsonValue | null;
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
    const events = this.serializePanelEvents(panel.events);
    const fallbackEvent =
      !events.length && panel.eventDay && panel.eventStartsAt && panel.eventBand
        ? [
            {
              id: this.createEventId(
                panel.eventDay,
                panel.eventStartsAt,
                panel.eventBand,
              ),
              day: panel.eventDay,
              startsAt: panel.eventStartsAt,
              band: panel.eventBand,
              content:
                this.serializeContent(panel.eventContent) ??
                this.normalizeContentFromSeed(panel.eventBand, "EVENT"),
              description: panel.eventDescription,
            },
          ]
        : [];
    const visibleEvents = events.length ? events : fallbackEvent;
    const displayEvent = this.pickDisplayEvent(visibleEvents);

    return {
      id: panel.id,
      venueId: panel.venueId,
      venue: panel.venue,
      promotionalDrinks: this.serializeDrinkList(panel.promotionalDrinks),
      hasDraftBeer: panel.hasDraftBeer,
      draftBeers: this.serializeDrinkList(panel.draftBeers),
      hasEvent: panel.hasEvent,
      events: panel.hasEvent ? visibleEvents : [],
      event: panel.hasEvent ? displayEvent : null,
      updatedBy: panel.updatedBy,
      createdAt: panel.createdAt,
      updatedAt: panel.updatedAt,
    };
  }

  private isVenueEffectivelyLive(
    isLive: boolean,
    liveChinChinTableIds: string[],
    liveStartedAt: Date | null,
    liveEndedAt: Date | null,
  ) {
    if (!isLive || liveChinChinTableIds.length === 0 || !liveStartedAt) {
      return false;
    }

    return (
      !liveEndedAt &&
      this.zagrebDateKey(liveStartedAt) === this.zagrebDateKey(new Date())
    );
  }

  private zagrebDateKey(date: Date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zagreb",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  private serializeDrinkList(value: Prisma.JsonValue): NormalizedDrink[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (typeof entry === "string") {
          return this.normalizeDrinkFromSeed(entry, "OTHER");
        }

        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }

        const item = entry as Record<string, unknown>;
        const name = item.name?.toString().trim() || "";
        if (!name) {
          return null;
        }

        return {
          name,
          type: item.type?.toString() || "OTHER",
          brandKey: item.brandKey?.toString() || null,
          logoAssetKey: item.logoAssetKey?.toString() || null,
          logoUrl: item.logoUrl?.toString() || null,
          sourceText: item.sourceText?.toString() || name,
        };
      })
      .filter((entry): entry is NormalizedDrink => entry !== null);
  }

  private serializeContent(
    value: Prisma.JsonValue | null,
  ): NormalizedContent | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const item = value as Record<string, unknown>;
    const name = item.name?.toString().trim() || "";
    if (!name) {
      return null;
    }
    const contentKey = item.contentKey?.toString() || null;
    const currentSeed = CONTENT_ASSET_SEEDS.find(
      (asset) =>
        asset.contentKey === contentKey ||
        asset.aliases.some(
          (alias) => this.normalizeText(alias) === this.normalizeText(name),
        ),
    );

    if (currentSeed) {
      return {
        name: currentSeed.name,
        type: currentSeed.type,
        contentKey: currentSeed.contentKey,
        logoAssetKey: currentSeed.logoAssetKey,
        logoUrl: null,
        sourceText: item.sourceText?.toString() || name,
      };
    }

    return {
      name,
      type: item.type?.toString() || "EVENT",
      contentKey,
      logoAssetKey: item.logoAssetKey?.toString() || null,
      logoUrl: item.logoUrl?.toString() || null,
      sourceText: item.sourceText?.toString() || name,
    };
  }

  private serializePanelEvents(value: Prisma.JsonValue | null) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }

        const item = entry as Record<string, unknown>;
        const day = item.day?.toString().trim() || "";
        const startsAt = item.startsAt?.toString().trim() || "";
        const band = item.band?.toString().trim() || "";
        const content = this.serializeContent(
          (item.content ?? null) as Prisma.JsonValue | null,
        );
        if (!day || !startsAt || !band || !content) {
          return null;
        }

        return {
          id:
            item.id?.toString() ||
            this.createEventId(day, startsAt, content.contentKey ?? band),
          day,
          startsAt,
          band,
          content,
          description: item.description?.toString() || null,
        };
      })
      .filter((entry): entry is NormalizedPanelEvent => entry !== null);
  }

  private collectEventInputs(dto: UpsertVenueChinChinPanelDto) {
    const events = Array.isArray(dto.events) ? dto.events : [];
    const eventInputs = events
      .map((event) => ({
        day: event.day?.trim() ?? "",
        startsAt: event.startsAt?.trim() ?? "",
        contentName: event.contentName?.trim() ?? "",
        description: event.description?.trim() || null,
      }))
      .filter((event) => event.day && event.startsAt && event.contentName);

    if (eventInputs.length) {
      return eventInputs;
    }

    const singleEvent = {
      day: dto.eventDay?.trim() ?? "",
      startsAt: dto.eventStartsAt?.trim() ?? "",
      contentName: (dto.eventContentName ?? dto.eventBand ?? "").trim(),
      description: dto.eventDescription?.trim() || null,
    };

    return singleEvent.day && singleEvent.startsAt && singleEvent.contentName
      ? [singleEvent]
      : [];
  }

  private async normalizePanelEvents(
    eventInputs: PanelEventInput[],
  ): Promise<NormalizedPanelEvent[]> {
    const seen = new Set<string>();
    const normalizedEvents: NormalizedPanelEvent[] = [];

    for (const event of eventInputs) {
      const content = await this.normalizeContent(event.contentName, "EVENT");
      const id = this.createEventId(
        event.day,
        event.startsAt,
        content.contentKey ?? content.name,
      );
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);

      normalizedEvents.push({
        id,
        day: event.day,
        startsAt: event.startsAt,
        band: content.name,
        content,
        description: event.description,
      });
    }

    return normalizedEvents.sort(
      (left, right) => this.eventTimestamp(left) - this.eventTimestamp(right),
    );
  }

  private pickDisplayEvent(events: NormalizedPanelEvent[]) {
    if (!events.length) {
      return null;
    }

    const today = new Date();
    const todayKey = this.formatDateKey(today);
    const todaysEvents = events
      .filter((event) => event.day === todayKey)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    if (todaysEvents.length) {
      return todaysEvents[0];
    }

    const now = Date.now();
    const futureEvents = events
      .filter((event) => this.eventTimestamp(event) >= now)
      .sort(
        (left, right) => this.eventTimestamp(left) - this.eventTimestamp(right),
      );
    return futureEvents[0] ?? events[0];
  }

  private async normalizeDrinks(
    drinkNames: string[],
    fallbackType: NormalizedDrink["type"],
  ): Promise<NormalizedDrink[]> {
    const brands = await this.loadDrinkBrands();

    return drinkNames.map((drinkName) =>
      this.normalizeDrinkFromBrands(drinkName, fallbackType, brands),
    );
  }

  private async normalizeContent(
    contentName: string,
    fallbackType: NormalizedContent["type"],
  ): Promise<NormalizedContent> {
    const assets = await this.loadContentAssets();
    return this.normalizeContentFromAssets(contentName, fallbackType, assets);
  }

  private normalizeDrinkFromSeed(
    drinkName: string,
    fallbackType: NormalizedDrink["type"],
  ): NormalizedDrink {
    const sourceText = drinkName.trim();
    const normalized = this.normalizeText(sourceText);
    const match = DRINK_BRAND_SEEDS.find((brand) =>
      brand.aliases.some((alias) => this.normalizeText(alias) === normalized),
    );

    return {
      name: match?.name ?? sourceText,
      type: match?.type ?? fallbackType,
      brandKey: match?.brandKey ?? null,
      logoAssetKey: match?.logoAssetKey ?? null,
      logoUrl: null,
      sourceText,
    };
  }

  private normalizeContentFromSeed(
    contentName: string,
    fallbackType: NormalizedContent["type"],
  ): NormalizedContent {
    const sourceText = contentName.trim();
    const normalized = this.normalizeText(sourceText);
    const match = CONTENT_ASSET_SEEDS.find((asset) =>
      asset.aliases.some((alias) => this.normalizeText(alias) === normalized),
    );

    return {
      name: match?.name ?? sourceText,
      type: match?.type ?? fallbackType,
      contentKey: match?.contentKey ?? null,
      logoAssetKey: match?.logoAssetKey ?? null,
      logoUrl: null,
      sourceText,
    };
  }

  private normalizeContentFromAssets(
    contentName: string,
    fallbackType: NormalizedContent["type"],
    assets: ContentAssetLookup[],
  ): NormalizedContent {
    const sourceText = contentName.trim();
    const normalized = this.normalizeText(sourceText);
    const match = assets.find((asset) =>
      asset.aliases.some((alias) => this.normalizeText(alias) === normalized),
    );

    if (!match) {
      return {
        name: sourceText,
        type: fallbackType,
        contentKey: null,
        logoAssetKey: null,
        logoUrl: null,
        sourceText,
      };
    }

    return {
      name: match.name,
      type: match.type,
      contentKey: match.contentKey,
      logoAssetKey: match.logoAssetKey,
      logoUrl: match.logoUrl,
      sourceText,
    };
  }

  private normalizeDrinkFromBrands(
    drinkName: string,
    fallbackType: NormalizedDrink["type"],
    brands: DrinkBrandLookup[],
  ): NormalizedDrink {
    const sourceText = drinkName.trim();
    const normalized = this.normalizeText(sourceText);
    const match = brands.find((brand) =>
      brand.aliases.some((alias) => this.normalizeText(alias) === normalized),
    );

    if (!match) {
      return {
        name: sourceText,
        type: fallbackType,
        brandKey: null,
        logoAssetKey: null,
        logoUrl: null,
        sourceText,
      };
    }

    return {
      name: match.name,
      type: match.type,
      brandKey: match.brandKey,
      logoAssetKey: match.logoAssetKey,
      logoUrl: match.logoUrl,
      sourceText,
    };
  }

  private async ensureDefaultDrinkBrands() {
    await Promise.all(
      DRINK_BRAND_SEEDS.map((brand) =>
        this.prisma.drinkBrand.upsert({
          where: { brandKey: brand.brandKey },
          create: {
            name: brand.name,
            brandKey: brand.brandKey,
            type: brand.type,
            aliases: brand.aliases as Prisma.InputJsonValue,
            logoAssetKey: brand.logoAssetKey,
          },
          update: {
            name: brand.name,
            type: brand.type,
            aliases: brand.aliases as Prisma.InputJsonValue,
            logoAssetKey: brand.logoAssetKey,
            isActive: true,
          },
        }),
      ),
    );
    await this.prisma.chinChinContentAsset.updateMany({
      where: { contentKey: "champions_league" },
      data: { isActive: false },
    });
  }

  private async ensureDefaultContentAssets() {
    await Promise.all(
      CONTENT_ASSET_SEEDS.map((asset) =>
        this.prisma.chinChinContentAsset.upsert({
          where: { contentKey: asset.contentKey },
          create: {
            name: asset.name,
            contentKey: asset.contentKey,
            type: asset.type,
            aliases: asset.aliases as Prisma.InputJsonValue,
            logoAssetKey: asset.logoAssetKey,
          },
          update: {
            name: asset.name,
            type: asset.type,
            aliases: asset.aliases as Prisma.InputJsonValue,
            logoAssetKey: asset.logoAssetKey,
            isActive: true,
          },
        }),
      ),
    );
  }

  private async loadDrinkBrands(): Promise<DrinkBrandLookup[]> {
    const brands = await this.prisma.drinkBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    return brands.map((brand) => {
      const aliases = Array.isArray(brand.aliases)
        ? brand.aliases
            .map((alias) => alias?.toString().trim() ?? "")
            .filter(Boolean)
        : [];

      return {
        name: brand.name,
        brandKey: brand.brandKey,
        type: brand.type,
        aliases: Array.from(new Set([brand.name, brand.brandKey, ...aliases])),
        logoAssetKey: brand.logoAssetKey,
        logoUrl: brand.logoUrl,
      };
    });
  }

  private async loadContentAssets(): Promise<ContentAssetLookup[]> {
    const assets = await this.prisma.chinChinContentAsset.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    return assets.map((asset) => {
      const aliases = Array.isArray(asset.aliases)
        ? asset.aliases
            .map((alias) => alias?.toString().trim() ?? "")
            .filter(Boolean)
        : [];

      return {
        name: asset.name,
        contentKey: asset.contentKey,
        type: asset.type,
        aliases: Array.from(
          new Set([asset.name, asset.contentKey, ...aliases]),
        ),
        logoAssetKey: asset.logoAssetKey,
        logoUrl: asset.logoUrl,
      };
    });
  }

  private createEventId(day: string, startsAt: string, name: string) {
    return this.normalizeText(`${day}-${startsAt}-${name}`).replace(
      /\s+/g,
      "-",
    );
  }

  private eventTimestamp(event: { day: string; startsAt: string }) {
    const timestamp = new Date(`${event.day}T${event.startsAt}:00`).getTime();
    return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
  }

  private formatDateKey(date: Date) {
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private normalizeText(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private jsonStringArray(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .map((item) => item?.toString().trim())
          .filter((item): item is string => Boolean(item)),
      ),
    );
  }
}

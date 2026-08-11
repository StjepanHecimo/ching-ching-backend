import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma/client";
import { DevicePushApp, SpaceLayoutStatus } from "../../generated/prisma/enums";
import { DeviceTokensService } from "../device-tokens/device-tokens.service";
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
  promoPriceLabel?: string | null;
  promoSizeLabel?: string | null;
};

type DrinkPanelInput = {
  name: string;
  promoPriceLabel?: string | null;
  promoSizeLabel?: string | null;
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
  endsAt: string;
  band: string;
  eventName: string;
  content: NormalizedContent;
  description: string | null;
  posterDataUrl: string | null;
};

type PanelEventInput = {
  day: string;
  startsAt: string;
  endsAt: string;
  contentName: string;
  eventName: string;
  description: string | null;
  posterDataUrl: string | null;
};

const MIN_PUBLIC_SELECTION_ALLOWED_RATIO = 0.3;

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
    name: "Carlsberg",
    brandKey: "carlsberg",
    type: "DRAFT_BEER",
    aliases: ["carlsberg"],
    logoAssetKey: "carlsberg",
  },
  {
    name: "Stella Artois",
    brandKey: "stella_artois",
    type: "DRAFT_BEER",
    aliases: ["stella artois", "stella"],
    logoAssetKey: "stella_artois",
  },
  {
    name: "Amstel",
    brandKey: "amstel",
    type: "DRAFT_BEER",
    aliases: ["amstel"],
    logoAssetKey: "amstel",
  },
  {
    name: "Kronenbourg 1664",
    brandKey: "kronenbourg_1664",
    type: "DRAFT_BEER",
    aliases: ["kronenbourg 1664", "kronenbourg", "1664"],
    logoAssetKey: "kronenbourg_1664",
  },
  {
    name: "Guinness",
    brandKey: "guinness",
    type: "DRAFT_BEER",
    aliases: ["guinness"],
    logoAssetKey: "guinness",
  },
  {
    name: "Beck's",
    brandKey: "becks",
    type: "DRAFT_BEER",
    aliases: ["becks", "beck's"],
    logoAssetKey: "becks",
  },
  {
    name: "Budweiser Budvar",
    brandKey: "budweiser_budvar",
    type: "DRAFT_BEER",
    aliases: ["budweiser budvar", "budvar"],
    logoAssetKey: "budweiser_budvar",
  },
  {
    name: "Pilsner Urquell",
    brandKey: "pilsner_urquell",
    type: "DRAFT_BEER",
    aliases: ["pilsner urquell", "pilsner"],
    logoAssetKey: "pilsner_urquell",
  },
  {
    name: "Estrella Damm",
    brandKey: "estrella_damm",
    type: "DRAFT_BEER",
    aliases: ["estrella damm", "estrella"],
    logoAssetKey: "estrella_damm",
  },
  {
    name: "Ozujsko",
    brandKey: "ozujsko",
    type: "DRAFT_BEER",
    aliases: ["ozujsko", "žuja", "zuja"],
    logoAssetKey: "ozujsko",
  },
  {
    name: "Karlovacko",
    brandKey: "karlovacko",
    type: "DRAFT_BEER",
    aliases: ["karlovacko", "karlovačko"],
    logoAssetKey: "karlovacko",
  },
  {
    name: "Paulaner",
    brandKey: "paulaner",
    type: "DRAFT_BEER",
    aliases: ["paulaner"],
    logoAssetKey: "paulaner",
  },
  {
    name: "Staropramen",
    brandKey: "staropramen",
    type: "DRAFT_BEER",
    aliases: ["staropramen"],
    logoAssetKey: "staropramen",
  },
  {
    name: "Ballantine's",
    brandKey: "ballantines",
    type: "WHISKEY",
    aliases: ["ballantines", "ballantine's", "ballantine"],
    logoAssetKey: "ballantines",
  },
  {
    name: "Johnnie Walker",
    brandKey: "johnnie_walker",
    type: "WHISKEY",
    aliases: ["johnnie walker", "johnie walker", "johnny walker"],
    logoAssetKey: "johnnie_walker",
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
    logoAssetKey: "jack-daniels",
  },
  {
    name: "Chivas Regal",
    brandKey: "chivas_regal",
    type: "WHISKEY",
    aliases: ["chivas regal", "chivas"],
    logoAssetKey: "chivas_regal",
  },
  {
    name: "Bacardi",
    brandKey: "bacardi",
    type: "COCKTAIL",
    aliases: ["bacardi"],
    logoAssetKey: "bacardi",
  },
  {
    name: "Malibu",
    brandKey: "malibu",
    type: "COCKTAIL",
    aliases: ["malibu"],
    logoAssetKey: "malibu",
  },
  {
    name: "Bailey's",
    brandKey: "baileys",
    type: "COCKTAIL",
    aliases: ["baileys", "bailey's"],
    logoAssetKey: "baileys",
  },
  {
    name: "Vodka strana",
    brandKey: "vodka_strana",
    type: "COCKTAIL",
    aliases: ["vodka strana", "strana vodka"],
    logoAssetKey: "vodka_strana",
  },
  {
    name: "Vodka voćna",
    brandKey: "vodka_vocna",
    type: "COCKTAIL",
    aliases: ["vodka vocna", "vodka voćna", "vocna vodka", "voćna vodka"],
    logoAssetKey: "vodka_vocna",
  },
  {
    name: "Sambuca",
    brandKey: "sambuca",
    type: "COCKTAIL",
    aliases: ["sambuca"],
    logoAssetKey: "sambuca",
  },
  {
    name: "Viljamovka",
    brandKey: "viljamovka",
    type: "COCKTAIL",
    aliases: ["viljamovka", "viljam"],
    logoAssetKey: "viljamovka",
  },
  {
    name: "Campari",
    brandKey: "campari",
    type: "COCKTAIL",
    aliases: ["campari"],
    logoAssetKey: "campari",
  },
  {
    name: "Jagermeister",
    brandKey: "jagermeister",
    type: "COCKTAIL",
    aliases: ["jagermeister", "jägermeister", "jager"],
    logoAssetKey: "jagermeister",
  },
  {
    name: "Tequila",
    brandKey: "tequila",
    type: "COCKTAIL",
    aliases: ["tequila", "tequilla"],
    logoAssetKey: "tequila",
  },
  {
    name: "Martell",
    brandKey: "martell",
    type: "COCKTAIL",
    aliases: ["martell"],
    logoAssetKey: "martell",
  },
  {
    name: "Courvoisier",
    brandKey: "courvoisier",
    type: "COCKTAIL",
    aliases: ["courvoisier"],
    logoAssetKey: "courvoisier",
  },
  {
    name: "Hennessy",
    brandKey: "hennessy",
    type: "COCKTAIL",
    aliases: ["hennessy"],
    logoAssetKey: "hennessy",
  },
  {
    name: "Aperol",
    brandKey: "aperol",
    type: "COCKTAIL",
    aliases: ["aperol"],
    logoAssetKey: "aperol",
  },
  {
    name: "Aperol Spritz",
    brandKey: "aperol_spritz",
    type: "COCKTAIL",
    aliases: ["aperol spritz", "spritz"],
    logoAssetKey: "aperol_spritz",
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
  private readonly logger = new Logger(VenueChinChinPanelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceTokensService: DeviceTokensService,
    private readonly configService: ConfigService,
  ) {}

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
      where: {
        ...(normalizedCity
          ? {
              city: {
                equals: normalizedCity,
                mode: "insensitive",
              },
            }
          : {}),
        spaceLayoutProjects: {
          some: {
            status: SpaceLayoutStatus.APPROVED,
          },
        },
      },
      include: {
        chinChinPanel: true,
        spaceLayoutProjects: {
          where: { status: SpaceLayoutStatus.APPROVED },
          orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }],
          take: 1,
          select: {
            photos: true,
            space: true,
            savedLayout: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    const visibleVenues = venues.filter(
      (venue) =>
        venue.isChinChinPanelListed &&
        this.hasPublicPanelTableSelection(
          venue.advanceChinChinTableIds,
          venue.spaceLayoutProjects,
        ),
    );

    return {
      city: normalizedCity || null,
      count: visibleVenues.length,
      venues: visibleVenues.map((venue) => {
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
          livePricingBoost: this.normalizeLivePricingBoost(
            venue.livePricingBoost,
          ),
          liveChinChinTableIds: isLive ? liveChinChinTableIds : [],
          reservationWindowStartMinutes: venue.reservationWindowStartMinutes,
          reservationWindowEndMinutes: venue.reservationWindowEndMinutes,
          profile: this.serializeVenueProfile(venue),
          panel: venue.chinChinPanel
            ? this.serializePanel({
                ...venue.chinChinPanel,
                venue: {
                  id: venue.id,
                  name: venue.name,
                  slug: venue.slug,
                  country: venue.country,
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
        spaceLayoutProjects: {
          some: {
            status: SpaceLayoutStatus.APPROVED,
          },
        },
      },
      include: {
        chinChinPanel: true,
        spaceLayoutProjects: {
          where: { status: SpaceLayoutStatus.APPROVED },
          orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }],
          take: 1,
          select: {
            photos: true,
            space: true,
            savedLayout: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
      take: 100,
    });

    const eventVenues = venues
      .filter(
        (venue) =>
          venue.isChinChinPanelListed &&
          this.hasPublicPanelTableSelection(
            venue.advanceChinChinTableIds,
            venue.spaceLayoutProjects,
          ),
      )
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
            country: venue.country,
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
          livePricingBoost: this.normalizeLivePricingBoost(
            venue.livePricingBoost,
          ),
          liveChinChinTableIds: isLive ? liveChinChinTableIds : [],
          reservationWindowStartMinutes: venue.reservationWindowStartMinutes,
          reservationWindowEndMinutes: venue.reservationWindowEndMinutes,
          profile: this.serializeVenueProfile(venue),
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

  async getFollowStatus(userId: string, venueId: string) {
    await this.ensureVenueExists(venueId);

    const follower = await this.prisma.venueFollower.findUnique({
      where: {
        userId_venueId: {
          userId,
          venueId,
        },
      },
    });

    return {
      venueId,
      isFollowing: follower !== null,
      followedAt: follower?.createdAt.toISOString() ?? null,
    };
  }

  async followVenue(userId: string, venueId: string) {
    await this.ensureVenueExists(venueId);

    const follower = await this.prisma.venueFollower.upsert({
      where: {
        userId_venueId: {
          userId,
          venueId,
        },
      },
      create: {
        userId,
        venueId,
      },
      update: {},
    });

    return {
      venueId,
      isFollowing: true,
      followedAt: follower.createdAt.toISOString(),
    };
  }

  async unfollowVenue(userId: string, venueId: string) {
    await this.ensureVenueExists(venueId);

    await this.prisma.venueFollower.deleteMany({
      where: {
        userId,
        venueId,
      },
    });

    return {
      venueId,
      isFollowing: false,
      followedAt: null,
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

    const currency = this.currencyForCountry(venue.country);
    const promotionalDrinkInputs = dto.promotionalDrinks
      .map((drink) => this.parsePanelDrinkInput(drink, currency))
      .filter((drink): drink is DrinkPanelInput => drink !== null)
      .slice(0, 12);
    if (!promotionalDrinkInputs.length) {
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
      promotionalDrinkInputs,
      "OTHER",
    );
    const draftBeers = await this.normalizeDrinks(
      draftBeerNames.map((name) => ({ name })),
      "DRAFT_BEER",
    );
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
    const previousPanel = await this.prisma.venueChinChinPanel.findUnique({
      where: { venueId },
      select: {
        hasEvent: true,
        events: true,
        eventDay: true,
        eventStartsAt: true,
        eventBand: true,
        eventContent: true,
        eventDescription: true,
      },
    });
    const previousEvents = previousPanel
      ? this.extractStoredEventsForNotification(previousPanel)
      : [];

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

    await this.scheduleNotificationsForAddedEvents(
      panel.venueId,
      panel.venue.name,
      previousEvents,
      events,
    );

    return this.serializePanel(panel);
  }

  async runScheduledEventNotifications() {
    const dueNotifications = await this.prisma.venueEventNotification.findMany({
      where: {
        sentAt: null,
        skippedAt: null,
        scheduledFor: {
          lte: new Date(),
        },
      },
      orderBy: {
        scheduledFor: "asc",
      },
      take: 25,
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            followers: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
    });

    let processed = 0;

    for (const notification of dueNotifications) {
      const followerUserIds = [
        ...new Set(
          notification.venue.followers.map((follower) => follower.userId),
        ),
      ];

      if (!followerUserIds.length) {
        this.logger.log(
          `[push][customer] event notification skipped notificationId=${notification.id} venueId=${notification.venueId} eventId=${notification.eventId}: no followers`,
        );
        await this.prisma.venueEventNotification.update({
          where: { id: notification.id },
          data: { skippedAt: new Date() },
        });
        processed += 1;
        continue;
      }

      const body = this.eventNotificationBody({
        venueName: notification.venue.name,
        eventName: notification.eventName,
        day: notification.eventDay,
        startsAt: notification.eventStartsAt,
      });

      this.logger.log(
        `[push][customer] sending event notificationId=${notification.id} venueId=${notification.venueId} eventId=${notification.eventId} followerCount=${followerUserIds.length} title=Novi event u ${notification.venue.name}`,
      );

      for (const userId of followerUserIds) {
        const result = await this.deviceTokensService.sendToUser({
          userId,
          app: DevicePushApp.CUSTOMER,
          title: `Novi event u ${notification.venue.name}`,
          body,
          data: {
            type: "VENUE_EVENT_CREATED",
            venueId: notification.venueId,
            eventId: notification.eventId,
          },
        });
        this.logger.log(
          `[push][customer] result event notificationId=${notification.id} venueId=${notification.venueId} eventId=${notification.eventId} userId=${userId} result=${JSON.stringify(result)}`,
        );
      }

      await this.prisma.venueEventNotification.update({
        where: { id: notification.id },
        data: { sentAt: new Date() },
      });
      processed += 1;
    }

    return processed;
  }

  private serializeVenueProfile(venue: {
    name: string;
    profileDescription?: string | null;
    profileImages?: Prisma.JsonValue;
    spaceLayoutProjects?: Array<{
      photos: Prisma.JsonValue;
      space: Prisma.JsonValue;
    }>;
  }) {
    const configuredImages = this.serializeVenueProfileImages(
      venue.profileImages,
    );
    const fallbackImages = configuredImages.length
      ? []
      : this.extractProfileImagesFromLayoutProjects(
          venue.spaceLayoutProjects ?? [],
        );
    const images = (configuredImages.length ? configuredImages : fallbackImages)
      .slice(0, 8)
      .map((image, index) => ({
        ...image,
        isPrimary: index === 0,
      }));
    const description = venue.profileDescription?.trim();

    return {
      description:
        description ||
        `${venue.name} je Chin-Chin kafić za društvo, izlazak i rezervaciju stola bez čekanja. Odaberi stol, pošalji zahtjev i dođi spreman za večer.`,
      images,
    };
  }

  private serializeVenueProfileImages(value: Prisma.JsonValue | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }

    return this.collectProfileImages(value);
  }

  private extractProfileImagesFromLayoutProjects(
    projects: Array<{ photos: Prisma.JsonValue; space: Prisma.JsonValue }>,
  ) {
    const result: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      dataUrl: string | null;
      remoteUrl: string | null;
      caption: string | null;
    }> = [];

    for (const project of projects) {
      result.push(
        ...this.collectProfileImagesFromSpace(project.space),
        ...this.collectProfileImages(project.photos),
      );
    }

    const seen = new Set<string>();
    return result.filter((image) => {
      const key =
        image.remoteUrl || image.dataUrl || `${image.fileName}-${image.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private collectProfileImagesFromSpace(value: Prisma.JsonValue) {
    const result: ReturnType<typeof this.collectProfileImages> = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return result;
    }

    const space = value as Record<string, unknown>;
    result.push(...this.collectProfileImages(space.venuePhotos));

    const rooms = Array.isArray(space.rooms) ? space.rooms : [];
    for (const room of rooms) {
      if (!room || typeof room !== "object" || Array.isArray(room)) {
        continue;
      }
      result.push(
        ...this.collectProfileImages((room as Record<string, unknown>).photos),
      );
    }

    return result;
  }

  private collectProfileImages(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }

        const image = entry as Record<string, unknown>;
        const dataUrl =
          typeof image.dataUrl === "string" && image.dataUrl.trim()
            ? image.dataUrl.trim()
            : null;
        const remoteUrl =
          typeof image.remoteUrl === "string" && image.remoteUrl.trim()
            ? image.remoteUrl.trim()
            : null;
        if (!dataUrl && !remoteUrl) {
          return null;
        }

        const id =
          typeof image.id === "string" && image.id.trim()
            ? image.id.trim()
            : `venue-profile-image-${index + 1}`;
        const fileName =
          typeof image.fileName === "string" && image.fileName.trim()
            ? image.fileName.trim()
            : `venue-profile-${index + 1}.jpg`;
        const mimeType =
          typeof image.mimeType === "string" && image.mimeType.trim()
            ? image.mimeType.trim()
            : "image/jpeg";
        const caption =
          typeof image.caption === "string" && image.caption.trim()
            ? image.caption.trim()
            : null;

        return {
          id,
          fileName,
          mimeType,
          dataUrl,
          remoteUrl,
          caption,
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          id: string;
          fileName: string;
          mimeType: string;
          dataUrl: string | null;
          remoteUrl: string | null;
          caption: string | null;
        } => entry !== null,
      );
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
      country?: string | null;
    };
    currency?: string;
  }) {
    const currency =
      panel.currency || this.currencyForCountry(panel.venue.country);
    const events = this.serializePanelEvents(panel.events);
    const hasModernEventList = Array.isArray(panel.events);
    const fallbackEvent =
      !hasModernEventList &&
      !events.length &&
      panel.eventDay &&
      panel.eventStartsAt &&
      panel.eventBand
        ? [
            {
              id: this.createEventId(
                panel.eventDay,
                panel.eventStartsAt,
                "23:00",
                panel.eventBand,
              ),
              day: panel.eventDay,
              startsAt: panel.eventStartsAt,
              endsAt: "23:00",
              band: panel.eventBand,
              eventName: panel.eventBand,
              content:
                this.serializeContent(panel.eventContent) ??
                this.normalizeContentFromSeed(panel.eventBand, "EVENT"),
              description: panel.eventDescription,
              posterDataUrl: null,
            },
          ]
        : [];
    const visibleEvents = events.length ? events : fallbackEvent;
    const displayEvent = this.pickDisplayEvent(visibleEvents);

    return {
      id: panel.id,
      venueId: panel.venueId,
      venue: panel.venue,
      currency,
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

    return !liveEndedAt;
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
          promoPriceLabel:
            item.promoPriceLabel?.toString().trim() ||
            item.priceLabel?.toString().trim() ||
            null,
          promoSizeLabel: item.promoSizeLabel?.toString().trim() || null,
        };
      })
      .filter((entry): entry is NormalizedDrink => entry !== null);
  }

  private parsePanelDrinkInput(
    value: unknown,
    currency: string,
  ): DrinkPanelInput | null {
    if (typeof value === "string") {
      const name = value.trim();
      return name ? { name } : null;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const item = value as Record<string, unknown>;
    const name = item.name?.toString().trim() || "";
    if (!name) {
      return null;
    }

    const rawPrice =
      item.promoPriceLabel?.toString().trim() ||
      item.priceLabel?.toString().trim() ||
      item.price?.toString().trim() ||
      "";
    const promoPriceLabel = rawPrice
      ? this.formatPromoPriceLabel(rawPrice, currency)
      : null;
    const rawSize = item.promoSizeLabel?.toString().trim() || "";
    const promoSizeLabel = rawSize ? rawSize.slice(0, 40) : null;
    return { name, promoPriceLabel, promoSizeLabel };
  }

  private formatPromoPriceLabel(rawPrice: string, currency: string) {
    const value = rawPrice.trim().replace(/\s+/g, " ").slice(0, 32);
    if (!value) {
      return null;
    }

    const normalizedCurrency = currency.toUpperCase();
    const hasCurrency =
      value.toUpperCase().includes(normalizedCurrency) ||
      /[€$£]|CHF|BAM|RSD|USD|GBP/i.test(value);
    return hasCurrency ? value : `${value} ${normalizedCurrency}`;
  }

  private currencyForCountry(country?: string | null) {
    const normalized = country?.trim().toUpperCase();
    const currenciesByCountry: Record<string, string> = {
      HR: "EUR",
      DE: "EUR",
      AT: "EUR",
      SI: "EUR",
      IT: "EUR",
      FR: "EUR",
      ES: "EUR",
      NL: "EUR",
      BE: "EUR",
      IE: "EUR",
      PT: "EUR",
      FI: "EUR",
      SK: "EUR",
      EE: "EUR",
      LV: "EUR",
      LT: "EUR",
      GR: "EUR",
      CY: "EUR",
      LU: "EUR",
      MT: "EUR",
      CH: "CHF",
      LI: "CHF",
      GB: "GBP",
      UK: "GBP",
      US: "USD",
      BA: "BAM",
      RS: "RSD",
    };
    return currenciesByCountry[normalized ?? ""] ?? "EUR";
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
        const endsAt = item.endsAt?.toString().trim() || "23:00";
        const band = item.band?.toString().trim() || "";
        const eventName = item.eventName?.toString().trim() || band;
        const posterDataUrl = item.posterDataUrl?.toString().trim() || null;
        const content = this.serializeContent(
          (item.content ?? null) as Prisma.JsonValue | null,
        );
        if (!day || !startsAt || !band || !content) {
          return null;
        }

        return {
          id:
            item.id?.toString() ||
            this.createEventId(
              day,
              startsAt,
              endsAt,
              content.contentKey ?? band,
            ),
          day,
          startsAt,
          endsAt,
          band,
          eventName,
          content,
          description: item.description?.toString() || null,
          posterDataUrl,
        };
      })
      .filter((entry): entry is NormalizedPanelEvent => entry !== null);
  }

  private extractStoredEventsForNotification(panel: {
    hasEvent: boolean;
    events: Prisma.JsonValue | null;
    eventDay: string | null;
    eventStartsAt: string | null;
    eventBand: string | null;
    eventContent: Prisma.JsonValue | null;
    eventDescription: string | null;
  }) {
    if (!panel.hasEvent) {
      return [];
    }

    const events = this.serializePanelEvents(panel.events);
    if (events.length) {
      return events;
    }

    if (!panel.eventDay || !panel.eventStartsAt || !panel.eventBand) {
      return [];
    }

    const content =
      this.serializeContent(panel.eventContent) ??
      this.normalizeContentFromSeed(panel.eventBand, "EVENT");

    return [
      {
        id: this.createEventId(
          panel.eventDay,
          panel.eventStartsAt,
          "23:00",
          content.contentKey ?? panel.eventBand,
        ),
        day: panel.eventDay,
        startsAt: panel.eventStartsAt,
        endsAt: "23:00",
        band: panel.eventBand,
        eventName: panel.eventBand,
        content,
        description: panel.eventDescription,
        posterDataUrl: null,
      },
    ];
  }

  private async scheduleNotificationsForAddedEvents(
    venueId: string,
    venueName: string,
    previousEvents: NormalizedPanelEvent[],
    currentEvents: NormalizedPanelEvent[],
  ) {
    const delayMs = this.eventPushDelayMs();
    const scheduledFor = new Date(Date.now() + delayMs);
    const previousIds = new Set(previousEvents.map((event) => event.id));
    const currentIds = new Set(currentEvents.map((event) => event.id));
    const pendingNotifications =
      await this.prisma.venueEventNotification.findMany({
        where: {
          venueId,
          sentAt: null,
          skippedAt: null,
        },
        orderBy: { createdAt: "asc" },
      });
    const pendingByEventId = new Map(
      pendingNotifications.map((notification) => [
        notification.eventId,
        notification,
      ]),
    );
    const rescheduledEditEventIds = new Set<string>();

    if (
      previousEvents.length === currentEvents.length &&
      previousEvents.length > 0
    ) {
      for (let index = 0; index < previousEvents.length; index += 1) {
        const previousEvent = previousEvents[index];
        const currentEvent = currentEvents[index];
        if (!currentEvent || previousEvent.id === currentEvent.id) {
          continue;
        }

        const pendingNotification = pendingByEventId.get(previousEvent.id);
        if (
          !pendingNotification ||
          pendingByEventId.has(currentEvent.id) ||
          rescheduledEditEventIds.has(currentEvent.id)
        ) {
          continue;
        }
        const existingCurrentNotification =
          await this.prisma.venueEventNotification.findUnique({
            where: {
              venueId_eventId: {
                venueId,
                eventId: currentEvent.id,
              },
            },
          });
        if (
          existingCurrentNotification &&
          existingCurrentNotification.id !== pendingNotification.id
        ) {
          continue;
        }

        await this.prisma.venueEventNotification.update({
          where: { id: pendingNotification.id },
          data: {
            eventId: currentEvent.id,
            eventName: currentEvent.eventName,
            eventDay: currentEvent.day,
            eventStartsAt: currentEvent.startsAt,
            eventEndsAt: currentEvent.endsAt,
          },
        });
        pendingByEventId.delete(previousEvent.id);
        pendingByEventId.set(currentEvent.id, {
          ...pendingNotification,
          eventId: currentEvent.id,
          eventName: currentEvent.eventName,
          eventDay: currentEvent.day,
          eventStartsAt: currentEvent.startsAt,
          eventEndsAt: currentEvent.endsAt,
        });
        rescheduledEditEventIds.add(currentEvent.id);
        this.logger.log(
          `[push][customer] updated pending event notification venueId=${venueId} venue=${venueName} oldEventId=${previousEvent.id} eventId=${currentEvent.id} scheduledFor=${pendingNotification.scheduledFor.toISOString()}`,
        );
      }
    }

    const deletedPendingNotifications = Array.from(
      pendingByEventId.values(),
    ).filter((notification) => !currentIds.has(notification.eventId));
    if (deletedPendingNotifications.length) {
      await this.prisma.venueEventNotification.updateMany({
        where: {
          id: {
            in: deletedPendingNotifications.map(
              (notification) => notification.id,
            ),
          },
        },
        data: { skippedAt: new Date() },
      });
      this.logger.log(
        `[push][customer] skipped ${deletedPendingNotifications.length} pending event notification(s) venueId=${venueId} venue=${venueName}: event removed before scheduled send`,
      );
    }

    let scheduledCount = 0;
    let refreshedPendingCount = 0;
    for (const event of currentEvents) {
      const pendingNotification = pendingByEventId.get(event.id);
      if (pendingNotification) {
        await this.prisma.venueEventNotification.update({
          where: { id: pendingNotification.id },
          data: {
            eventName: event.eventName,
            eventDay: event.day,
            eventStartsAt: event.startsAt,
            eventEndsAt: event.endsAt,
          },
        });
        refreshedPendingCount += 1;
        continue;
      }

      if (previousIds.has(event.id) || rescheduledEditEventIds.has(event.id)) {
        continue;
      }

      const existingNotification =
        await this.prisma.venueEventNotification.findUnique({
          where: {
            venueId_eventId: {
              venueId,
              eventId: event.id,
            },
          },
        });
      if (existingNotification?.sentAt) {
        continue;
      }

      if (existingNotification) {
        await this.prisma.venueEventNotification.update({
          where: { id: existingNotification.id },
          data: {
            eventName: event.eventName,
            eventDay: event.day,
            eventStartsAt: event.startsAt,
            eventEndsAt: event.endsAt,
            scheduledFor,
            skippedAt: null,
          },
        });
      } else {
        await this.prisma.venueEventNotification.create({
          data: {
            venueId,
            eventId: event.id,
            eventName: event.eventName,
            eventDay: event.day,
            eventStartsAt: event.startsAt,
            eventEndsAt: event.endsAt,
            scheduledFor,
          },
        });
      }
      scheduledCount += 1;
    }

    if (scheduledCount > 0) {
      this.logger.log(
        `[push][customer] scheduled ${scheduledCount} event notification(s) venueId=${venueId} venue=${venueName} scheduledFor=${scheduledFor.toISOString()}`,
      );
    }
    if (refreshedPendingCount > 0) {
      this.logger.log(
        `[push][customer] refreshed ${refreshedPendingCount} pending event notification(s) venueId=${venueId} venue=${venueName}`,
      );
    }

    if (delayMs <= 0 && scheduledCount > 0) {
      void this.runScheduledEventNotifications().catch((error) => {
        this.logger.error(
          `[push][customer] immediate event notification dispatch failed venueId=${venueId}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }
  }

  private eventPushDelayMs() {
    const configuredHours = Number(
      this.configService.get<string>("VENUE_EVENT_PUSH_DELAY_HOURS"),
    );
    const delayHours =
      Number.isFinite(configuredHours) && configuredHours >= 0
        ? configuredHours
        : 2;
    return delayHours * 60 * 60 * 1000;
  }

  private eventNotificationBody(event: {
    venueName: string;
    eventName: string;
    day: string;
    startsAt: string;
  }) {
    const date = this.formatEventNotificationDate(event.day);
    return `${event.eventName} u ${event.venueName}, ${date} u ${event.startsAt}.`;
  }

  private formatEventNotificationDate(day: string) {
    const date = new Date(`${day}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return day;
    }

    return new Intl.DateTimeFormat("hr-HR", {
      timeZone: "Europe/Zagreb",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  private collectEventInputs(dto: UpsertVenueChinChinPanelDto) {
    const events = Array.isArray(dto.events) ? dto.events : [];
    const eventInputs = events
      .map((event) => ({
        day: event.day?.trim() ?? "",
        startsAt: event.startsAt?.trim() ?? "",
        endsAt: event.endsAt?.trim() ?? "23:00",
        contentName: event.contentName?.trim() ?? "",
        eventName: event.eventName?.trim() || event.contentName?.trim() || "",
        description: event.description?.trim() || null,
        posterDataUrl: event.posterDataUrl?.trim() || null,
      }))
      .filter(
        (event) =>
          event.day && event.startsAt && event.endsAt && event.contentName,
      );

    if (eventInputs.length) {
      return eventInputs;
    }

    const singleEvent = {
      day: dto.eventDay?.trim() ?? "",
      startsAt: dto.eventStartsAt?.trim() ?? "",
      endsAt: dto.eventEndsAt?.trim() ?? "23:00",
      contentName: (dto.eventContentName ?? dto.eventBand ?? "").trim(),
      eventName: (dto.eventContentName ?? dto.eventBand ?? "").trim(),
      description: dto.eventDescription?.trim() || null,
      posterDataUrl: null,
    };

    return singleEvent.day &&
      singleEvent.startsAt &&
      singleEvent.endsAt &&
      singleEvent.contentName
      ? [singleEvent]
      : [];
  }

  private async ensureVenueExists(venueId: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }
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
        event.endsAt,
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
        endsAt: event.endsAt,
        band: content.name,
        eventName: event.eventName || content.name,
        content,
        description: event.description,
        posterDataUrl: event.posterDataUrl,
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

    const now = Date.now();
    const maxVisibleStart = now + 7 * 24 * 60 * 60 * 1000;
    const visibleEvents = events.filter(
      (event) =>
        this.eventEndTimestamp(event) >= now &&
        this.eventTimestamp(event) <= maxVisibleStart,
    );
    if (!visibleEvents.length) {
      return null;
    }

    const todayKey = this.formatDateKey(new Date());
    const todaysEvents = visibleEvents
      .filter((event) => event.day === todayKey)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    if (todaysEvents.length) {
      return todaysEvents[0];
    }

    const futureEvents = visibleEvents
      .filter((event) => this.eventTimestamp(event) >= now)
      .sort(
        (left, right) => this.eventTimestamp(left) - this.eventTimestamp(right),
      );
    return futureEvents[0] ?? visibleEvents[0];
  }

  private async normalizeDrinks(
    drinks: DrinkPanelInput[],
    fallbackType: NormalizedDrink["type"],
  ): Promise<NormalizedDrink[]> {
    const brands = await this.loadDrinkBrands();

    return drinks.map((drink) => ({
      ...this.normalizeDrinkFromBrands(drink.name, fallbackType, brands),
      promoPriceLabel: drink.promoPriceLabel ?? null,
      promoSizeLabel: drink.promoSizeLabel ?? null,
    }));
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
      promoPriceLabel: null,
      promoSizeLabel: null,
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

  private createEventId(
    day: string,
    startsAt: string,
    endsAt: string,
    name: string,
  ) {
    return this.normalizeText(`${day}-${startsAt}-${endsAt}-${name}`).replace(
      /\s+/g,
      "-",
    );
  }

  private eventTimestamp(event: { day: string; startsAt: string }) {
    const timestamp = new Date(`${event.day}T${event.startsAt}:00`).getTime();
    return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
  }

  private eventEndTimestamp(event: {
    day: string;
    startsAt: string;
    endsAt: string;
  }) {
    const timestamp = new Date(`${event.day}T${event.endsAt}:00`).getTime();
    if (Number.isNaN(timestamp)) {
      return Number.MAX_SAFE_INTEGER;
    }

    const startMinutes = this.eventClockMinutes(event.startsAt);
    const endMinutes = this.eventClockMinutes(event.endsAt);
    if (
      startMinutes !== null &&
      endMinutes !== null &&
      endMinutes <= startMinutes
    ) {
      return timestamp + 24 * 60 * 60 * 1000;
    }

    return timestamp;
  }

  private eventClockMinutes(value: string) {
    const [hours, minutes] = value.split(":").map(Number);
    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    return hours * 60 + minutes;
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

  private hasPublicPanelTableSelection(
    value: Prisma.JsonValue | null | undefined,
    projects: Array<{ savedLayout?: Prisma.JsonValue | null }>,
  ) {
    const minimumTableCount =
      this.minimumPublicTableSelectionForProjects(projects);
    return this.jsonStringArray(value).length >= minimumTableCount;
  }

  private minimumPublicTableSelectionForProjects(
    projects: Array<{ savedLayout?: Prisma.JsonValue | null }>,
  ) {
    const project = projects[0];
    const savedLayout = this.asJsonObject(project?.savedLayout ?? null);
    const layout = this.asJsonObject(savedLayout?.layout ?? null);
    const rooms = Array.isArray(layout?.rooms) ? layout.rooms : [];
    const allowedTableCount = rooms.reduce<number>((total, room) => {
      if (!room || typeof room !== "object" || Array.isArray(room)) {
        return total;
      }

      const roomMap = room as Record<string, unknown>;
      const tables = Array.isArray(roomMap.tables) ? roomMap.tables : [];
      const ratio = roomMap.isTemporarySpace === true ? 0.5 : 0.4;
      return total + Math.max(1, Math.floor(tables.length * ratio));
    }, 0);

    return Math.max(
      1,
      Math.round(allowedTableCount * MIN_PUBLIC_SELECTION_ALLOWED_RATIO),
    );
  }

  private asJsonObject(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private normalizeLivePricingBoost(value: unknown) {
    const boost = value?.toString().trim().toUpperCase();
    return boost === "X2" || boost === "X3" ? boost : "X1";
  }
}

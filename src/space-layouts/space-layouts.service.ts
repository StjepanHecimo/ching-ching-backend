import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { SpaceLayoutStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSpaceLayoutDto } from "./dto/create-space-layout.dto";
import { SaveSpaceLayoutDto } from "./dto/save-space-layout.dto";
import { SpaceShapeDto } from "./dto/space-shape.dto";
import {
  ReviewSpaceLayoutDto,
  SubmitSpaceLayoutReviewDto,
} from "./dto/submit-space-layout-review.dto";

type LayoutTable = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  seats: number;
  minPartySize: number;
  maxPartySize: number;
  reservable: boolean;
  rotation: number;
  shape: "round" | "rectangle";
};

@Injectable()
export class SpaceLayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSpaceLayoutDto) {
    await this.ensureVenueOwnership(userId, dto.venueId);
    this.ensureUsablePhotoReferences(dto.photos);
    this.ensureUsableSpace(dto.space);

    const project = await this.prisma.spaceLayoutProject.create({
      data: {
        ownerId: userId,
        venueId: dto.venueId,
        name: dto.name?.trim(),
        photos: dto.photos.map((photo) => ({
          fileName: photo.fileName.trim(),
          mimeType: photo.mimeType,
          dataUrl: photo.dataUrl,
          remoteUrl: photo.remoteUrl,
        })) as Prisma.InputJsonValue,
        space: this.normalizeSpace(dto.space) as Prisma.InputJsonValue,
      },
      include: {
        venue: true,
      },
    });

    return this.serializeProject(project);
  }

  async list(userId: string, venueId?: string) {
    if (venueId) {
      await this.ensureVenueOwnership(userId, venueId);
    }

    const projects = await this.prisma.spaceLayoutProject.findMany({
      where: {
        ownerId: userId,
        venueId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        venue: true,
      },
    });

    return projects.map((project) => this.serializeProject(project));
  }

  async get(userId: string, id: string) {
    const project = await this.findOwnedProject(userId, id);

    return this.serializeProject(project);
  }

  async generateSuggestion(userId: string, id: string) {
    const project = await this.findOwnedProject(userId, id);
    const suggestion = this.createStubSuggestion(project.space);

    const updatedProject = await this.prisma.spaceLayoutProject.update({
      where: { id },
      data: {
        status: SpaceLayoutStatus.AI_SUGGESTED,
        aiSuggestion: suggestion as Prisma.InputJsonValue,
      },
      include: {
        venue: true,
      },
    });

    return this.serializeProject(updatedProject);
  }

  async saveLayout(userId: string, id: string, dto: SaveSpaceLayoutDto) {
    await this.findOwnedProject(userId, id);
    this.ensureUsableRenderedImage(dto);

    const updatedProject = await this.prisma.spaceLayoutProject.update({
      where: { id },
      data: {
        status: SpaceLayoutStatus.SAVED,
        savedLayout: {
          selectedLayoutOptionId: dto.selectedLayoutOptionId,
          editedBy: dto.editedBy ?? "flutter-editor",
          layout: dto.layout,
          renderedImage: dto.renderedImage,
          savedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
      include: {
        venue: true,
      },
    });

    return this.serializeProject(updatedProject);
  }

  async submitForReview(
    userId: string,
    id: string,
    dto: SubmitSpaceLayoutReviewDto,
  ) {
    const project = await this.findOwnedProject(userId, id);

    if (!project.savedLayout) {
      throw new BadRequestException(
        "Save the final layout before submitting it for Chin-Chin review.",
      );
    }

    const updatedProject = await this.prisma.spaceLayoutProject.update({
      where: { id },
      data: {
        status: SpaceLayoutStatus.PENDING_CHIN_CHIN_REVIEW,
        reviewSubmission: {
          topDrinks: dto.topDrinks.map((drink) => drink.trim()),
          musicType: dto.musicType.trim(),
          themeTags: dto.themeTags.map((tag) =>
            tag.trim().replace(/^#/, "").toLowerCase(),
          ),
          servesFood: dto.servesFood,
          foodDescription: dto.foodDescription?.trim(),
          ownerNotes: dto.ownerNotes?.trim(),
          submittedAt: new Date().toISOString(),
          review: {
            status: "pending",
          },
        } as Prisma.InputJsonValue,
      },
      include: {
        venue: true,
      },
    });

    return {
      ...this.serializeProject(updatedProject),
      message:
        "Layout submitted. It will become available after Chin-Chin team approval.",
    };
  }

  async review(userId: string, id: string, dto: ReviewSpaceLayoutDto) {
    const project = await this.findOwnedProject(userId, id);

    if (!project.reviewSubmission) {
      throw new BadRequestException(
        "Submit the layout for review before using the test review endpoint.",
      );
    }

    const approved = dto.decision === "approve";
    const updatedProject = await this.prisma.spaceLayoutProject.update({
      where: { id },
      data: {
        status: approved
          ? SpaceLayoutStatus.APPROVED
          : SpaceLayoutStatus.CHIN_CHIN_CHANGES_REQUESTED,
        approvedAt: approved ? new Date() : null,
        savedLayout: dto.adjustedLayout
          ? ({
              adjustedBy: "chin-chin-team",
              adjustedAt: new Date().toISOString(),
              layout: dto.adjustedLayout,
              previousSavedLayout: project.savedLayout,
            } as Prisma.InputJsonValue)
          : undefined,
        reviewSubmission: {
          ...(this.asJsonObject(project.reviewSubmission) ?? {}),
          review: {
            status: approved ? "approved" : "changes_requested",
            reviewedByUserId: userId,
            reviewNotes: dto.reviewNotes?.trim(),
            reviewedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
      include: {
        venue: true,
      },
    });

    return this.serializeProject(updatedProject);
  }

  private async ensureVenueOwnership(userId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: {
        id: venueId,
        ownerId: userId,
      },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found for this owner.");
    }

    return venue;
  }

  private async findOwnedProject(userId: string, id: string) {
    const project = await this.prisma.spaceLayoutProject.findFirst({
      where: {
        id,
        ownerId: userId,
      },
      include: {
        venue: true,
      },
    });

    if (!project) {
      throw new NotFoundException("Space layout project was not found.");
    }

    return project;
  }

  private ensureUsablePhotoReferences(photos: CreateSpaceLayoutDto["photos"]) {
    const invalidPhoto = photos.find(
      (photo) => !photo.dataUrl && !photo.remoteUrl,
    );

    if (invalidPhoto) {
      throw new BadRequestException(
        "Each photo must include either dataUrl or remoteUrl for the test flow.",
      );
    }
  }

  private ensureUsableSpace(space: SpaceShapeDto) {
    const hasDimensions = Boolean(space.widthMeters && space.lengthMeters);
    const hasOutline = Boolean(space.outline && space.outline.length >= 4);

    if (!hasDimensions && !hasOutline) {
      throw new BadRequestException(
        "Provide approximate width/length or a custom outline with at least 4 points.",
      );
    }
  }

  private ensureUsableRenderedImage(dto: SaveSpaceLayoutDto) {
    if (!dto.renderedImage) {
      return;
    }

    if (!dto.renderedImage.dataUrl && !dto.renderedImage.remoteUrl) {
      throw new BadRequestException(
        "Rendered image must include either dataUrl or remoteUrl.",
      );
    }
  }

  private asJsonObject(value: Prisma.JsonValue) {
    if (typeof value !== "object" || !value || Array.isArray(value)) {
      return null;
    }

    return value;
  }

  private normalizeSpace(space: SpaceShapeDto) {
    return {
      roomLabel: space.roomLabel?.trim() ?? "Prostorija A",
      requestedTableCount: space.requestedTableCount,
      shapeType: space.shapeType ?? (space.outline ? "custom" : "rectangle"),
      widthMeters: space.widthMeters,
      lengthMeters: space.lengthMeters,
      outline: space.outline,
    };
  }

  private createStubSuggestion(spaceJson: Prisma.JsonValue) {
    const space = this.readSpaceDimensions(spaceJson);
    const compactTables = this.createTableGrid(space, "compact");
    const comfortableTables = this.createTableGrid(space, "comfortable");

    return {
      version: 1,
      source: "stub-ai",
      units: "meters",
      room: {
        label: space.roomLabel,
        requestedTableCount: space.requestedTableCount,
      },
      canvas: {
        width: space.widthMeters,
        length: space.lengthMeters,
      },
      layoutOptions: [
        {
          id: "layout-a",
          label: "Nacrt A",
          strategy: "compact-capacity",
          zones: this.createZones(space, "left-service"),
          tables: compactTables,
          summary: {
            tableCount: compactTables.length,
            seats: compactTables.reduce(
              (total, table) => total + table.seats,
              0,
            ),
          },
        },
        {
          id: "layout-b",
          label: "Nacrt B",
          strategy: "comfortable-service-path",
          zones: this.createZones(space, "center-service"),
          tables: comfortableTables,
          summary: {
            tableCount: comfortableTables.length,
            seats: comfortableTables.reduce(
              (total, table) => total + table.seats,
              0,
            ),
          },
        },
      ],
      notes: [
        "Test suggestion generated without OpenAI. Later this can be replaced by a hybrid JSON + vision OpenAI flow.",
      ],
    };
  }

  private createZones(
    space: ReturnType<typeof this.readSpaceDimensions>,
    strategy: "left-service" | "center-service",
  ) {
    const serviceWidth = Math.min(1.4, space.widthMeters);

    if (strategy === "center-service") {
      return [
        {
          id: "zone-seating-left",
          label: `${space.roomLabel} - lijevo`,
          type: "seating",
          x: 0,
          y: 0,
          width: this.round((space.widthMeters - serviceWidth) / 2),
          height: space.lengthMeters,
        },
        {
          id: "zone-service-center",
          label: "Glavni prolaz",
          type: "service",
          x: this.round((space.widthMeters - serviceWidth) / 2),
          y: 0,
          width: serviceWidth,
          height: space.lengthMeters,
        },
        {
          id: "zone-seating-right",
          label: `${space.roomLabel} - desno`,
          type: "seating",
          x: this.round((space.widthMeters + serviceWidth) / 2),
          y: 0,
          width: this.round((space.widthMeters - serviceWidth) / 2),
          height: space.lengthMeters,
        },
      ];
    }

    return [
      {
        id: "zone-service-left",
        label: "Servisni prolaz",
        type: "service",
        x: 0,
        y: 0,
        width: serviceWidth,
        height: space.lengthMeters,
      },
      {
        id: "zone-main-seating",
        label: space.roomLabel,
        type: "seating",
        x: serviceWidth,
        y: 0,
        width: this.round(space.widthMeters - serviceWidth),
        height: space.lengthMeters,
      },
    ];
  }

  private createTableGrid(
    space: ReturnType<typeof this.readSpaceDimensions>,
    density: "compact" | "comfortable",
  ) {
    const requestedCount =
      space.requestedTableCount ??
      Math.floor((space.widthMeters * space.lengthMeters) / 7);
    const tableCount = Math.min(40, Math.max(1, requestedCount));
    const columns =
      density === "compact"
        ? Math.ceil(Math.sqrt(tableCount))
        : Math.max(1, Math.ceil(Math.sqrt(tableCount) - 1));
    const rows = Math.ceil(tableCount / columns);
    const leftPadding =
      density === "compact" ? Math.min(1.4, space.widthMeters) : 0.6;
    const usableWidth = Math.max(1, space.widthMeters - leftPadding - 0.4);
    const xGap = usableWidth / (columns + 1);
    const yGap = space.lengthMeters / (rows + 1);

    return Array.from({ length: tableCount }, (_, index): LayoutTable => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const seats = index % 3 === 0 ? 2 : index % 3 === 1 ? 4 : 6;
      const shape = seats <= 4 ? "round" : "rectangle";

      return {
        id: `table-${density}-${index + 1}`,
        label: `S${index + 1}`,
        x: this.round(leftPadding + (column + 1) * xGap),
        y: this.round((row + 1) * yGap),
        width: shape === "round" ? 0.9 : 1.3,
        height: shape === "round" ? 0.9 : 0.9,
        seats,
        minPartySize: 1,
        maxPartySize: seats,
        reservable: true,
        rotation: density === "comfortable" && row % 2 === 1 ? 90 : 0,
        shape,
      };
    });
  }

  private readSpaceDimensions(spaceJson: Prisma.JsonValue) {
    if (
      typeof spaceJson !== "object" ||
      !spaceJson ||
      Array.isArray(spaceJson)
    ) {
      return {
        roomLabel: "Prostorija A",
        requestedTableCount: undefined,
        widthMeters: 10,
        lengthMeters: 8,
      };
    }

    const roomLabel =
      typeof spaceJson.roomLabel === "string"
        ? spaceJson.roomLabel
        : "Prostorija A";
    const requestedTableCount =
      typeof spaceJson.requestedTableCount === "number"
        ? spaceJson.requestedTableCount
        : undefined;
    const widthMeters =
      typeof spaceJson.widthMeters === "number" ? spaceJson.widthMeters : 10;
    const lengthMeters =
      typeof spaceJson.lengthMeters === "number" ? spaceJson.lengthMeters : 8;

    return { roomLabel, requestedTableCount, widthMeters, lengthMeters };
  }

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }

  private serializeProject(project: {
    id: string;
    venueId: string;
    name: string | null;
    status: SpaceLayoutStatus;
    photos: Prisma.JsonValue;
    space: Prisma.JsonValue;
    aiSuggestion: Prisma.JsonValue | null;
    savedLayout: Prisma.JsonValue | null;
    reviewSubmission: Prisma.JsonValue | null;
    approvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    venue: {
      id: string;
      name: string;
      slug: string;
    };
  }) {
    return {
      id: project.id,
      venueId: project.venueId,
      venue: project.venue,
      name: project.name,
      status: project.status,
      photos: project.photos,
      space: project.space,
      aiSuggestion: project.aiSuggestion,
      savedLayout: project.savedLayout,
      reviewSubmission: project.reviewSubmission,
      approvedAt: project.approvedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }
}

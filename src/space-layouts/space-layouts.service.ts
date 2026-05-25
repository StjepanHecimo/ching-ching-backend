import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma/client";
import { SpaceLayoutStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { ApproveAdjustedLayoutPreviewDto } from "./dto/approve-adjusted-layout-preview.dto";
import { CreateSpaceLayoutDto } from "./dto/create-space-layout.dto";
import { GenerateSpaceLayoutPreviewDto } from "./dto/generate-space-layout-preview.dto";
import { LayoutPhotoDto } from "./dto/layout-photo.dto";
import { LayoutReferenceFileDto } from "./dto/layout-reference-file.dto";
import { RequestTableAdditionPreviewDto } from "./dto/request-table-addition-preview.dto";
import { RequestSpaceChangePreviewDto } from "./dto/request-space-change-preview.dto";
import { SaveSpaceLayoutDto } from "./dto/save-space-layout.dto";
import { SpaceShapeDto } from "./dto/space-shape.dto";
import { SubmitCompleteSpaceLayoutReviewDto } from "./dto/submit-complete-space-layout-review.dto";
import {
  ReviewSpaceLayoutDto,
  SubmitSpaceLayoutReviewDto,
} from "./dto/submit-space-layout-review.dto";

type LayoutTable = {
  id: string;
  label: string;
  tableRole: "CHIN_CHIN_TABLE" | "ORDINARY_TABLE";
  chinChinTier?: "STANDARD" | "LARGE";
  tablePhotoId: string;
  tablePhotoStatus: "APPROVED_WITH_PHOTO" | "MISSING_PHOTO" | "NOT_REQUIRED";
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
  chinChinCandidate: boolean;
};

@Injectable()
export class SpaceLayoutsService {
  private readonly logger = new Logger(SpaceLayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(userId: string, dto: CreateSpaceLayoutDto) {
    await this.ensureVenueOwnership(userId, dto.venueId);
    const normalizedSpace = this.normalizeSetupSpace(dto);
    this.ensureUsableSetupPhotos(dto, normalizedSpace.rooms.length);
    this.ensureUsableVenuePhotos(dto.venuePhotos);
    this.ensureUsableFloorPlanFile(dto.floorPlanFile);
    this.ensureUsableSpace(normalizedSpace.primaryRoom);

    const project = await this.prisma.spaceLayoutProject.create({
      data: {
        ownerId: userId,
        venueId: dto.venueId,
        name: dto.name?.trim(),
        photos: this.normalizeGlobalPhotos(dto) as Prisma.InputJsonValue,
        space: normalizedSpace as Prisma.InputJsonValue,
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

  async generatePreview(dto: GenerateSpaceLayoutPreviewDto) {
    const normalizedSpace = this.normalizeSetupSpace(dto);
    this.ensureUsableSetupPhotos(dto, normalizedSpace.rooms.length);
    this.ensureUsableVenuePhotos(dto.venuePhotos);
    this.ensureUsableFloorPlanFile(dto.floorPlanFile);
    this.ensureUsableSpace(normalizedSpace.primaryRoom);

    return this.createSuggestion(normalizedSpace as Prisma.JsonValue);
  }

  async generateSuggestion(userId: string, id: string) {
    const project = await this.findOwnedProject(userId, id);
    const suggestion = await this.createSuggestion(project.space);

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

  private async createSuggestion(space: Prisma.JsonValue) {
    return this.configService.get<string>("SPACE_LAYOUT_AI_PROVIDER") ===
      "openai"
      ? this.createOpenAiSuggestion(space)
      : this.createStubSuggestion(space);
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
        reviewSubmission: this.createReviewSubmission(dto),
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

  async submitCompleteForReview(
    userId: string,
    dto: SubmitCompleteSpaceLayoutReviewDto,
  ) {
    await this.ensureVenueOwnership(userId, dto.venueId);
    const normalizedSpace = this.normalizeSetupSpace(dto);
    this.ensureUsableSetupPhotos(dto, normalizedSpace.rooms.length);
    this.ensureUsableVenuePhotos(dto.venuePhotos);
    this.ensureUsableFloorPlanFile(dto.floorPlanFile);
    this.ensureUsableSpace(normalizedSpace.primaryRoom);
    this.ensureUsableRenderedImage(dto);

    const now = new Date().toISOString();
    console.log("[space-layouts] submitCompleteForReview", {
      venueId: dto.venueId,
      changeRequestType: dto.changeRequestType ?? null,
      roomCount: Array.isArray(dto.layout?.rooms)
        ? dto.layout.rooms.length
        : null,
    });
    const project = await this.prisma.spaceLayoutProject.create({
      data: {
        ownerId: userId,
        venueId: dto.venueId,
        name: dto.name?.trim(),
        status: SpaceLayoutStatus.PENDING_CHIN_CHIN_REVIEW,
        photos: this.normalizeGlobalPhotos(dto) as Prisma.InputJsonValue,
        space: normalizedSpace as Prisma.InputJsonValue,
        aiSuggestion: dto.aiSuggestion as Prisma.InputJsonValue,
        savedLayout: {
          selectedLayoutOptionId: dto.selectedLayoutOptionId,
          editedBy: dto.editedBy ?? "flutter-editor",
          layout: dto.layout,
          renderedImage: dto.renderedImage,
          savedAt: now,
          ...(dto.changeRequestType
            ? { changeRequestType: dto.changeRequestType }
            : {}),
        } as Prisma.InputJsonValue,
        reviewSubmission: this.createReviewSubmission(dto, now),
      },
      include: {
        venue: true,
      },
    });

    console.log("[space-layouts] created review project", {
      projectId: project.id,
      venueId: project.venueId,
      status: project.status,
      changeRequestType: dto.changeRequestType ?? null,
    });

    return {
      ...this.serializeProject(project),
      message:
        "Complete layout package submitted. Chin-Chin team can now review and adjust it before approval.",
    };
  }

  async submitCompletePreviewForReview(
    dto: SubmitCompleteSpaceLayoutReviewDto,
  ) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: dto.venueId },
      select: { ownerId: true },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    return this.submitCompleteForReview(venue.ownerId, dto);
  }

  async getLatestVenueProjectPreview(venueId: string) {
    const project = await this.prisma.spaceLayoutProject.findFirst({
      where: { venueId },
      orderBy: { updatedAt: "desc" },
      include: { venue: true },
    });

    if (!project) {
      throw new NotFoundException("Space layout project was not found.");
    }

    return this.serializeProject(project);
  }

  async getLatestApprovedVenueProjectPreview(venueId: string) {
    const project = await this.prisma.spaceLayoutProject.findFirst({
      where: { venueId, status: SpaceLayoutStatus.APPROVED },
      orderBy: { approvedAt: "desc" },
      include: { venue: true },
    });

    if (!project) {
      throw new NotFoundException(
        "Approved space layout project was not found.",
      );
    }

    console.log("[space-layouts] latest-approved lookup", {
      venueId,
      projectId: project.id,
      approvedAt: project.approvedAt?.toISOString(),
    });

    return this.serializeProject(
      await this.withMergedAdditionalRoomFallback(project),
    );
  }

  async listReviewQueuePreview() {
    const projects = await this.prisma.spaceLayoutProject.findMany({
      where: { status: SpaceLayoutStatus.PENDING_CHIN_CHIN_REVIEW },
      orderBy: { updatedAt: "desc" },
      take: 25,
      include: { venue: true },
    });

    return projects.map((project) => this.serializeProject(project));
  }

  async requestTableAdditionPreview(
    venueId: string,
    dto: RequestTableAdditionPreviewDto,
  ) {
    const sourceProject =
      (await this.prisma.spaceLayoutProject.findFirst({
        where: { venueId, status: SpaceLayoutStatus.APPROVED },
        orderBy: { approvedAt: "desc" },
        include: { venue: true },
      })) ??
      (await this.prisma.spaceLayoutProject.findFirst({
        where: { venueId },
        orderBy: { updatedAt: "desc" },
        include: { venue: true },
      }));

    if (!sourceProject) {
      throw new NotFoundException("Space layout project was not found.");
    }

    const sourceSavedLayout = this.asJsonObject(sourceProject.savedLayout);
    const sourceLayout = this.asJsonObject(sourceSavedLayout?.layout ?? null);
    if (!sourceLayout) {
      throw new BadRequestException(
        "Approved layout is required before requesting a table addition.",
      );
    }

    const photo = this.normalizePhoto(
      dto.photo,
      `change-request-${dto.tableId}-photo`,
    );
    const updatedLayout = this.markTableAsChinChinCandidate(
      sourceLayout,
      dto.tableId,
      photo.id,
      dto.chinChinTier ?? "STANDARD",
    );
    const now = new Date().toISOString();
    const photos = Array.isArray(sourceProject.photos)
      ? [...sourceProject.photos, photo]
      : [photo];

    const project = await this.prisma.spaceLayoutProject.create({
      data: {
        ownerId: sourceProject.ownerId,
        venueId: sourceProject.venueId,
        name: `${sourceProject.name ?? sourceProject.venue.name} - table change request`,
        status: SpaceLayoutStatus.PENDING_CHIN_CHIN_REVIEW,
        photos: photos as Prisma.InputJsonValue,
        space: sourceProject.space as Prisma.InputJsonValue,
        aiSuggestion: sourceProject.aiSuggestion as Prisma.InputJsonValue,
        savedLayout: {
          ...(sourceSavedLayout ?? {}),
          selectedLayoutOptionId:
            updatedLayout.id?.toString() ??
            sourceSavedLayout?.selectedLayoutOptionId?.toString(),
          editedBy: "flutter-editor",
          changeRequestType: "ADD_CHIN_CHIN_TABLE",
          requestedTableId: dto.tableId,
          requestedTablePhotoId: photo.id,
          requestedChinChinTier: dto.chinChinTier ?? "STANDARD",
          ownerNotes: dto.ownerNotes?.trim(),
          layout: updatedLayout,
          sourceProjectId: sourceProject.id,
          requestedAt: now,
        } as Prisma.InputJsonValue,
        reviewSubmission: {
          submittedAt: now,
          ownerNotes: dto.ownerNotes?.trim(),
          review: { status: "pending" },
          changeRequest: {
            type: "ADD_CHIN_CHIN_TABLE",
            sourceProjectId: sourceProject.id,
            tableId: dto.tableId,
            tablePhotoId: photo.id,
            chinChinTier: dto.chinChinTier ?? "STANDARD",
            requestedAt: now,
          },
        } as Prisma.InputJsonValue,
      },
      include: { venue: true },
    });

    return {
      ...this.serializeProject(project),
      message: "Table change request submitted for Chin-Chin review.",
    };
  }

  async requestSpaceChangePreview(
    venueId: string,
    dto: RequestSpaceChangePreviewDto,
  ) {
    const sourceProject =
      (await this.prisma.spaceLayoutProject.findFirst({
        where: { venueId, status: SpaceLayoutStatus.APPROVED },
        orderBy: { approvedAt: "desc" },
        include: { venue: true },
      })) ??
      (await this.prisma.spaceLayoutProject.findFirst({
        where: { venueId },
        orderBy: { updatedAt: "desc" },
        include: { venue: true },
      }));

    if (!sourceProject) {
      throw new NotFoundException("Space layout project was not found.");
    }

    const sourceSavedLayout = this.asJsonObject(sourceProject.savedLayout);
    const sourceLayout = this.asJsonObject(sourceSavedLayout?.layout ?? null);
    if (!sourceLayout) {
      throw new BadRequestException(
        "Approved layout is required before requesting a space change.",
      );
    }

    this.ensureSpaceChangeTarget(sourceLayout, dto);

    const now = new Date().toISOString();
    const attachments = (dto.attachments ?? []).map((photo, index) =>
      this.normalizePhoto(
        photo,
        `space-change-${dto.type.toLowerCase()}-${index + 1}`,
      ),
    );
    const sourceSpace = this.asJsonObject(sourceProject.space) ?? {};
    const originalFloorPlan =
      this.asJsonObject(sourceSpace.floorPlanFile as Prisma.JsonValue | null) ??
      this.asJsonObject(
        (this.asJsonObject(sourceProject.reviewSubmission)?.floorPlanFile ??
          null) as Prisma.JsonValue | null,
      );

    const project = await this.prisma.spaceLayoutProject.create({
      data: {
        ownerId: sourceProject.ownerId,
        venueId: sourceProject.venueId,
        name: `${sourceProject.name ?? sourceProject.venue.name} - ${dto.type.toLowerCase()} request`,
        status: SpaceLayoutStatus.PENDING_CHIN_CHIN_REVIEW,
        photos: sourceProject.photos as Prisma.InputJsonValue,
        space: {
          ...sourceSpace,
          originalFloorPlan,
          changeAttachments: attachments,
        } as Prisma.InputJsonValue,
        aiSuggestion: sourceProject.aiSuggestion as Prisma.InputJsonValue,
        savedLayout: {
          ...(sourceSavedLayout ?? {}),
          selectedLayoutOptionId:
            sourceLayout.id?.toString() ??
            sourceSavedLayout?.selectedLayoutOptionId?.toString(),
          editedBy: "flutter-editor",
          changeRequestType: dto.type,
          requestedRoomLabel: dto.roomLabel?.trim(),
          ownerNotes: dto.ownerNotes?.trim(),
          remodelLevel: dto.remodelLevel?.trim(),
          layout: sourceLayout,
          sourceProjectId: sourceProject.id,
          requestedAt: now,
        } as Prisma.InputJsonValue,
        reviewSubmission: {
          submittedAt: now,
          ownerNotes: dto.ownerNotes?.trim(),
          review: { status: "pending" },
          changeRequest: {
            type: dto.type,
            sourceProjectId: sourceProject.id,
            roomLabel: dto.roomLabel?.trim(),
            remodelLevel: dto.remodelLevel?.trim(),
            attachments,
            originalFloorPlan,
            requestedAt: now,
          },
        } as Prisma.InputJsonValue,
      },
      include: { venue: true },
    });

    return {
      ...this.serializeProject(project),
      message: "Space change request submitted for Chin-Chin review.",
    };
  }

  async approveAdjustedLayoutPreview(
    id: string,
    dto: ApproveAdjustedLayoutPreviewDto,
  ) {
    const project = await this.prisma.spaceLayoutProject.findUnique({
      where: { id },
      include: { venue: true },
    });

    if (!project) {
      throw new NotFoundException("Space layout project was not found.");
    }

    const now = new Date().toISOString();
    const previousSavedLayout =
      this.asJsonObject(project.savedLayout) ?? ({} as Record<string, unknown>);
    const layoutId =
      dto.layout.id?.toString() ??
      previousSavedLayout.selectedLayoutOptionId?.toString();
    const reviewSubmission = this.asJsonObject(project.reviewSubmission) ?? {};
    const changeRequest = this.asJsonObject(
      reviewSubmission.changeRequest as Prisma.JsonValue | null,
    );
    const isAdditionalRoomRequest =
      changeRequest?.type === "ADD_ROOM" ||
      previousSavedLayout.changeRequestType === "ADD_ROOM";
    const isDeleteRoomRequest =
      changeRequest?.type === "DELETE_ROOM" ||
      previousSavedLayout.changeRequestType === "DELETE_ROOM";
    console.log("[space-layouts] approveAdjustedLayoutPreview", {
      projectId: project.id,
      venueId: project.venueId,
      changeRequestType:
        changeRequest?.type ?? previousSavedLayout.changeRequestType ?? null,
      isAdditionalRoomRequest,
      isDeleteRoomRequest,
      incomingRoomCount: Array.isArray(dto.layout?.rooms)
        ? dto.layout.rooms.length
        : null,
    });
    const layoutForApproval = isAdditionalRoomRequest
      ? await this.mergeAdditionalRoomLayout(
          project.venueId,
          project.id,
          dto.layout,
        )
      : isDeleteRoomRequest
        ? this.removeRequestedRoomFromLayout(
            dto.layout,
            changeRequest?.roomLabel?.toString() ??
              previousSavedLayout.requestedRoomLabel?.toString(),
          )
        : dto.layout;

    const adjustedBy = dto.adjustedBy?.trim() || "chin-chin-admin-panel";
    const versionedSavedLayout = this.createApprovedSavedLayoutVersion({
      previousSavedLayout,
      layout: layoutForApproval,
      layoutId,
      adjustedBy,
      approvedAt: now,
      previousStatus: project.status,
    });

    const updatedProject = await this.prisma.spaceLayoutProject.update({
      where: { id },
      data: {
        status: SpaceLayoutStatus.APPROVED,
        approvedAt: new Date(now),
        savedLayout: versionedSavedLayout as Prisma.InputJsonValue,
        reviewSubmission: {
          ...reviewSubmission,
          review: {
            status: "approved",
            reviewedByUserId: "admin-preview",
            reviewNotes:
              dto.reviewNotes?.trim() ||
              "Approved from Chin-Chin admin panel preview endpoint.",
            reviewedAt: now,
          },
        } as Prisma.InputJsonValue,
      },
      include: { venue: true },
    });

    return this.serializeProject(updatedProject);
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

  private ensureUsablePhotoReferences(photos: LayoutPhotoDto[]) {
    const invalidPhoto = photos.find(
      (photo) => !photo.dataUrl && !photo.remoteUrl,
    );

    if (invalidPhoto) {
      throw new BadRequestException(
        "Each Chin-Chin table photo must include either dataUrl or remoteUrl.",
      );
    }
  }

  private ensureUsableVenuePhotos(venuePhotos?: LayoutPhotoDto[]) {
    if (!venuePhotos?.length) {
      return;
    }

    if (venuePhotos.length !== 4) {
      throw new BadRequestException("Provide exactly 4 venue space photos.");
    }

    this.ensureUsablePhotoReferences(venuePhotos);
  }

  private ensureUsableFloorPlanFile(floorPlanFile?: LayoutReferenceFileDto) {
    if (!floorPlanFile) {
      throw new BadRequestException(
        "Floor plan, sketch, or PDF file is required before AI layout generation.",
      );
    }

    if (!floorPlanFile.dataUrl && !floorPlanFile.remoteUrl) {
      throw new BadRequestException(
        "Floor plan file must include either dataUrl or remoteUrl.",
      );
    }
  }

  private ensureUsableSetupPhotos(
    dto: {
      rooms?: SpaceShapeDto[];
      space?: SpaceShapeDto;
      photos?: LayoutPhotoDto[];
    },
    normalizedRoomCount: number,
  ) {
    const rooms = dto.rooms?.length ? dto.rooms : dto.space ? [dto.space] : [];

    if (dto.photos?.length) {
      const maxGlobalPhotos = this.maxAllowedChinChinPhotos(rooms);
      if (dto.photos.length > maxGlobalPhotos) {
        throw new BadRequestException(
          `Provide at most ${maxGlobalPhotos} Chin-Chin table photo(s) for the selected tables.`,
        );
      }

      this.ensureUsablePhotoReferences(dto.photos);
      return;
    }

    const roomsWithPhotos = rooms.filter((room) => room.photos?.length);

    if (roomsWithPhotos.length !== normalizedRoomCount) {
      throw new BadRequestException(
        "Provide at least one Chin-Chin table photo globally or at least one table photo for each room.",
      );
    }

    for (const room of roomsWithPhotos) {
      const allowedPhotos = this.maxAllowedChinChinPhotos([room]);
      const roomPhotoCount = room.photos?.length ?? 0;

      if (roomPhotoCount > allowedPhotos) {
        throw new BadRequestException(
          `${room.roomLabel ?? "Room"} can include at most ${allowedPhotos} Chin-Chin table photo(s).`,
        );
      }

      this.ensureUsablePhotoReferences(room.photos ?? []);
    }
  }

  private maxAllowedChinChinPhotos(rooms: SpaceShapeDto[]) {
    const totalAllowed = rooms.reduce((total, room) => {
      const requestedTableCount = room.requestedTableCount ?? 0;
      return total + Math.max(1, Math.floor(requestedTableCount / 4));
    }, 0);

    return Math.max(1, totalAllowed);
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

  private ensureUsableRenderedImage(dto: {
    renderedImage?: { dataUrl?: string; remoteUrl?: string };
  }) {
    if (!dto.renderedImage) {
      return;
    }

    if (!dto.renderedImage.dataUrl && !dto.renderedImage.remoteUrl) {
      throw new BadRequestException(
        "Rendered image must include either dataUrl or remoteUrl.",
      );
    }
  }

  private normalizeSetupSpace(dto: {
    rooms?: SpaceShapeDto[];
    space?: SpaceShapeDto;
    floorPlanFile?: LayoutReferenceFileDto;
    venuePhotos?: LayoutPhotoDto[];
  }) {
    const rooms = dto.rooms?.length ? dto.rooms : dto.space ? [dto.space] : [];

    if (!rooms.length) {
      throw new BadRequestException(
        "Provide at least one room through rooms[] or a single space object.",
      );
    }

    const normalizedRooms = rooms.map((room, index) =>
      this.normalizeSpace(room, index),
    );

    return {
      primaryRoom: normalizedRooms[0],
      rooms: normalizedRooms,
      venuePhotos: dto.venuePhotos?.length
        ? dto.venuePhotos.map((photo, index) =>
            this.normalizePhoto(photo, `venue-photo-${index + 1}`),
          )
        : [],
      ...(dto.floorPlanFile
        ? { floorPlanFile: this.normalizeReferenceFile(dto.floorPlanFile) }
        : {}),
    };
  }

  private normalizeGlobalPhotos(dto: { photos?: LayoutPhotoDto[] }) {
    if (!dto.photos?.length) {
      return [];
    }

    return dto.photos.map((photo, index) =>
      this.normalizePhoto(photo, `chin-chin-photo-${index + 1}`),
    );
  }

  private normalizePhoto(photo: LayoutPhotoDto, fallbackId?: string) {
    return {
      id: photo.id?.trim() || fallbackId || this.photoIdFromFileName(photo),
      fileName: photo.fileName.trim(),
      mimeType: photo.mimeType,
      dataUrl: photo.dataUrl,
      remoteUrl: photo.remoteUrl,
    };
  }

  private normalizeReferenceFile(file: LayoutReferenceFileDto) {
    return {
      fileName: file.fileName.trim(),
      mimeType: file.mimeType,
      dataUrl: file.dataUrl,
      remoteUrl: file.remoteUrl,
    };
  }

  private asJsonObject(value: Prisma.JsonValue) {
    if (typeof value !== "object" || !value || Array.isArray(value)) {
      return null;
    }

    return value;
  }

  private markTableAsChinChinCandidate(
    layout: Record<string, unknown>,
    tableId: string,
    photoId: string,
    chinChinTier: "STANDARD" | "LARGE",
  ) {
    const clonedLayout = JSON.parse(JSON.stringify(layout)) as Record<
      string,
      unknown
    >;
    const rooms = Array.isArray(clonedLayout.rooms) ? clonedLayout.rooms : [];
    let updated = false;

    for (const room of rooms) {
      if (typeof room !== "object" || !room || Array.isArray(room)) {
        continue;
      }

      const roomMap = room as Record<string, unknown>;
      const tables = Array.isArray(roomMap.tables) ? roomMap.tables : [];
      for (const table of tables) {
        if (typeof table !== "object" || !table || Array.isArray(table)) {
          continue;
        }

        const tableMap = table as Record<string, unknown>;
        if (tableMap.id?.toString() !== tableId) {
          continue;
        }

        tableMap.tableRole = "CHIN_CHIN_TABLE";
        tableMap.chinChinTier = chinChinTier;
        tableMap.chinChinCandidate = true;
        tableMap.tablePhotoId = photoId;
        tableMap.tablePhotoStatus = "APPROVED_WITH_PHOTO";
        if (chinChinTier === "LARGE") {
          tableMap.seats = Math.max(this.numberFrom(tableMap.seats, 6), 6);
          tableMap.maxPartySize = Math.max(
            this.numberFrom(tableMap.maxPartySize, 6),
            6,
          );
          tableMap.minPartySize = Math.min(
            this.numberFrom(tableMap.minPartySize, 2),
            2,
          );
        } else {
          tableMap.maxPartySize = Math.min(
            this.numberFrom(tableMap.maxPartySize, 4),
            4,
          );
          tableMap.minPartySize = Math.min(
            this.numberFrom(tableMap.minPartySize, 2),
            2,
          );
        }
        updated = true;
      }
    }

    if (!updated) {
      throw new BadRequestException(
        `Table ${tableId} was not found in the approved layout.`,
      );
    }

    const summary = this.asJsonObject(
      clonedLayout.summary as Prisma.JsonValue | null,
    );
    if (summary) {
      const chinChinCount = rooms.reduce((count, room) => {
        if (typeof room !== "object" || !room || Array.isArray(room)) {
          return count;
        }
        const tables = Array.isArray((room as Record<string, unknown>).tables)
          ? ((room as Record<string, unknown>).tables as unknown[])
          : [];
        return (
          count +
          tables.filter(
            (table) =>
              typeof table === "object" &&
              table !== null &&
              !Array.isArray(table) &&
              ((table as Record<string, unknown>).tableRole ===
                "CHIN_CHIN_TABLE" ||
                (table as Record<string, unknown>).chinChinCandidate === true),
          ).length
        );
      }, 0);
      summary.chinChinCandidateCount = chinChinCount;
    }

    return clonedLayout;
  }

  private ensureSpaceChangeTarget(
    layout: Record<string, unknown>,
    dto: RequestSpaceChangePreviewDto,
  ) {
    if (dto.type !== "DELETE_ROOM") {
      return;
    }

    const roomLabel = dto.roomLabel?.trim();
    if (!roomLabel) {
      throw new BadRequestException(
        "Room label is required for room deletion requests.",
      );
    }

    const rooms = Array.isArray(layout.rooms) ? layout.rooms : [];
    const found = rooms.some((room) => {
      if (typeof room !== "object" || !room || Array.isArray(room)) {
        return false;
      }
      return (
        (room as Record<string, unknown>).roomLabel?.toString().trim() ===
        roomLabel
      );
    });

    if (!found) {
      throw new BadRequestException(
        "Room was not found in the approved layout.",
      );
    }
  }

  private removeRequestedRoomFromLayout(
    layout: Record<string, unknown>,
    roomLabel?: string,
  ) {
    const label = roomLabel?.trim();
    if (!label) {
      throw new BadRequestException(
        "Room label is required for approving room deletion.",
      );
    }

    const clonedLayout = JSON.parse(JSON.stringify(layout)) as Record<
      string,
      unknown
    >;
    const rooms = Array.isArray(clonedLayout.rooms) ? clonedLayout.rooms : [];
    const nextRooms = rooms.filter((room) => {
      if (typeof room !== "object" || !room || Array.isArray(room)) {
        return true;
      }
      return (
        (room as Record<string, unknown>).roomLabel?.toString().trim() !== label
      );
    });

    if (nextRooms.length === rooms.length) {
      return clonedLayout;
    }

    clonedLayout.rooms = nextRooms;
    clonedLayout.summary = this.recalculateLayoutSummary(clonedLayout);
    return clonedLayout;
  }

  private createApprovedSavedLayoutVersion({
    previousSavedLayout,
    layout,
    layoutId,
    adjustedBy,
    approvedAt,
    previousStatus,
  }: {
    previousSavedLayout: Record<string, unknown>;
    layout: Record<string, unknown>;
    layoutId?: string;
    adjustedBy: string;
    approvedAt: string;
    previousStatus: SpaceLayoutStatus;
  }) {
    const existingHistory = Array.isArray(previousSavedLayout.versionHistory)
      ? previousSavedLayout.versionHistory.filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" &&
            entry !== null &&
            !Array.isArray(entry),
        )
      : [];
    const nextVersion = existingHistory.length + 1;
    const versionEntry = {
      version: nextVersion,
      status: SpaceLayoutStatus.APPROVED,
      previousStatus,
      selectedLayoutOptionId: layoutId,
      editedBy: "admin",
      adjustedBy,
      adjustedAt: approvedAt,
      approvedAt,
      layout,
    };

    return {
      ...previousSavedLayout,
      selectedLayoutOptionId: layoutId,
      editedBy: "admin",
      adjustedBy,
      adjustedAt: approvedAt,
      approvedAt,
      layoutVersion: nextVersion,
      layout,
      versionHistory: [...existingHistory, versionEntry],
    };
  }

  private async mergeAdditionalRoomLayout(
    venueId: string,
    currentProjectId: string,
    additionalLayout: Record<string, unknown>,
  ) {
    const approvedProject = await this.prisma.spaceLayoutProject.findFirst({
      where: {
        venueId,
        status: SpaceLayoutStatus.APPROVED,
        id: { not: currentProjectId },
      },
      orderBy: { approvedAt: "desc" },
    });
    const approvedSavedLayout = this.asJsonObject(
      approvedProject?.savedLayout ?? null,
    );
    const approvedLayout = this.asJsonObject(
      approvedSavedLayout?.layout ?? null,
    );

    if (!approvedLayout) {
      console.log(
        "[space-layouts] mergeAdditionalRoomLayout no previous approved layout",
        {
          venueId,
          currentProjectId,
        },
      );
      return additionalLayout;
    }

    const existingRooms = Array.isArray(approvedLayout.rooms)
      ? approvedLayout.rooms
      : [];
    const incomingRooms = Array.isArray(additionalLayout.rooms)
      ? additionalLayout.rooms
      : [];
    if (!incomingRooms.length) {
      throw new BadRequestException("Additional room layout has no rooms.");
    }

    const existingLabels = new Set(
      existingRooms
        .map((room) =>
          typeof room === "object" && room && !Array.isArray(room)
            ? (room as Record<string, unknown>).roomLabel
                ?.toString()
                .trim()
                .toLowerCase()
            : "",
        )
        .filter(Boolean),
    );
    const duplicateRoom = incomingRooms.find((room) => {
      if (typeof room !== "object" || !room || Array.isArray(room)) {
        return false;
      }
      const label = (room as Record<string, unknown>).roomLabel
        ?.toString()
        .trim()
        .toLowerCase();
      return !!label && existingLabels.has(label);
    });
    if (duplicateRoom) {
      console.log(
        "[space-layouts] mergeAdditionalRoomLayout duplicate room label",
        {
          venueId,
          currentProjectId,
        },
      );
      throw new BadRequestException(
        "Room name already exists in approved layout.",
      );
    }

    console.log("[space-layouts] mergeAdditionalRoomLayout", {
      venueId,
      currentProjectId,
      previousApprovedProjectId: approvedProject?.id,
      existingRoomCount: existingRooms.length,
      incomingRoomCount: incomingRooms.length,
      mergedRoomCount: existingRooms.length + incomingRooms.length,
    });

    const mergedLayout = JSON.parse(JSON.stringify(approvedLayout)) as Record<
      string,
      unknown
    >;
    mergedLayout.rooms = [...existingRooms, ...incomingRooms];
    mergedLayout.summary = this.recalculateLayoutSummary(mergedLayout);
    mergedLayout.strategy = [
      approvedLayout.strategy?.toString(),
      additionalLayout.strategy?.toString(),
    ]
      .filter(Boolean)
      .join(" ");

    return mergedLayout;
  }

  private async withMergedAdditionalRoomFallback(project: {
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
    const savedLayout = this.asJsonObject(project.savedLayout);
    const layout = this.asJsonObject(savedLayout?.layout ?? null);
    const reviewSubmission = this.asJsonObject(project.reviewSubmission);
    const changeRequest = this.asJsonObject(
      reviewSubmission?.changeRequest ?? null,
    );
    const isAdditionalRoomRequest =
      changeRequest?.type === "ADD_ROOM" ||
      savedLayout?.changeRequestType === "ADD_ROOM";
    const roomCount = Array.isArray(layout?.rooms) ? layout.rooms.length : 0;

    console.log("[space-layouts] latest-approved fallback check", {
      projectId: project.id,
      venueId: project.venueId,
      changeRequestType:
        changeRequest?.type ?? savedLayout?.changeRequestType ?? null,
      isAdditionalRoomRequest,
      roomCount,
      willMergeFallback: isAdditionalRoomRequest && !!layout && roomCount <= 1,
    });

    if (!isAdditionalRoomRequest || !layout || roomCount > 1) {
      return project;
    }

    const mergedLayout = await this.mergeAdditionalRoomLayout(
      project.venueId,
      project.id,
      layout,
    );

    return {
      ...project,
      savedLayout: {
        ...(savedLayout ?? {}),
        layout: mergedLayout,
      } as Prisma.JsonValue,
    };
  }

  private recalculateLayoutSummary(layout: Record<string, unknown>) {
    const rooms = Array.isArray(layout.rooms) ? layout.rooms : [];
    let tableCount = 0;
    let seats = 0;
    let chinChinCandidateCount = 0;

    for (const room of rooms) {
      if (typeof room !== "object" || !room || Array.isArray(room)) {
        continue;
      }

      const tables = Array.isArray((room as Record<string, unknown>).tables)
        ? ((room as Record<string, unknown>).tables as unknown[])
        : [];
      tableCount += tables.length;
      for (const table of tables) {
        if (typeof table !== "object" || !table || Array.isArray(table)) {
          continue;
        }
        const tableMap = table as Record<string, unknown>;
        seats += typeof tableMap.seats === "number" ? tableMap.seats : 0;
        if (
          tableMap.tableRole === "CHIN_CHIN_TABLE" ||
          tableMap.chinChinCandidate === true
        ) {
          chinChinCandidateCount += 1;
        }
      }
    }

    return { seats, tableCount, chinChinCandidateCount };
  }

  private createReviewSubmission(
    dto: SubmitSpaceLayoutReviewDto | SubmitCompleteSpaceLayoutReviewDto,
    submittedAt = new Date().toISOString(),
  ) {
    const submission: Record<string, unknown> = {
      ownerNotes: dto.ownerNotes?.trim(),
      submittedAt,
      review: {
        status: "pending",
      },
    };

    if ("floorPlanFile" in dto && dto.floorPlanFile) {
      submission.floorPlanFile = this.normalizeReferenceFile(dto.floorPlanFile);
    }

    if ("changeRequestType" in dto && dto.changeRequestType) {
      submission.changeRequest = {
        type: dto.changeRequestType,
        requestedAt: submittedAt,
      };
    }

    return submission as Prisma.InputJsonValue;
  }

  private normalizeSpace(space: SpaceShapeDto, index = 0) {
    return {
      roomLabel:
        space.roomLabel?.trim() ??
        `Prostorija ${String.fromCharCode(65 + index)}`,
      requestedTableCount: space.requestedTableCount,
      shapeType: space.shapeType ?? (space.outline ? "custom" : "rectangle"),
      widthMeters: space.widthMeters,
      lengthMeters: space.lengthMeters,
      outline: space.outline,
      photos:
        space.photos?.map((photo, photoIndex) =>
          this.normalizePhoto(
            photo,
            `room-${index + 1}-chin-chin-photo-${photoIndex + 1}`,
          ),
        ) ?? [],
      features: {
        hasToilet: Boolean(space.features?.hasToilet),
        hasBar: Boolean(space.features?.hasBar),
        hasBilliardsOrDarts: Boolean(space.features?.hasBilliardsOrDarts),
        hasTv: Boolean(space.features?.hasTv),
        hasDjMusicCorner: Boolean(space.features?.hasDjMusicCorner),
        hasStairs: Boolean(space.features?.hasStairs),
        hasMainWalkway: Boolean(space.features?.hasMainWalkway),
      },
    };
  }

  private photoIdFromFileName(photo: LayoutPhotoDto) {
    const slug = photo.fileName
      .trim()
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    return slug ? `photo-${slug}` : "photo-reference";
  }

  private async createOpenAiSuggestion(spaceJson: Prisma.JsonValue) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");

    if (!apiKey) {
      throw new InternalServerErrorException(
        "OPENAI_API_KEY is required when SPACE_LAYOUT_AI_PROVIDER=openai.",
      );
    }

    const model =
      this.configService.get<string>("OPENAI_SPACE_LAYOUT_MODEL") ??
      this.configService.get<string>("OPENAI_MODEL") ??
      "gpt-4o-mini";

    const requestBody = this.createOpenAiLayoutRequest(model, spaceJson);
    const requestSummary = this.createOpenAiRequestSummary(
      spaceJson,
      requestBody,
    );
    this.logger.log(
      `OpenAI layout request: model=${model}, rooms=${requestSummary.roomCount}, floorPlanFile=${requestSummary.floorPlanFile}, chinChinTablePhotos=${requestSummary.chinChinTablePhotoCount}, tablePhotosSentToAi=false, imageDetail=${requestSummary.imageDetail}, promptChars=${requestSummary.promptChars}`,
    );

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseJson = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const message =
        this.readOpenAiErrorMessage(responseJson) ??
        "OpenAI layout generation failed.";
      this.logger.error(`OpenAI layout request failed: ${message}`);
      throw new InternalServerErrorException(message);
    }

    const outputText = this.extractOpenAiOutputText(responseJson);
    const parsed = this.parseOpenAiLayoutJson(outputText);
    const optionCount = Array.isArray(parsed.layoutOptions)
      ? parsed.layoutOptions.length
      : 0;
    this.logger.log(
      `OpenAI layout response: options=${optionCount}, outputChars=${outputText.length}`,
    );

    return {
      ...parsed,
      source: "openai",
      model,
    };
  }

  private createOpenAiRequestSummary(
    spaceJson: Prisma.JsonValue,
    requestBody: { input?: unknown },
  ) {
    const imageCount = this.extractRoomPhotos(spaceJson).length;
    const imageDetail =
      this.configService.get<string>("OPENAI_SPACE_LAYOUT_IMAGE_DETAIL") ??
      "high";

    return {
      chinChinTablePhotoCount: imageCount,
      floorPlanFile: this.extractFloorPlanFile(spaceJson)?.mimeType ?? "none",
      imageDetail,
      promptChars: this.countOpenAiTextInputChars(requestBody.input),
      roomCount: this.countRooms(spaceJson),
    };
  }

  private countOpenAiTextInputChars(input: unknown) {
    if (!Array.isArray(input)) {
      return 0;
    }

    let total = 0;

    for (const message of input) {
      if (
        typeof message !== "object" ||
        !message ||
        !("content" in message) ||
        !Array.isArray(message.content)
      ) {
        continue;
      }

      for (const contentItem of message.content) {
        if (
          typeof contentItem === "object" &&
          contentItem &&
          "type" in contentItem &&
          contentItem.type === "input_text" &&
          "text" in contentItem &&
          typeof contentItem.text === "string"
        ) {
          total += contentItem.text.length;
        }
      }
    }

    return total;
  }

  private countRooms(spaceJson: Prisma.JsonValue) {
    if (
      typeof spaceJson !== "object" ||
      !spaceJson ||
      Array.isArray(spaceJson)
    ) {
      return 0;
    }

    return Array.isArray(spaceJson.rooms) ? spaceJson.rooms.length : 0;
  }

  private createOpenAiLayoutRequest(
    model: string,
    spaceJson: Prisma.JsonValue,
  ) {
    const promptSpaceJson = this.createPromptSafeSpaceJson(spaceJson);
    const imageDetail =
      this.configService.get<string>("OPENAI_SPACE_LAYOUT_IMAGE_DETAIL") ??
      "high";
    const floorPlanFile = this.extractFloorPlanFile(spaceJson);
    const floorPlanContent = floorPlanFile
      ? [this.createOpenAiFloorPlanContent(floorPlanFile, imageDetail)]
      : [];

    return {
      model,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "You are Chin-Chin's cafe floor-plan generator. Return only valid JSON matching the schema. A floorPlanFile/sketch/PDF is attached and it is the primary visual source for room geometry, walls, openings, fixed objects, table positions, and spatial relationships. Use JSON dimensions and requested table count as hard constraints. Ignore screenshot/page whitespace, title blocks, external labels, and annotation arrows when creating geometry. Preserve the floor plan proportions: do not simplify the room to a rectangle when the plan has angled walls, cutouts, curved edges, columns, stairs, service areas, or irregular boundaries. Return a tight outline polygon for each room in the same meter coordinate system: min outline x/y should be near 0, max outline x/y should be near canvas width/length, and curved walls should be approximated with multiple points. Interpret visible circles and small square blocks as tables unless they are explicitly labelled as another object. Return conventional fixed objects such as columns, bars, toilets, stairs, doors, counters, passages, booth/separe dividers, and interior partition lines as fixtures, not as large seating/service rectangles. Rectangles with a written label are the object named by the label: sank/šank/bar is a bar, wc/toilet/toalet is a toilet, stepenice/stube/stairs/staircase is stairs, stup/kolona/column/pillar is column, ZID/zid/wall is a wall, and PROLAZ/prolaz is an open passage. A handwritten BAR or sank/šank label inside, touching, or just above a bottom rectangle is still a bar even if the label is faint, near the image edge, or partially cropped; do not discard it as an external label. If the sketch labels a fixed amenity, return it as a fixture: sank/šank/bar as bar, wc/toilet/toalet as toilet, stepenice/stube/stairs/staircase as stairs, stup/kolona/column/pillar as column, biljar/pool table as feature, and tv/television/televizor as feature with label TV. If the sketch labels ulaz, glavni ulaz, entrance, or main entrance, return a door or passage fixture at that exact entry location with label Main entrance; this fixture is an icon marker and must not block the passage. Zones are only semantic metadata for broad areas and should be sparse. The drawn lines are the most important source data. Preserve every visible hand-drawn architectural line segment as a straight fixture. Solid structural lines should use shape=line and type=wall. Dashed or dotted lines labelled or visually used as pregrada/partition/divider should use shape=line and type=partition so the frontend can render them as dashed partitions. Do not decide that a line is decorative or unimportant; every visible room boundary, divider, booth/separe line, internal separator, partition/pregrada, and counter edge must be returned as a line fixture in the same approximate position, length, angle, count, spacing, and start/end alignment as drawn. Use type=partition for dashed/dotted pregrada or partition lines; use type=wall for solid wall/boundary lines. Convert slightly wavy hand-drawn strokes into straight line fixtures that follow the stroke direction. Closed booth/separe boxes around a table must also be preserved as their visible wall line fixtures. Entrances, doors, and main passages must remain open; never invent a new closing line across an explicitly marked passage, but preserve the drawn wall lines around that passage exactly as shown. Croatian labels such as ulaz, glavni ulaz, main entrance, entrance, prolaz, PROLAZ, glavni prolaz, drugi dio, and arrows indicate access/continuation unless they are clearly labelled as walls. Every table must have a stable id. Use ids like room-a-table-1, room-a-table-2 in top-to-bottom then left-to-right visual order. Every table must have tableRole: CHIN_CHIN_TABLE for a plus-marked Chin-Chin table, otherwise ORDINARY_TABLE. Every table must include chinChinTier. Use chinChinTier=STANDARD for ordinary tables, standard plus-marked Chin-Chin tables, and any non-large table. For Chin-Chin table tiers, a plus sign (+) marks a STANDARD Chin-Chin table for up to four people. A square/box drawn inside a table circle marks a LARGE/premium Chin-Chin table for larger groups; set chinChinTier=LARGE and maxPartySize at least 6 for that table. Otherwise use chinChinTier=STANDARD for Chin-Chin tables and maxPartySize 4 unless the sketch clearly implies a larger table. Chin-Chin table photo image payloads are not sent to you, but JSON space data may include photos metadata with ids. Assign tablePhotoId only to plus-marked or square-in-circle Chin-Chin tables, using available room photo ids in the same top-to-bottom/left-to-right table order; set tablePhotoStatus=APPROVED_WITH_PHOTO when a photo id is assigned. Ordinary tables must always have tablePhotoId='' and tablePhotoStatus=NOT_REQUIRED. Never reuse one uploaded table photo id for multiple tables. If a marked Chin-Chin table has no available photo id, keep tableRole=CHIN_CHIN_TABLE and set tablePhotoStatus=MISSING_PHOTO. If a table is marked with a plus sign (+) on or inside the table shape, keep that plus-sign interpretation as the STANDARD Chin-Chin table marker and set chinChinCandidate=true for that table; the plus sign is source notation only and must not be returned as a fixture or table shape, and it must not be used as the table center if the visible table outline has a clearer center. If a table is marked with a small square/box inside the table shape, interpret it as a LARGE Chin-Chin table marker and set chinChinCandidate=true, tableRole=CHIN_CHIN_TABLE, chinChinTier=LARGE, and maxPartySize at least 6. Also accept other explicit Chin-Chin labels when they are directly attached to a table. Do not invent Chin-Chin tables. Tables must be separated from each other with visible clearance and must never overlap. Keep every table visually centered within its booth/separe cell or open seating area with clear distance from walls and partition lines; when a table is inside a separe/booth, center it inside that separe/booth cell. Never place a table center or table body on top of another table, a wall, room outline, partition, booth divider, column, bar, passage, or fixed fixture. If a table center is unclear, infer it as the center of the available free area around that table so spacing from nearby walls, dividers, and neighboring tables is balanced. If no Chin-Chin table markings are clear, set chinChinCandidate=false, tableRole=ORDINARY_TABLE, chinChinTier=STANDARD, tablePhotoId='', and tablePhotoStatus=NOT_REQUIRED for every table and explain that in notes. Coordinates are in meters from the top-left of the tight usable room outline, not from the full uploaded image/page.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Inspect the attached floor plan/sketch/PDF before generating the layout. Generate exactly one practical, editable cafe floor-plan option. First crop mentally to the actual floor-plan walls and ignore empty page margins. Then extract the usable public room outline from the plan: include angled walls, major cutouts, entry/stair/service bands, and curved facade edges approximated with 10-18 outline points where needed. The outline must follow the visible outer wall/usable boundary, not the rectangular bounding box of the image. Keep any visible entry or marked main passage open. Croatian labels like ulaz, glavni ulaz, main entrance, entrance, prolaz, PROLAZ, glavni prolaz, drugi dio, and arrows mean access/continuation and must not be converted into blocking walls. Next extract conventional fixed objects into fixtures: columns/pillars as small square or circular fixtures, bar/counter as rectangle fixtures, stairs as stair fixtures, toilet/service rooms as fixtures, passages/doors as opening fixtures, and every visible drawn line as a wall line fixture. Add a visible non-blocking door or passage fixture for any label ulaz, glavni ulaz, entrance, or main entrance, with label Main entrance, so the frontend can draw the entrance icon. Strictly interpret simple sketch symbols: circles are tables, small square blocks are tables, and rectangles with text labels are the object written on them. A rectangle labelled sank, šank, or bar is the bar; a rectangle labelled wc, toilet, or toalet is the toilet/WC; a rectangle or stair-like mark labelled stepenice, stube, stairs, or staircase is a stairs fixture; a small square/circle/filled block labelled stup, kolona, column, or pillar is a column fixture; a label ZID/zid/wall means wall; a label PROLAZ/prolaz means an open passage. Treat a faint or edge-adjacent handwritten BAR label at the bottom as belonging to the bottom rectangle; return that bottom rectangle as a bar fixture with label BAR, not as an unlabeled blocked/service area. If a hand-drawn sketch labels an amenity, add it as a fixture only when visible/labelled: sank/šank/bar as a bar fixture, wc/toilet/toalet as a toilet fixture, stepenice/stube/stairs/staircase as a stairs fixture, stup/kolona/column/pillar as a column fixture, biljar/pool table as a feature fixture labelled biljar, and tv/television/televizor as a feature fixture labelled TV. Lines are the highest priority visual data. Preserve every visible architectural hand-drawn line segment as its own straight fixture with shape=line, even when it is not labelled. Use type=wall for solid wall/boundary lines and type=partition for dashed/dotted pregrada, partition, or divider lines. Do not classify lines as decoration, helper strokes, or optional separators. Every drawn boundary/divider/separator line must be returned. Solid lines are wall fixtures; dashed/dotted pregrada/partition/divider lines are partition fixtures. Copy the line geometry as drawn: same approximate count, position, length, horizontal/vertical/angled direction, spacing, and start/end alignment. Convert slightly wavy hand-drawn strokes into straight lines following their main direction. Closed or partial boxes should be decomposed into their visible straight wall line segments. Do not replace line drawings with vague zones, broad rectangles, or simplified decorative lines. Do not model separe dividers as broad zones. Do not create large opaque rectangles over table grids just to represent seating/service areas. Never invent a new wall across a labelled path such as entrance, ulaz, glavni ulaz, main entrance, prolaz, PROLAZ, glavni prolaz, or drugi dio, but preserve all wall lines that are actually drawn around those paths. Then detect visible tables and align the output with requestedTableCount unless there is a physical conflict; if you reduce the count, explain why in notes. Every table must have a stable id like room-a-table-1 in visual reading order and a tableRole. Every table must include chinChinTier. Use chinChinTier=STANDARD for ordinary tables, standard plus-marked Chin-Chin tables, and any non-large table. A plus sign (+) drawn on or inside a table is the primary STANDARD Chin-Chin marker and this rule must stay active. A square/box drawn inside a table circle marks a LARGE premium Chin-Chin table for larger groups. For tables with a plus sign, set chinChinCandidate=true, tableRole=CHIN_CHIN_TABLE, chinChinTier=STANDARD, maxPartySize=4, and do not return the plus as a fixture; Flutter will render the usual crossed-glasses logo. For square-in-circle Chin-Chin tables, set chinChinCandidate=true, tableRole=CHIN_CHIN_TABLE, chinChinTier=LARGE, and maxPartySize at least 6. For all other tables set tableRole=ORDINARY_TABLE, chinChinTier=STANDARD, chinChinCandidate=false, tablePhotoId='', and tablePhotoStatus=NOT_REQUIRED. Use available room photos metadata only as photo id references: assign each marked Chin-Chin table one unique tablePhotoId from the room photos list in the same visual order and set tablePhotoStatus=APPROVED_WITH_PHOTO. If no photo id is available for a marked Chin-Chin table, set tablePhotoId='' and tablePhotoStatus=MISSING_PHOTO. Use the visible round/rectangular table outline to determine the table center, not the plus marker, square marker, or text label. In every area, place each table in the visual center of its own available free space/cell, with balanced clearance from all nearby walls, room outlines, columns, bars, fixed fixtures, booth dividers, partition lines, passages, and neighboring tables. Tables must be separated from one another and must never touch or overlap. If a table is inside a separe/booth cell, center the table inside that separe/booth cell. No table body may touch or overlap another table, a wall, partition, booth divider, column, bar, passage, or room outline. If the exact center is not visible on the sketch, infer a clean centered position from the surrounding free space and keep spacing consistent with neighboring tables. Also accept direct Chin-Chin labels attached to a table. Never mark more than one quarter of total tables as Chin-Chin; if the plan marks more, keep the clearest/best marked tables up to that limit and explain in notes. If the plan does not clearly mark Chin-Chin tables, set all chinChinCandidate=false, tableRole=ORDINARY_TABLE, chinChinTier=STANDARD, tablePhotoId='', tablePhotoStatus=NOT_REQUIRED, and chinChinCandidateCount=0. Keep tables inside the outline, keep tables clear of fixtures, leave service paths clear, and write the label/strategy/summary as a cafe layout. JSON space data:\n" +
                JSON.stringify(promptSpaceJson),
            },
            ...floorPlanContent,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "chin_chin_space_layout",
          strict: true,
          schema: this.openAiLayoutSchema(),
        },
      },
    };
  }

  private createOpenAiFloorPlanContent(
    file: {
      fileName: string;
      mimeType: string;
      dataUrl?: string;
      remoteUrl?: string;
    },
    imageDetail: string,
  ) {
    if (file.mimeType === "application/pdf") {
      return {
        type: "input_file",
        filename: file.fileName,
        file_data: file.dataUrl
          ? this.extractDataPayload(file.dataUrl)
          : undefined,
        file_url: file.remoteUrl,
      };
    }

    return {
      type: "input_image",
      image_url: file.dataUrl ?? file.remoteUrl,
      detail: imageDetail,
    };
  }

  private extractDataPayload(dataUrl: string) {
    const commaIndex = dataUrl.indexOf(",");
    return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  }

  private extractFloorPlanFile(spaceJson: Prisma.JsonValue) {
    if (
      typeof spaceJson !== "object" ||
      !spaceJson ||
      Array.isArray(spaceJson) ||
      typeof spaceJson.floorPlanFile !== "object" ||
      !spaceJson.floorPlanFile ||
      Array.isArray(spaceJson.floorPlanFile)
    ) {
      return null;
    }

    const file = spaceJson.floorPlanFile;
    const fileName =
      typeof file.fileName === "string" ? file.fileName : "floor-plan";
    const mimeType =
      typeof file.mimeType === "string" ? file.mimeType : undefined;
    const dataUrl = typeof file.dataUrl === "string" ? file.dataUrl : undefined;
    const remoteUrl =
      typeof file.remoteUrl === "string" ? file.remoteUrl : undefined;

    if (!mimeType || (!dataUrl && !remoteUrl)) {
      return null;
    }

    return { fileName, mimeType, dataUrl, remoteUrl };
  }

  private createPromptSafeSpaceJson(spaceJson: Prisma.JsonValue) {
    return this.stripImagePayloads(spaceJson);
  }

  private stripImagePayloads(value: Prisma.JsonValue): Prisma.JsonValue {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripImagePayloads(item));
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    const result: Record<string, Prisma.JsonValue> = {};

    for (const [key, entry] of Object.entries(value) as Array<
      [string, Prisma.JsonValue]
    >) {
      if (key === "photos") {
        result[key] = Array.isArray(entry)
          ? entry.map((photo, index) =>
              this.stripPhotoForPrompt(photo, `chin-chin-photo-${index + 1}`),
            )
          : [];
        continue;
      }

      if (key === "dataUrl" || key === "remoteUrl") {
        result[key] = entry ? "[provided-as-image-input]" : "";
        continue;
      }

      result[key] = this.stripImagePayloads(entry);
    }

    return result;
  }

  private stripPhotoForPrompt(value: Prisma.JsonValue, fallbackId: string) {
    if (typeof value !== "object" || !value || Array.isArray(value)) {
      return { id: fallbackId };
    }

    const photo = value as Record<string, Prisma.JsonValue>;

    return {
      id:
        typeof photo.id === "string" && photo.id.trim()
          ? photo.id.trim()
          : fallbackId,
      fileName:
        typeof photo.fileName === "string" ? photo.fileName : "table-photo",
      mimeType: typeof photo.mimeType === "string" ? photo.mimeType : "image",
      imagePayload: "[not-sent-to-ai]",
    };
  }

  private openAiLayoutSchema() {
    const numberSchema = { type: "number" };
    const stringSchema = { type: "string" };
    const pointSchema = {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: numberSchema,
        y: numberSchema,
      },
    };
    const fixtureSchema = {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "label",
        "type",
        "shape",
        "x",
        "y",
        "width",
        "height",
        "rotation",
      ],
      properties: {
        id: stringSchema,
        label: stringSchema,
        type: {
          type: "string",
          enum: [
            "column",
            "bar",
            "counter",
            "toilet",
            "stairs",
            "door",
            "passage",
            "partition",
            "booth",
            "wall",
            "window",
            "service",
            "feature",
          ],
        },
        shape: {
          type: "string",
          enum: ["square", "rectangle", "circle", "line"],
        },
        x: numberSchema,
        y: numberSchema,
        width: numberSchema,
        height: numberSchema,
        rotation: numberSchema,
      },
    };

    return {
      type: "object",
      additionalProperties: false,
      required: ["version", "source", "units", "layoutOptions", "notes"],
      properties: {
        version: { type: "integer" },
        source: { type: "string" },
        units: { type: "string", enum: ["meters"] },
        notes: { type: "array", items: stringSchema },
        layoutOptions: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "strategy", "rooms", "summary"],
            properties: {
              id: stringSchema,
              label: stringSchema,
              strategy: stringSchema,
              summary: {
                type: "object",
                additionalProperties: false,
                required: ["tableCount", "seats", "chinChinCandidateCount"],
                properties: {
                  tableCount: { type: "integer" },
                  seats: { type: "integer" },
                  chinChinCandidateCount: { type: "integer" },
                },
              },
              rooms: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "roomLabel",
                    "canvas",
                    "outline",
                    "fixtures",
                    "zones",
                    "tables",
                  ],
                  properties: {
                    roomLabel: stringSchema,
                    canvas: {
                      type: "object",
                      additionalProperties: false,
                      required: ["width", "length"],
                      properties: {
                        width: numberSchema,
                        length: numberSchema,
                      },
                    },
                    outline: {
                      type: "array",
                      minItems: 4,
                      items: pointSchema,
                    },
                    fixtures: {
                      type: "array",
                      items: fixtureSchema,
                    },
                    zones: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "id",
                          "label",
                          "type",
                          "x",
                          "y",
                          "width",
                          "height",
                        ],
                        properties: {
                          id: stringSchema,
                          label: stringSchema,
                          type: {
                            type: "string",
                            enum: [
                              "seating",
                              "service",
                              "walkway",
                              "bar",
                              "toilet",
                              "stairs",
                              "feature",
                              "blocked",
                            ],
                          },
                          x: numberSchema,
                          y: numberSchema,
                          width: numberSchema,
                          height: numberSchema,
                        },
                      },
                    },
                    tables: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "id",
                          "label",
                          "tableRole",
                          "chinChinTier",
                          "tablePhotoId",
                          "tablePhotoStatus",
                          "x",
                          "y",
                          "width",
                          "height",
                          "seats",
                          "minPartySize",
                          "maxPartySize",
                          "reservable",
                          "rotation",
                          "shape",
                          "chinChinCandidate",
                        ],
                        properties: {
                          id: stringSchema,
                          label: stringSchema,
                          tableRole: {
                            type: "string",
                            enum: ["CHIN_CHIN_TABLE", "ORDINARY_TABLE"],
                          },
                          chinChinTier: {
                            type: "string",
                            enum: ["STANDARD", "LARGE"],
                          },
                          tablePhotoId: stringSchema,
                          tablePhotoStatus: {
                            type: "string",
                            enum: [
                              "APPROVED_WITH_PHOTO",
                              "MISSING_PHOTO",
                              "NOT_REQUIRED",
                            ],
                          },
                          x: numberSchema,
                          y: numberSchema,
                          width: numberSchema,
                          height: numberSchema,
                          seats: { type: "integer" },
                          minPartySize: { type: "integer" },
                          maxPartySize: { type: "integer" },
                          reservable: { type: "boolean" },
                          rotation: numberSchema,
                          shape: {
                            type: "string",
                            enum: ["round", "rectangle"],
                          },
                          chinChinCandidate: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  private extractRoomPhotos(spaceJson: Prisma.JsonValue) {
    const result: Array<{ dataUrl?: string; remoteUrl?: string }> = [];

    if (
      typeof spaceJson !== "object" ||
      !spaceJson ||
      Array.isArray(spaceJson)
    ) {
      return result;
    }

    const rooms = Array.isArray(spaceJson.rooms) ? spaceJson.rooms : [];

    for (const room of rooms) {
      if (
        typeof room !== "object" ||
        !room ||
        Array.isArray(room) ||
        !Array.isArray(room.photos)
      ) {
        continue;
      }

      for (const photo of room.photos) {
        if (typeof photo !== "object" || !photo) {
          continue;
        }

        const dataUrl =
          "dataUrl" in photo && typeof photo.dataUrl === "string"
            ? photo.dataUrl
            : undefined;
        const remoteUrl =
          "remoteUrl" in photo && typeof photo.remoteUrl === "string"
            ? photo.remoteUrl
            : undefined;

        if (dataUrl || remoteUrl) {
          result.push({ dataUrl, remoteUrl });
        }
      }
    }

    return result;
  }

  private extractOpenAiOutputText(responseJson: Record<string, unknown>) {
    if (typeof responseJson.output_text === "string") {
      return responseJson.output_text;
    }

    const output = Array.isArray(responseJson.output)
      ? responseJson.output
      : [];

    for (const item of output) {
      if (typeof item !== "object" || !item || !("content" in item)) {
        continue;
      }

      const content = Array.isArray(item.content) ? item.content : [];

      for (const contentItem of content) {
        if (
          typeof contentItem === "object" &&
          contentItem &&
          "text" in contentItem &&
          typeof contentItem.text === "string"
        ) {
          return contentItem.text;
        }
      }
    }

    throw new InternalServerErrorException("OpenAI returned no JSON text.");
  }

  private parseOpenAiLayoutJson(outputText: string) {
    try {
      return JSON.parse(outputText) as Record<string, unknown>;
    } catch {
      throw new InternalServerErrorException(
        "OpenAI returned invalid layout JSON.",
      );
    }
  }

  private readOpenAiErrorMessage(responseJson: Record<string, unknown>) {
    const error = responseJson.error;

    if (
      typeof error === "object" &&
      error &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }

    return null;
  }

  private createStubSuggestion(spaceJson: Prisma.JsonValue) {
    const space = this.readSpaceDimensions(spaceJson);
    const tables = this.createTableGrid(space, "comfortable");
    const zones = this.createZones(space, "center-service");

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
          label: "AI nacrt",
          strategy: "balanced-service-path",
          rooms: [
            {
              roomLabel: space.roomLabel,
              canvas: {
                width: space.widthMeters,
                length: space.lengthMeters,
              },
              outline: this.createRectangleOutline(space),
              fixtures: [],
              zones,
              tables,
            },
          ],
          summary: {
            tableCount: tables.length,
            seats: tables.reduce((total, table) => total + table.seats, 0),
            chinChinCandidateCount: 0,
          },
        },
      ],
      notes: [
        "Test suggestion generated without OpenAI. Chin-Chin tables are intentionally not selected in this step.",
      ],
    };
  }

  private createRectangleOutline(
    space: ReturnType<typeof this.readSpaceDimensions>,
  ) {
    return [
      { x: 0, y: 0 },
      { x: space.widthMeters, y: 0 },
      { x: space.widthMeters, y: space.lengthMeters },
      { x: 0, y: space.lengthMeters },
    ];
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
        tableRole: "ORDINARY_TABLE",
        tablePhotoId: "",
        tablePhotoStatus: "NOT_REQUIRED",
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
        chinChinCandidate: false,
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

    const sourceSpace =
      "primaryRoom" in spaceJson &&
      typeof spaceJson.primaryRoom === "object" &&
      spaceJson.primaryRoom &&
      !Array.isArray(spaceJson.primaryRoom)
        ? spaceJson.primaryRoom
        : spaceJson;

    const roomLabel =
      typeof sourceSpace.roomLabel === "string"
        ? sourceSpace.roomLabel
        : "Prostorija A";
    const requestedTableCount =
      typeof sourceSpace.requestedTableCount === "number"
        ? sourceSpace.requestedTableCount
        : undefined;
    const widthMeters =
      typeof sourceSpace.widthMeters === "number"
        ? sourceSpace.widthMeters
        : 10;
    const lengthMeters =
      typeof sourceSpace.lengthMeters === "number"
        ? sourceSpace.lengthMeters
        : 8;

    return { roomLabel, requestedTableCount, widthMeters, lengthMeters };
  }

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }

  private numberFrom(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }

  private createLifecycleSnapshot(project: {
    status: SpaceLayoutStatus;
    savedLayout: Prisma.JsonValue | null;
    reviewSubmission: Prisma.JsonValue | null;
    approvedAt: Date | null;
    updatedAt: Date;
  }) {
    const savedLayout = this.asJsonObject(project.savedLayout);
    const reviewSubmission = this.asJsonObject(project.reviewSubmission);
    const review = this.asJsonObject(reviewSubmission?.review ?? null);

    return {
      status: project.status,
      phase: this.lifecyclePhaseForStatus(project.status),
      isDraft: project.status === SpaceLayoutStatus.DRAFT,
      isPendingReview:
        project.status === SpaceLayoutStatus.PENDING_CHIN_CHIN_REVIEW,
      isApproved: project.status === SpaceLayoutStatus.APPROVED,
      isChangeRequested:
        project.status === SpaceLayoutStatus.CHIN_CHIN_CHANGES_REQUESTED,
      latestApprovedAt: project.approvedAt?.toISOString() ?? null,
      layoutVersion:
        typeof savedLayout?.layoutVersion === "number"
          ? savedLayout.layoutVersion
          : null,
      versionCount: Array.isArray(savedLayout?.versionHistory)
        ? savedLayout.versionHistory.length
        : 0,
      reviewStatus: review?.status?.toString() ?? null,
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  private lifecyclePhaseForStatus(status: SpaceLayoutStatus) {
    switch (status) {
      case SpaceLayoutStatus.DRAFT:
      case SpaceLayoutStatus.AI_SUGGESTED:
      case SpaceLayoutStatus.SAVED:
        return "draft";
      case SpaceLayoutStatus.PENDING_CHIN_CHIN_REVIEW:
        return "pending_review";
      case SpaceLayoutStatus.APPROVED:
        return "approved";
      case SpaceLayoutStatus.CHIN_CHIN_CHANGES_REQUESTED:
        return "change_requested";
      default:
        return "unknown";
    }
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
      lifecycle: this.createLifecycleSnapshot(project),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import {
  DevicePushApp,
  VenueDocumentStatus,
} from "../../generated/prisma/enums";
import { DeviceTokensService } from "../device-tokens/device-tokens.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReviewVenueDocumentsDto } from "./dto/review-venue-documents.dto";
import { SubmitVenueDocumentsDto } from "./dto/submit-venue-documents.dto";
import { VenueDocumentFileDto } from "./dto/venue-document-file.dto";

@Injectable()
export class VenueDocumentsService {
  private readonly logger = new Logger(VenueDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceTokensService: DeviceTokensService,
  ) {}

  async submitVenueDocuments(venueId: string, dto: SubmitVenueDocumentsDto) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      include: { owner: true },
    });

    if (!venue) {
      throw new NotFoundException("Venue was not found.");
    }

    const documents = dto.documents.map((document, index) =>
      this.normalizeDocument(document, `venue-document-${index + 1}`),
    );

    const request = await this.prisma.venueDocumentRequest.create({
      data: {
        ownerId: venue.ownerId,
        venueId: venue.id,
        status: VenueDocumentStatus.PENDING_REVIEW,
        documents: documents as Prisma.InputJsonValue,
        ownerNotes: dto.ownerNotes?.trim(),
      },
      include: { owner: true, venue: true },
    });

    return this.serializeRequest(request);
  }

  async getLatestForVenue(venueId: string) {
    const request = await this.prisma.venueDocumentRequest.findFirst({
      where: { venueId },
      orderBy: { createdAt: "desc" },
      include: { owner: true, venue: true },
    });

    if (!request) {
      throw new NotFoundException("Venue document request was not found.");
    }

    return this.serializeRequest(request);
  }

  async getReviewQueue() {
    const requests = await this.prisma.venueDocumentRequest.findMany({
      where: {
        status: {
          in: [
            VenueDocumentStatus.PENDING_REVIEW,
            VenueDocumentStatus.CHANGES_REQUESTED,
          ],
        },
      },
      orderBy: { updatedAt: "desc" },
      include: { owner: true, venue: true },
    });

    return requests.map((request) => this.serializeRequest(request));
  }

  async approveRequest(id: string, dto: ReviewVenueDocumentsDto) {
    const request = await this.reviewRequest(
      id,
      VenueDocumentStatus.APPROVED,
      dto,
    );
    await this.notifyVenueDocumentsApproved(request);
    return request;
  }

  async requestChanges(id: string, dto: ReviewVenueDocumentsDto) {
    const request = await this.reviewRequest(
      id,
      VenueDocumentStatus.CHANGES_REQUESTED,
      dto,
    );
    await this.notifyVenueDocumentsChangesRequested(request);
    return request;
  }

  private async reviewRequest(
    id: string,
    status: VenueDocumentStatus,
    dto: ReviewVenueDocumentsDto,
  ) {
    const existing = await this.prisma.venueDocumentRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException("Venue document request was not found.");
    }

    const request = await this.prisma.venueDocumentRequest.update({
      where: { id },
      data: {
        status,
        reviewNotes: dto.reviewNotes?.trim(),
        reviewedAt: new Date(),
      },
      include: { owner: true, venue: true },
    });

    return this.serializeRequest(request);
  }

  private normalizeDocument(
    document: VenueDocumentFileDto,
    fallbackId: string,
  ) {
    if (!document.dataUrl.startsWith(`data:${document.mimeType};base64,`)) {
      throw new BadRequestException(
        "Document dataUrl does not match its mimeType.",
      );
    }

    return {
      id: document.id?.trim() || fallbackId,
      fileName: document.fileName.trim(),
      mimeType: document.mimeType,
      dataUrl: document.dataUrl,
    };
  }

  private serializeRequest(request: {
    id: string;
    ownerId: string;
    venueId: string;
    status: VenueDocumentStatus;
    documents: Prisma.JsonValue;
    ownerNotes: string | null;
    reviewNotes: string | null;
    submittedAt: Date;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    owner: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phoneNumber: string | null;
    };
    venue: {
      id: string;
      name: string;
      slug: string;
      address: string | null;
      city: string | null;
    };
  }) {
    return {
      id: request.id,
      ownerId: request.ownerId,
      venueId: request.venueId,
      type: "document",
      status: request.status,
      documents: request.documents,
      ownerNotes: request.ownerNotes,
      reviewNotes: request.reviewNotes,
      submittedAt: request.submittedAt,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      owner: request.owner,
      venue: request.venue,
    };
  }

  private async notifyVenueDocumentsApproved(request: {
    id: string;
    ownerId: string;
    venueId: string;
    venue: { id: string; name: string };
  }) {
    try {
      this.logger.log(
        `[push][venue-owner] sending document approval requestId=${request.id} ownerId=${request.ownerId} venueId=${request.venueId}`,
      );
      await this.deviceTokensService.sendToUser({
        userId: request.ownerId,
        app: DevicePushApp.VENUE_OWNER,
        title: "Vaš dokument je odobren.",
        body: "Vaš dokument je odobren.",
        data: {
          type: "venue_documents_approved",
          venueId: request.venueId,
          requestId: request.id,
        },
      });
      this.logger.log(
        `[push][venue-owner] sent document approval requestId=${request.id} ownerId=${request.ownerId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Document approval push failed for request ${request.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async notifyVenueDocumentsChangesRequested(request: {
    id: string;
    ownerId: string;
    venueId: string;
    venue: { id: string; name: string };
  }) {
    try {
      this.logger.log(
        `[push][venue-owner] sending document changes requestId=${request.id} ownerId=${request.ownerId} venueId=${request.venueId}`,
      );
      await this.deviceTokensService.sendToUser({
        userId: request.ownerId,
        app: DevicePushApp.VENUE_OWNER,
        title: "Dokument nije odobren",
        body: `${request.venue.name}: dokument nije odobren. Pošaljite ispravljeni PDF ili JPEG scan.`,
        data: {
          type: "venue_documents_changes_requested",
          venueId: request.venueId,
          requestId: request.id,
        },
      });
      this.logger.log(
        `[push][venue-owner] sent document changes requestId=${request.id} ownerId=${request.ownerId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Document changes push failed for request ${request.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

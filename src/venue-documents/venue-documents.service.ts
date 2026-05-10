import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { VenueDocumentStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { ReviewVenueDocumentsDto } from "./dto/review-venue-documents.dto";
import { SubmitVenueDocumentsDto } from "./dto/submit-venue-documents.dto";
import { VenueDocumentFileDto } from "./dto/venue-document-file.dto";

@Injectable()
export class VenueDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

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
      where: { status: { in: [VenueDocumentStatus.PENDING_REVIEW, VenueDocumentStatus.CHANGES_REQUESTED] } },
      orderBy: { updatedAt: "desc" },
      include: { owner: true, venue: true },
    });

    return requests.map((request) => this.serializeRequest(request));
  }

  async approveRequest(id: string, dto: ReviewVenueDocumentsDto) {
    return this.reviewRequest(id, VenueDocumentStatus.APPROVED, dto);
  }

  async requestChanges(id: string, dto: ReviewVenueDocumentsDto) {
    return this.reviewRequest(id, VenueDocumentStatus.CHANGES_REQUESTED, dto);
  }

  private async reviewRequest(
    id: string,
    status: VenueDocumentStatus,
    dto: ReviewVenueDocumentsDto,
  ) {
    const existing = await this.prisma.venueDocumentRequest.findUnique({ where: { id } });
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

  private normalizeDocument(document: VenueDocumentFileDto, fallbackId: string) {
    if (!document.dataUrl.startsWith(`data:${document.mimeType};base64,`)) {
      throw new BadRequestException("Document dataUrl does not match its mimeType.");
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
}

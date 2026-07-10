import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "../../generated/prisma/enums";
import { AdminRoles } from "../auth/decorators/admin-roles.decorator";
import { AdminRolesGuard } from "../auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ReviewVenueDocumentsDto } from "./dto/review-venue-documents.dto";
import { SubmitVenueDocumentsDto } from "./dto/submit-venue-documents.dto";
import { VenueDocumentsService } from "./venue-documents.service";

@Controller("venue-documents")
export class VenueDocumentsController {
  constructor(private readonly venueDocumentsService: VenueDocumentsService) {}

  @Post("preview/venues/:venueId/requests")
  submitVenueDocuments(
    @Param("venueId") venueId: string,
    @Body() dto: SubmitVenueDocumentsDto,
  ) {
    return this.venueDocumentsService.submitVenueDocuments(venueId, dto);
  }

  @Get("preview/venues/:venueId/latest")
  getLatestForVenue(@Param("venueId") venueId: string) {
    return this.venueDocumentsService.getLatestForVenue(venueId);
  }

  @Get("preview/review-queue")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  getReviewQueue() {
    return this.venueDocumentsService.getReviewQueue();
  }

  @Patch("preview/requests/:id/approve")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  approveRequest(
    @Param("id") id: string,
    @Body() dto: ReviewVenueDocumentsDto,
  ) {
    return this.venueDocumentsService.approveRequest(id, dto);
  }

  @Patch("preview/requests/:id/request-changes")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  requestChanges(
    @Param("id") id: string,
    @Body() dto: ReviewVenueDocumentsDto,
  ) {
    return this.venueDocumentsService.requestChanges(id, dto);
  }
}

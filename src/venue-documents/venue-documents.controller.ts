import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
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
  getReviewQueue() {
    return this.venueDocumentsService.getReviewQueue();
  }

  @Patch("preview/requests/:id/approve")
  approveRequest(@Param("id") id: string, @Body() dto: ReviewVenueDocumentsDto) {
    return this.venueDocumentsService.approveRequest(id, dto);
  }

  @Patch("preview/requests/:id/request-changes")
  requestChanges(@Param("id") id: string, @Body() dto: ReviewVenueDocumentsDto) {
    return this.venueDocumentsService.requestChanges(id, dto);
  }
}

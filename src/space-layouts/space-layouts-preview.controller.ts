import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApproveAdjustedLayoutPreviewDto } from "./dto/approve-adjusted-layout-preview.dto";
import { GenerateSpaceLayoutPreviewDto } from "./dto/generate-space-layout-preview.dto";
import { SubmitCompleteSpaceLayoutReviewDto } from "./dto/submit-complete-space-layout-review.dto";
import { SpaceLayoutsService } from "./space-layouts.service";

@Controller("space-layouts")
export class SpaceLayoutsPreviewController {
  constructor(private readonly spaceLayoutsService: SpaceLayoutsService) {}

  @Post("generate-preview")
  generatePreview(@Body() dto: GenerateSpaceLayoutPreviewDto) {
    return this.spaceLayoutsService.generatePreview(dto);
  }

  @Post("submit-complete-preview")
  submitCompletePreview(@Body() dto: SubmitCompleteSpaceLayoutReviewDto) {
    return this.spaceLayoutsService.submitCompletePreviewForReview(dto);
  }

  @Get("preview/venues/:venueId/latest")
  latestVenueProjectPreview(@Param("venueId") venueId: string) {
    return this.spaceLayoutsService.getLatestVenueProjectPreview(venueId);
  }

  @Get("preview/review-queue")
  reviewQueuePreview() {
    return this.spaceLayoutsService.listReviewQueuePreview();
  }

  @Patch("preview/projects/:id/approve-adjusted-layout")
  approveAdjustedLayoutPreview(
    @Param("id") id: string,
    @Body() dto: ApproveAdjustedLayoutPreviewDto,
  ) {
    return this.spaceLayoutsService.approveAdjustedLayoutPreview(id, dto);
  }
}

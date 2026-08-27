import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { UseGuards } from "@nestjs/common";
import { UserRole } from "../../generated/prisma/enums";
import { AdminRoles } from "../auth/decorators/admin-roles.decorator";
import { AdminRolesGuard } from "../auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ApproveAdjustedLayoutPreviewDto } from "./dto/approve-adjusted-layout-preview.dto";
import { CreateSpaceChangeAttachmentUploadUrlDto } from "./dto/create-space-change-attachment-upload-url.dto";
import { CreateTablePhotoUploadUrlDto } from "./dto/create-table-photo-upload-url.dto";
import { GenerateSpaceLayoutPreviewDto } from "./dto/generate-space-layout-preview.dto";
import { RequestTableAdditionPreviewDto } from "./dto/request-table-addition-preview.dto";
import { RequestTableUpdatesPreviewDto } from "./dto/request-table-updates-preview.dto";
import { RequestSpaceChangePreviewDto } from "./dto/request-space-change-preview.dto";
import { SubmitCompleteSpaceLayoutReviewDto } from "./dto/submit-complete-space-layout-review.dto";
import { SpaceLayoutsService } from "./space-layouts.service";

@Controller("space-layouts")
export class SpaceLayoutsPreviewController {
  constructor(private readonly spaceLayoutsService: SpaceLayoutsService) {}

  @Post("generate-preview")
  generatePreview(@Body() dto: GenerateSpaceLayoutPreviewDto) {
    return this.spaceLayoutsService.generatePreview(dto);
  }

  @Post("generate-preview/jobs")
  startGeneratePreviewJob(@Body() dto: GenerateSpaceLayoutPreviewDto) {
    return this.spaceLayoutsService.startGeneratePreviewJob(dto);
  }

  @Get("generate-preview/jobs/:jobId")
  getGeneratePreviewJob(@Param("jobId") jobId: string) {
    return this.spaceLayoutsService.getGeneratePreviewJob(jobId);
  }

  @Post("submit-complete-preview")
  submitCompletePreview(@Body() dto: SubmitCompleteSpaceLayoutReviewDto) {
    return this.spaceLayoutsService.submitCompletePreviewForReview(dto);
  }

  @Get("preview/venues/:venueId/latest")
  latestVenueProjectPreview(@Param("venueId") venueId: string) {
    return this.spaceLayoutsService.getLatestVenueProjectPreview(venueId);
  }

  @Get("preview/venues/:venueId/latest-approved")
  latestApprovedVenueProjectPreview(@Param("venueId") venueId: string) {
    return this.spaceLayoutsService.getLatestApprovedVenueProjectPreview(
      venueId,
    );
  }

  @Get("preview/review-queue")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  reviewQueuePreview() {
    return this.spaceLayoutsService.listReviewQueuePreview();
  }

  @Get("preview/admin/venues")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  adminVenuesPreview() {
    return this.spaceLayoutsService.listAdminVenuesPreview();
  }

  @Post("preview/venues/:venueId/request-table-addition")
  requestTableAdditionPreview(
    @Param("venueId") venueId: string,
    @Body() dto: RequestTableAdditionPreviewDto,
  ) {
    return this.spaceLayoutsService.requestTableAdditionPreview(venueId, dto);
  }

  @Post("preview/venues/:venueId/request-table-updates")
  requestTableUpdatesPreview(
    @Param("venueId") venueId: string,
    @Body() dto: RequestTableUpdatesPreviewDto,
  ) {
    return this.spaceLayoutsService.requestTableUpdatesPreview(venueId, dto);
  }

  @Post("preview/venues/:venueId/table-photo-upload-url")
  createTablePhotoUploadUrl(
    @Param("venueId") venueId: string,
    @Body() dto: CreateTablePhotoUploadUrlDto,
  ) {
    return this.spaceLayoutsService.createTablePhotoUploadUrl(venueId, dto);
  }

  @Post("preview/venues/:venueId/space-change-attachment-upload-url")
  createSpaceChangeAttachmentUploadUrl(
    @Param("venueId") venueId: string,
    @Body() dto: CreateSpaceChangeAttachmentUploadUrlDto,
  ) {
    return this.spaceLayoutsService.createSpaceChangeAttachmentUploadUrl(
      venueId,
      dto,
    );
  }

  @Post("preview/venues/:venueId/request-space-change")
  requestSpaceChangePreview(
    @Param("venueId") venueId: string,
    @Body() dto: RequestSpaceChangePreviewDto,
  ) {
    return this.spaceLayoutsService.requestSpaceChangePreview(venueId, dto);
  }

  @Patch("preview/projects/:id/approve-adjusted-layout")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  approveAdjustedLayoutPreview(
    @Param("id") id: string,
    @Body() dto: ApproveAdjustedLayoutPreviewDto,
  ) {
    return this.spaceLayoutsService.approveAdjustedLayoutPreview(id, dto);
  }
}

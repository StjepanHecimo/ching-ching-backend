import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateSpaceLayoutDto } from "./dto/create-space-layout.dto";
import { SaveSpaceLayoutDto } from "./dto/save-space-layout.dto";
import { SubmitCompleteSpaceLayoutReviewDto } from "./dto/submit-complete-space-layout-review.dto";
import {
  ReviewSpaceLayoutDto,
  SubmitSpaceLayoutReviewDto,
} from "./dto/submit-space-layout-review.dto";
import { SpaceLayoutsService } from "./space-layouts.service";

@Controller("space-layouts")
@UseGuards(JwtAuthGuard)
export class SpaceLayoutsController {
  constructor(private readonly spaceLayoutsService: SpaceLayoutsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSpaceLayoutDto,
  ) {
    return this.spaceLayoutsService.create(request.user.userId, dto);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query("venueId") venueId?: string,
  ) {
    return this.spaceLayoutsService.list(request.user.userId, venueId);
  }

  @Post("submit-complete-for-review")
  submitCompleteForReview(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SubmitCompleteSpaceLayoutReviewDto,
  ) {
    return this.spaceLayoutsService.submitCompleteForReview(
      request.user.userId,
      dto,
    );
  }

  @Get(":id")
  get(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.spaceLayoutsService.get(request.user.userId, id);
  }

  @Post(":id/generate-suggestion")
  generateSuggestion(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.spaceLayoutsService.generateSuggestion(request.user.userId, id);
  }

  @Patch(":id/layout")
  saveLayout(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: SaveSpaceLayoutDto,
  ) {
    return this.spaceLayoutsService.saveLayout(request.user.userId, id, dto);
  }

  @Post(":id/submit-for-review")
  submitForReview(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: SubmitSpaceLayoutReviewDto,
  ) {
    return this.spaceLayoutsService.submitForReview(
      request.user.userId,
      id,
      dto,
    );
  }

  @Patch(":id/chin-chin-review")
  review(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ReviewSpaceLayoutDto,
  ) {
    return this.spaceLayoutsService.review(request.user.userId, id, dto);
  }
}

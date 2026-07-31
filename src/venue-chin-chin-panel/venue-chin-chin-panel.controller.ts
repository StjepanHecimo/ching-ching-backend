import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UpsertVenueChinChinPanelDto } from "./dto/upsert-venue-chin-chin-panel.dto";
import { VenueChinChinPanelService } from "./venue-chin-chin-panel.service";

@Controller("venue-chin-chin-panel")
export class VenueChinChinPanelController {
  constructor(
    private readonly venueChinChinPanelService: VenueChinChinPanelService,
  ) {}

  @Get("preview/venues/:venueId")
  getForVenue(@Param("venueId") venueId: string) {
    return this.venueChinChinPanelService.getForVenue(venueId);
  }

  @Get("venues")
  listPublicVenues(@Query("city") city?: string) {
    return this.venueChinChinPanelService.listPublicVenues(city);
  }

  @Get("events")
  listPublicEventVenues(@Query("city") city?: string) {
    return this.venueChinChinPanelService.listPublicEventVenues(city);
  }

  @Get("drink-brands")
  listDrinkBrands() {
    return this.venueChinChinPanelService.listDrinkBrands();
  }

  @Get("content-assets")
  listContentAssets() {
    return this.venueChinChinPanelService.listContentAssets();
  }

  @Get("venues/:venueId")
  getPublicForVenue(@Param("venueId") venueId: string) {
    return this.venueChinChinPanelService.getForVenue(venueId);
  }

  @Get("venues/:venueId/follow")
  @UseGuards(JwtAuthGuard)
  getFollowStatus(
    @Param("venueId") venueId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.venueChinChinPanelService.getFollowStatus(
      request.user.userId,
      venueId,
    );
  }

  @Post("venues/:venueId/follow")
  @UseGuards(JwtAuthGuard)
  followVenue(
    @Param("venueId") venueId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.venueChinChinPanelService.followVenue(
      request.user.userId,
      venueId,
    );
  }

  @Delete("venues/:venueId/follow")
  @UseGuards(JwtAuthGuard)
  unfollowVenue(
    @Param("venueId") venueId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.venueChinChinPanelService.unfollowVenue(
      request.user.userId,
      venueId,
    );
  }

  @Put("preview/venues/:venueId")
  upsertForVenue(
    @Param("venueId") venueId: string,
    @Body() dto: UpsertVenueChinChinPanelDto,
  ) {
    return this.venueChinChinPanelService.upsertForVenue(venueId, dto);
  }
}

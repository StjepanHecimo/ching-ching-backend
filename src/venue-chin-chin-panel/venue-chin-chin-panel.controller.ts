import { Body, Controller, Get, Param, Put, Query } from "@nestjs/common";
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

  @Put("preview/venues/:venueId")
  upsertForVenue(
    @Param("venueId") venueId: string,
    @Body() dto: UpsertVenueChinChinPanelDto,
  ) {
    return this.venueChinChinPanelService.upsertForVenue(venueId, dto);
  }
}

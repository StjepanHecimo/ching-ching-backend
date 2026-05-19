import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import { ReservationAvailabilityQueryDto } from "./dto/reservation-availability-query.dto";
import { UpdateVenueLiveStatusDto } from "./dto/update-venue-live-status.dto";
import { UpdateReservationStatusDto } from "./dto/update-reservation-status.dto";
import { DeclineReservationDto } from "./dto/decline-reservation.dto";
import { ReservationsService } from "./reservations.service";

@Controller("reservations")
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Get("preview/venues/:venueId/availability")
  getVenueAvailability(
    @Param("venueId") venueId: string,
    @Query() query: ReservationAvailabilityQueryDto,
  ) {
    return this.reservationsService.getVenueAvailability(venueId, query);
  }

  @Post("preview/venues/:venueId")
  createReservation(
    @Param("venueId") venueId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationsService.createReservation(venueId, dto);
  }

  @Post("preview/venues/:venueId/request")
  requestReservation(
    @Param("venueId") venueId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationsService.createReservation(venueId, dto);
  }

  @Get("preview/venues/:venueId")
  listVenueReservations(@Param("venueId") venueId: string) {
    return this.reservationsService.listVenueReservations(venueId);
  }

  @Get("preview/venues/:venueId/requests")
  listPendingVenueReservationRequests(@Param("venueId") venueId: string) {
    return this.reservationsService.listPendingVenueReservationRequests(
      venueId,
    );
  }

  @Patch("preview/venues/:venueId/live-status")
  updateVenueLiveStatus(
    @Param("venueId") venueId: string,
    @Body() dto: UpdateVenueLiveStatusDto,
  ) {
    return this.reservationsService.updateVenueLiveStatus(venueId, dto);
  }

  @Patch("preview/:id/status")
  updateReservationStatus(
    @Param("id") id: string,
    @Body() dto: UpdateReservationStatusDto,
  ) {
    return this.reservationsService.updateReservationStatus(id, dto);
  }

  @Post("preview/:id/accept")
  acceptReservation(@Param("id") id: string) {
    return this.reservationsService.acceptReservation(id);
  }

  @Post("preview/:id/decline")
  declineReservation(
    @Param("id") id: string,
    @Body() dto: DeclineReservationDto,
  ) {
    return this.reservationsService.declineReservation(id, dto);
  }
}

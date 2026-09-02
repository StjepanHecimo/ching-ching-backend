import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { AdminRoles } from "../auth/decorators/admin-roles.decorator";
import { AdminRolesGuard } from "../auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserRole } from "../../generated/prisma/enums";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import { CreateReservationTimeChangeRequestDto } from "./dto/create-reservation-time-change-request.dto";
import { ReservationAvailabilityQueryDto } from "./dto/reservation-availability-query.dto";
import { ReservationUnavailableSlotsQueryDto } from "./dto/reservation-unavailable-slots-query.dto";
import { UpdateVenueLiveStatusDto } from "./dto/update-venue-live-status.dto";
import { UpdateVenueReservationSettingsDto } from "./dto/update-venue-reservation-settings.dto";
import { UpdateReservationStatusDto } from "./dto/update-reservation-status.dto";
import { DeclineReservationDto } from "./dto/decline-reservation.dto";
import { VenueReservationsQueryDto } from "./dto/venue-reservations-query.dto";
import { ReservationsService } from "./reservations.service";
import {
  CreateCustomerProblemReportDto,
  CreateCustomerProblemReportPhotoUploadUrlDto,
} from "../payments/dto/create-customer-problem-report.dto";
import { CreateVenueRefundRequestDto } from "../payments/dto/create-venue-refund-request.dto";
import { PaymentsService } from "../payments/payments.service";

@Controller("reservations")
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get("preview/venues/:venueId/availability")
  getVenueAvailability(
    @Param("venueId") venueId: string,
    @Query() query: ReservationAvailabilityQueryDto,
  ) {
    return this.reservationsService.getVenueAvailability(venueId, query);
  }

  @Get("preview/venues/:venueId/unavailable-slots")
  getVenueUnavailableSlots(
    @Param("venueId") venueId: string,
    @Query() query: ReservationUnavailableSlotsQueryDto,
  ) {
    return this.reservationsService.getVenueUnavailableSlots(venueId, query);
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

  @Post("preview/venues/:venueId/reservations/:reservationId/problem-report")
  createVenueProblemReport(
    @Param("venueId") venueId: string,
    @Param("reservationId") reservationId: string,
    @Body() dto: CreateVenueRefundRequestDto,
  ) {
    return this.paymentsService.createVenueRefundRequest(
      venueId,
      reservationId,
      dto,
    );
  }

  @Post("customers/venues/:venueId/request")
  @UseGuards(JwtAuthGuard)
  requestCustomerReservation(
    @Param("venueId") venueId: string,
    @Body() dto: CreateReservationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservationsService.createCustomerReservation(
      request.user.userId,
      venueId,
      dto,
    );
  }

  @Post("customers/me/reservations/:reservationId/problem-report")
  @UseGuards(JwtAuthGuard)
  createCustomerProblemReport(
    @Param("reservationId") reservationId: string,
    @Body() dto: CreateCustomerProblemReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.createCustomerProblemReport(
      reservationId,
      request.user.userId,
      dto,
    );
  }

  @Post("customers/me/reservations/:reservationId/time-change-requests")
  @UseGuards(JwtAuthGuard)
  createCustomerReservationTimeChangeRequest(
    @Param("reservationId") reservationId: string,
    @Body() dto: CreateReservationTimeChangeRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservationsService.createCustomerReservationTimeChangeRequest(
      request.user.userId,
      reservationId,
      dto,
    );
  }

  @Post(
    "customers/me/reservations/:reservationId/problem-report-photo-upload-url",
  )
  @UseGuards(JwtAuthGuard)
  createCustomerProblemReportPhotoUploadUrl(
    @Param("reservationId") reservationId: string,
    @Body() dto: CreateCustomerProblemReportPhotoUploadUrlDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.createCustomerProblemReportPhotoUploadUrl(
      reservationId,
      request.user.userId,
      dto,
    );
  }

  @Get("preview/venues/:venueId")
  listVenueReservations(
    @Param("venueId") venueId: string,
    @Query() query: VenueReservationsQueryDto,
  ) {
    return this.reservationsService.listVenueReservations(venueId, query);
  }

  @Get("preview/venues/:venueId/history")
  listVenueReservationHistory(
    @Param("venueId") venueId: string,
    @Query() query: VenueReservationsQueryDto,
  ) {
    return this.reservationsService.listVenueReservationHistory(venueId, query);
  }

  @Get("preview/venues/:venueId/requests")
  listPendingVenueReservationRequests(@Param("venueId") venueId: string) {
    return this.reservationsService.listPendingVenueReservationRequests(
      venueId,
    );
  }

  @Get("preview/venues/:venueId/reserved-table-ids")
  listVenueReservedTableIds(
    @Param("venueId") venueId: string,
    @Query() query: VenueReservationsQueryDto,
  ) {
    return this.reservationsService.listVenueReservedTableIds(venueId, query);
  }

  @Sse("preview/venues/:venueId/live-sync")
  streamVenueLiveSync(@Param("venueId") venueId: string) {
    return this.reservationsService.streamVenueLiveSync(venueId);
  }

  @Get("preview/customers/reservations/history")
  listCustomerReservationHistory(
    @Query("customerEmail") customerEmail?: string,
    @Query() query: VenueReservationsQueryDto = {},
  ) {
    return this.reservationsService.listCustomerReservations(
      customerEmail,
      query,
      { historyOnly: true },
    );
  }

  @Get("preview/customers/reservations")
  listCustomerReservations(
    @Query("customerEmail") customerEmail?: string,
    @Query() query: VenueReservationsQueryDto = {},
  ) {
    return this.reservationsService.listCustomerReservations(
      customerEmail,
      query,
    );
  }

  @Get("customers/me/reservations")
  @UseGuards(JwtAuthGuard)
  listCurrentCustomerReservations(
    @Query() query: VenueReservationsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservationsService.listCustomerReservationsForUser(
      request.user.userId,
      query,
    );
  }

  @Get("customers/me/reservations/history")
  @UseGuards(JwtAuthGuard)
  listCurrentCustomerReservationHistory(
    @Query() query: VenueReservationsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservationsService.listCustomerReservationHistoryForUser(
      request.user.userId,
      query,
    );
  }

  @Get("preview/admin/monitoring")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  listReservationMonitoring(
    @Query("status") status?: string,
    @Query("venueId") venueId?: string,
  ) {
    return this.reservationsService.listReservationMonitoring({
      status,
      venueId,
    });
  }

  @Get("preview/admin/customers/risk")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  listAdminCustomerRiskUsers() {
    return this.reservationsService.listAdminCustomerRiskUsers();
  }

  @Post("preview/admin/customers/:customerId/block")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN)
  adminBlockCustomer(
    @Param("customerId") customerId: string,
    @Body("reason") reason?: string,
  ) {
    return this.reservationsService.adminBlockCustomer(customerId, reason);
  }

  @Delete("preview/admin/customers/:customerId/block")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN)
  adminUnblockCustomer(@Param("customerId") customerId: string) {
    return this.reservationsService.adminUnblockCustomer(customerId);
  }

  @Post("preview/admin/:id/cancel")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN)
  adminCancelReservation(
    @Param("id") id: string,
    @Body() dto: DeclineReservationDto,
  ) {
    return this.reservationsService.adminCancelReservation(id, dto);
  }

  @Delete("preview/admin/:id")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN)
  adminDeleteReservation(@Param("id") id: string) {
    return this.reservationsService.adminDeleteReservation(id);
  }

  @Post("preview/admin/:id/customer-check-in")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN)
  adminCustomerCheckInReservation(@Param("id") id: string) {
    return this.reservationsService.adminCustomerCheckInReservation(id);
  }

  @Post("preview/admin/:id/venue-check-in")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN)
  adminVenueCheckInReservation(@Param("id") id: string) {
    return this.reservationsService.adminVenueCheckInReservation(id);
  }

  @Get("preview/venues/:venueId/live-status")
  getVenueLiveStatus(@Param("venueId") venueId: string) {
    return this.reservationsService.getVenueLiveStatus(venueId);
  }

  @Get("preview/venues/:venueId/settings")
  getVenueReservationSettings(@Param("venueId") venueId: string) {
    return this.reservationsService.getVenueReservationSettings(venueId);
  }

  @Patch("preview/venues/:venueId/settings")
  updateVenueReservationSettings(
    @Param("venueId") venueId: string,
    @Body() dto: UpdateVenueReservationSettingsDto,
  ) {
    return this.reservationsService.updateVenueReservationSettings(
      venueId,
      dto,
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

  @Get("preview/:id")
  getReservation(@Param("id") id: string) {
    return this.reservationsService.getReservation(id);
  }

  @Post("preview/:id/accept")
  acceptReservation(@Param("id") id: string) {
    return this.reservationsService.acceptReservation(id);
  }

  @Post("preview/time-change-requests/:requestId/accept")
  acceptReservationTimeChangeRequest(@Param("requestId") requestId: string) {
    return this.reservationsService.acceptReservationTimeChangeRequest(
      requestId,
    );
  }

  @Post("preview/time-change-requests/:requestId/decline")
  declineReservationTimeChangeRequest(@Param("requestId") requestId: string) {
    return this.reservationsService.declineReservationTimeChangeRequest(
      requestId,
    );
  }

  @Post("preview/:id/check-in")
  checkInReservation(@Param("id") id: string) {
    return this.reservationsService.checkInReservation(id);
  }

  @Post("preview/:id/customer-check-in")
  customerCheckInReservation(@Param("id") id: string) {
    return this.reservationsService.customerCheckInReservation(id);
  }

  @Post("preview/:id/customer-cancel")
  cancelReservationByCustomer(
    @Param("id") id: string,
    @Body() dto: DeclineReservationDto,
  ) {
    return this.reservationsService.cancelReservationByCustomer(id, dto);
  }

  @Post("preview/:id/decline")
  declineReservation(
    @Param("id") id: string,
    @Body() dto: DeclineReservationDto,
  ) {
    return this.reservationsService.declineReservation(id, dto);
  }

  @Post("preview/:id/venue-cancel")
  cancelReservationByVenue(
    @Param("id") id: string,
    @Body() dto: DeclineReservationDto,
  ) {
    return this.reservationsService.cancelReservationByVenue(id, dto);
  }
}

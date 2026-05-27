import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { AdminManualRefundDto } from "./dto/admin-manual-refund.dto";
import { CreateReservationCheckoutDto } from "./dto/create-reservation-checkout.dto";
import { WorldlineWebhookDto } from "./dto/worldline-webhook.dto";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("preview/reservations/:reservationId/checkout")
  createReservationCheckout(
    @Param("reservationId") reservationId: string,
    @Body() dto: CreateReservationCheckoutDto,
  ) {
    return this.paymentsService.createReservationCheckout(reservationId, dto);
  }

  @Get("preview/reservations/:reservationId")
  getReservationPaymentSummary(@Param("reservationId") reservationId: string) {
    return this.paymentsService.getReservationPaymentSummary(reservationId);
  }

  @Get("preview/venues/:venueId/earnings")
  getVenueEarnings(@Param("venueId") venueId: string) {
    return this.paymentsService.getVenueEarnings(venueId);
  }

  @Get("preview/admin/transactions")
  listAdminPaymentTransactions() {
    return this.paymentsService.listAdminPaymentTransactions();
  }

  @Post("preview/admin/reservations/:reservationId/refund")
  adminManualRefund(
    @Param("reservationId") reservationId: string,
    @Body() dto: AdminManualRefundDto,
  ) {
    return this.paymentsService.adminManualRefund(reservationId, dto);
  }

  @Post("preview/reservations/:reservationId/mock-authorize")
  mockAuthorizeReservationPayment(
    @Param("reservationId") reservationId: string,
  ) {
    return this.paymentsService.mockAuthorizeReservationPayment(reservationId);
  }

  @Post("webhooks/worldline")
  handleWorldlineWebhook(
    @Body() dto: WorldlineWebhookDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.paymentsService.handleWorldlineWebhook(dto, headers);
  }
}

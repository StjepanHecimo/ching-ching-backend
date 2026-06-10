import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AdminManualRefundDto } from "./dto/admin-manual-refund.dto";
import { CreateReservationCheckoutDto } from "./dto/create-reservation-checkout.dto";
import { CreateTestPaymentMethodDto } from "./dto/create-test-payment-method.dto";
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

  @Post("customers/me/reservations/:reservationId/checkout")
  @UseGuards(JwtAuthGuard)
  createCustomerReservationCheckout(
    @Param("reservationId") reservationId: string,
    @Body() dto: CreateReservationCheckoutDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.createReservationCheckout(
      reservationId,
      dto,
      request.user.userId,
    );
  }

  @Get("customers/me/payment-methods")
  @UseGuards(JwtAuthGuard)
  listCustomerPaymentMethods(@Req() request: AuthenticatedRequest) {
    return this.paymentsService.listCustomerPaymentMethods(request.user.userId);
  }

  @Post("customers/me/payment-methods/test-card")
  @UseGuards(JwtAuthGuard)
  createTestCustomerPaymentMethod(
    @Body() dto: CreateTestPaymentMethodDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.createTestCustomerPaymentMethod(
      request.user.userId,
      dto,
    );
  }

  @Post("customers/me/payment-methods/checkout")
  @UseGuards(JwtAuthGuard)
  createCustomerPaymentMethodCheckout(@Req() request: AuthenticatedRequest) {
    return this.paymentsService.createCustomerPaymentMethodCheckout(
      request.user.userId,
    );
  }

  @Post("customers/me/payment-methods/assert")
  @UseGuards(JwtAuthGuard)
  assertCustomerPaymentMethodCheckout(
    @Body() dto: { token?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.assertCustomerPaymentMethodCheckout(
      request.user.userId,
      dto.token ?? "",
    );
  }

  @Patch("customers/me/payment-methods/:paymentMethodId/default")
  @UseGuards(JwtAuthGuard)
  setDefaultCustomerPaymentMethod(
    @Param("paymentMethodId") paymentMethodId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.setDefaultCustomerPaymentMethod(
      request.user.userId,
      paymentMethodId,
    );
  }

  @Delete("customers/me/payment-methods/:paymentMethodId")
  @UseGuards(JwtAuthGuard)
  disableCustomerPaymentMethod(
    @Param("paymentMethodId") paymentMethodId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.disableCustomerPaymentMethod(
      request.user.userId,
      paymentMethodId,
    );
  }

  @Get("preview/reservations/:reservationId")
  getReservationPaymentSummary(@Param("reservationId") reservationId: string) {
    return this.paymentsService.getReservationPaymentSummary(reservationId);
  }

  @Post("preview/reservations/:reservationId/assert")
  assertPreviewReservationCheckout(
    @Param("reservationId") reservationId: string,
    @Body() dto: { token?: string },
  ) {
    return this.paymentsService.assertReservationCheckout(
      reservationId,
      dto.token,
    );
  }

  @Post("customers/me/reservations/:reservationId/assert")
  @UseGuards(JwtAuthGuard)
  assertCustomerReservationCheckout(
    @Param("reservationId") reservationId: string,
    @Body() dto: { token?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.assertReservationCheckout(
      reservationId,
      dto.token,
      request.user.userId,
    );
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

  @Post("preview/admin/ledger/backfill-captured-payments")
  backfillCapturedPaymentLedger() {
    return this.paymentsService.backfillCapturedPaymentLedger();
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

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AdminManualRefundDto } from "./dto/admin-manual-refund.dto";
import { CreateReservationCheckoutDto } from "./dto/create-reservation-checkout.dto";
import { CreateTestPaymentMethodDto } from "./dto/create-test-payment-method.dto";
import { CreateVenueRefundRequestDto } from "./dto/create-venue-refund-request.dto";
import { ResolveVenueProblemReportDto } from "./dto/resolve-venue-problem-report.dto";
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

  @Get("preview/admin/problem-reports")
  listAdminVenueProblemReports() {
    return this.paymentsService.listAdminVenueProblemReports();
  }

  @Patch("preview/admin/problem-reports/:requestId/response")
  sendVenueProblemReportResponse(
    @Param("requestId") requestId: string,
    @Body() dto: ResolveVenueProblemReportDto,
  ) {
    return this.paymentsService.markVenueProblemReportRefundedByChinChin(
      requestId,
      dto,
    );
  }

  @Patch("preview/admin/problem-reports/:requestId/refunded-by-chin-chin")
  markVenueProblemReportRefundedByChinChin(
    @Param("requestId") requestId: string,
    @Body() dto: ResolveVenueProblemReportDto,
  ) {
    return this.paymentsService.markVenueProblemReportRefundedByChinChin(
      requestId,
      dto,
    );
  }

  @Post("preview/admin/reservations/:reservationId/refund")
  adminManualRefund(
    @Param("reservationId") reservationId: string,
    @Body() dto: AdminManualRefundDto,
  ) {
    return this.paymentsService.adminManualRefund(reservationId, dto);
  }

  @Post("preview/venues/:venueId/reservations/:reservationId/refund-request")
  createVenueRefundRequest(
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

  @Get("returns/saferpay/payment-method")
  handleSaferpayPaymentMethodReturn(
    @Query() query: Record<string, unknown>,
    @Res() response: any,
  ) {
    const queryString = this.queryStringFromRecord(query);
    const targetUrl = `chinchincustomer://payment-method-return/saferpay${
      queryString ? `?${queryString}` : ""
    }`;
    return this.sendCustomerAppReturnPage(
      response,
      targetUrl,
      "Vracamo te u Chin-Chin aplikaciju.",
    );
  }

  @Get("returns/saferpay/reservation")
  handleSaferpayReservationReturn(
    @Query() query: Record<string, unknown>,
    @Res() response: any,
  ) {
    const queryString = this.queryStringFromRecord(query);
    const targetUrl = `chinchincustomer://payment-return/saferpay${
      queryString ? `?${queryString}` : ""
    }`;
    return this.sendCustomerAppReturnPage(
      response,
      targetUrl,
      "Vracamo te na rezervaciju.",
    );
  }

  private queryStringFromRecord(query: Record<string, unknown>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) {
            params.append(key, String(item));
          }
        }
        continue;
      }
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    return params.toString();
  }

  private sendCustomerAppReturnPage(
    response: any,
    targetUrl: string,
    message: string,
  ) {
    const encodedTargetUrl = JSON.stringify(targetUrl);
    const escapedTargetUrl = targetUrl.replace(/"/g, "&quot;");
    return response.type("html").send(`<!doctype html>
<html lang="hr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chin-Chin</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff8ea; color: #191511; }
    main { width: min(90vw, 420px); text-align: center; }
    a { display: inline-block; margin-top: 18px; padding: 12px 18px; border-radius: 999px; background: #191511; color: white; text-decoration: none; font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <h1>Chin-Chin</h1>
    <p>${message}</p>
    <a href="${escapedTargetUrl}">Otvori aplikaciju</a>
  </main>
  <script>
    window.location.href = ${encodedTargetUrl};
  </script>
</body>
</html>`);
  }
}

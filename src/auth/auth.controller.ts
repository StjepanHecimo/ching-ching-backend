import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedRequest } from "./authenticated-request";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";
import { RegisterVenueOwnerDto } from "./dto/register-venue-owner.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { UpdateCustomerProfileDto } from "./dto/update-customer-profile.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AdminRolesGuard } from "./guards/admin-roles.guard";

type RequestIpSource = {
  headers: Record<string, string | string[] | undefined>;
  socket: {
    remoteAddress?: string;
  };
};

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterVenueOwnerDto) {
    return this.authService.registerVenueOwner(dto);
  }

  @Post("register-customer")
  registerCustomer(@Body() dto: RegisterCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  @Get("verify-email")
  verifyEmailLink(@Query("token") token: string) {
    return this.authService.verifyEmailToken(token);
  }

  @Post("verify-email")
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post("resend-verification")
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Post("request-login-verification")
  requestLoginVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.requestLoginVerification(dto);
  }

  @Post("request-login-vertification")
  requestLoginVertificationAlias(@Body() dto: ResendVerificationDto) {
    return this.authService.requestLoginVerification(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("admin/login")
  adminLogin(@Body() dto: LoginDto, @Req() request: RequestIpSource) {
    return this.authService.adminLogin(dto, getRequestIpAddress(request));
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.user.userId);
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  updateMe(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    return this.authService.updateCustomerProfile(request.user.userId, dto);
  }

  @Get("admin/me")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  adminMe(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.user.userId);
  }
}

function getRequestIpAddress(request: RequestIpSource) {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(",")[0]?.trim();
  }
  return request.socket.remoteAddress;
}

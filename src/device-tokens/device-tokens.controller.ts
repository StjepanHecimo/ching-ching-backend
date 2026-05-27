import { Body, Controller, Delete, Post, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DeviceTokensService } from "./device-tokens.service";
import { UpsertDeviceTokenDto } from "./dto/upsert-device-token.dto";

@Controller("device-tokens")
@UseGuards(JwtAuthGuard)
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  @Post()
  upsert(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpsertDeviceTokenDto,
  ) {
    return this.deviceTokensService.upsertForUser(request.user.userId, dto);
  }

  @Delete()
  disable(
    @Req() request: AuthenticatedRequest,
    @Body() dto: Pick<UpsertDeviceTokenDto, "token">,
  ) {
    return this.deviceTokensService.disableForUser(
      request.user.userId,
      dto.token,
    );
  }
}

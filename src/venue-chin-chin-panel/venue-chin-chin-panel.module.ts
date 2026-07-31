import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { PrismaModule } from "../prisma/prisma.module";
import { VenueEventNotificationScheduler } from "./venue-event-notification.scheduler";
import { VenueChinChinPanelController } from "./venue-chin-chin-panel.controller";
import { VenueChinChinPanelService } from "./venue-chin-chin-panel.service";

@Module({
  imports: [JwtModule.register({}), PrismaModule, DeviceTokensModule],
  controllers: [VenueChinChinPanelController],
  providers: [
    VenueChinChinPanelService,
    VenueEventNotificationScheduler,
    JwtAuthGuard,
  ],
})
export class VenueChinChinPanelModule {}

import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { VenueChinChinPanelController } from "./venue-chin-chin-panel.controller";
import { VenueChinChinPanelService } from "./venue-chin-chin-panel.service";

@Module({
  imports: [PrismaModule],
  controllers: [VenueChinChinPanelController],
  providers: [VenueChinChinPanelService],
})
export class VenueChinChinPanelModule {}

import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { MonitoringModule } from "../monitoring/monitoring.module";
import { PrismaModule } from "../prisma/prisma.module";
import { DeviceTokensController } from "./device-tokens.controller";
import { DeviceTokensService } from "./device-tokens.service";

@Module({
  imports: [JwtModule.register({}), PrismaModule, MonitoringModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService],
  exports: [DeviceTokensService],
})
export class DeviceTokensModule {}

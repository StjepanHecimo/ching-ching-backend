import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../prisma/prisma.module";
import { DeviceTokensController } from "./device-tokens.controller";
import { DeviceTokensService } from "./device-tokens.service";

@Module({
  imports: [JwtModule.register({}), PrismaModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService],
  exports: [DeviceTokensService],
})
export class DeviceTokensModule {}

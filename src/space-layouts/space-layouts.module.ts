import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminRolesGuard } from "../auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { EmailModule } from "../email/email.module";
import { SpaceLayoutsPreviewController } from "./space-layouts-preview.controller";
import { SpaceLayoutsController } from "./space-layouts.controller";
import { SpaceLayoutsService } from "./space-layouts.service";

@Module({
  imports: [JwtModule.register({}), EmailModule, DeviceTokensModule],
  controllers: [SpaceLayoutsController, SpaceLayoutsPreviewController],
  providers: [SpaceLayoutsService, JwtAuthGuard, AdminRolesGuard],
})
export class SpaceLayoutsModule {}

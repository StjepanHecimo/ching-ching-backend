import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SpaceLayoutsPreviewController } from "./space-layouts-preview.controller";
import { SpaceLayoutsController } from "./space-layouts.controller";
import { SpaceLayoutsService } from "./space-layouts.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [SpaceLayoutsController, SpaceLayoutsPreviewController],
  providers: [SpaceLayoutsService, JwtAuthGuard],
})
export class SpaceLayoutsModule {}

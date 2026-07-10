import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminRolesGuard } from "../auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { PrismaModule } from "../prisma/prisma.module";
import { VenueDocumentsController } from "./venue-documents.controller";
import { VenueDocumentsService } from "./venue-documents.service";

@Module({
  imports: [JwtModule.register({}), PrismaModule, DeviceTokensModule],
  controllers: [VenueDocumentsController],
  providers: [VenueDocumentsService, JwtAuthGuard, AdminRolesGuard],
})
export class VenueDocumentsModule {}

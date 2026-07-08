import { Module } from "@nestjs/common";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { PrismaModule } from "../prisma/prisma.module";
import { VenueDocumentsController } from "./venue-documents.controller";
import { VenueDocumentsService } from "./venue-documents.service";

@Module({
  imports: [PrismaModule, DeviceTokensModule],
  controllers: [VenueDocumentsController],
  providers: [VenueDocumentsService],
})
export class VenueDocumentsModule {}

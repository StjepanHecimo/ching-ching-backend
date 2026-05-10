import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { VenueDocumentsController } from "./venue-documents.controller";
import { VenueDocumentsService } from "./venue-documents.service";

@Module({
  imports: [PrismaModule],
  controllers: [VenueDocumentsController],
  providers: [VenueDocumentsService],
})
export class VenueDocumentsModule {}

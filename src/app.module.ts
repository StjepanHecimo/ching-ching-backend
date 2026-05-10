import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SpaceLayoutsModule } from "./space-layouts/space-layouts.module";
import { VenueDocumentsModule } from "./venue-documents/venue-documents.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    SpaceLayoutsModule,
    VenueDocumentsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

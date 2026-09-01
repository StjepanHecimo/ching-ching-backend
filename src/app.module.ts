import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { DeviceTokensModule } from "./device-tokens/device-tokens.module";
import { ApiExceptionFilter } from "./monitoring/api-exception.filter";
import { MonitoringModule } from "./monitoring/monitoring.module";
import { PrismaModule } from "./prisma/prisma.module";
import { PaymentsModule } from "./payments/payments.module";
import { ReservationsModule } from "./reservations/reservations.module";
import { SpaceLayoutsModule } from "./space-layouts/space-layouts.module";
import { VenueChinChinPanelModule } from "./venue-chin-chin-panel/venue-chin-chin-panel.module";
import { VenueDocumentsModule } from "./venue-documents/venue-documents.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.register({}),
    MonitoringModule,
    PrismaModule,
    AuthModule,
    DeviceTokensModule,
    PaymentsModule,
    SpaceLayoutsModule,
    VenueDocumentsModule,
    ReservationsModule,
    VenueChinChinPanelModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule {}

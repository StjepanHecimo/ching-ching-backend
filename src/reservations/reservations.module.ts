import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminRolesGuard } from "../auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { EmailModule } from "../email/email.module";
import { PaymentsModule } from "../payments/payments.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReservationCleanupScheduler } from "./reservation-cleanup.scheduler";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";

@Module({
  imports: [
    JwtModule.register({}),
    PrismaModule,
    PaymentsModule,
    DeviceTokensModule,
    EmailModule,
  ],
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    ReservationCleanupScheduler,
    JwtAuthGuard,
    AdminRolesGuard,
  ],
})
export class ReservationsModule {}

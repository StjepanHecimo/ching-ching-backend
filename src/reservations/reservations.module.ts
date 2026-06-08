import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { EmailModule } from "../email/email.module";
import { PaymentsModule } from "../payments/payments.module";
import { PrismaModule } from "../prisma/prisma.module";
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
  providers: [ReservationsService, JwtAuthGuard],
})
export class ReservationsModule {}

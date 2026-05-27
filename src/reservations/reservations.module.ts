import { Module } from "@nestjs/common";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { PaymentsModule } from "../payments/payments.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";

@Module({
  imports: [PrismaModule, PaymentsModule, DeviceTokensModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}

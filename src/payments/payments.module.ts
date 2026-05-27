import { Module } from "@nestjs/common";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { WorldlinePaymentProvider } from "./worldline-payment.provider";

@Module({
  imports: [PrismaModule, DeviceTokensModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, WorldlinePaymentProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}

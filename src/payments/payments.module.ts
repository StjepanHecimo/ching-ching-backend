import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminRolesGuard } from "../auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DeviceTokensModule } from "../device-tokens/device-tokens.module";
import { EmailModule } from "../email/email.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { WorldlinePaymentProvider } from "./worldline-payment.provider";

@Module({
  imports: [
    JwtModule.register({}),
    PrismaModule,
    DeviceTokensModule,
    EmailModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    WorldlinePaymentProvider,
    JwtAuthGuard,
    AdminRolesGuard,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}

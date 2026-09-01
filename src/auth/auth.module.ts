import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { EmailModule } from "../email/email.module";
import { SmsModule } from "../sms/sms.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AdminRolesGuard } from "./guards/admin-roles.guard";

@Module({
  imports: [JwtModule.register({}), EmailModule, SmsModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, AdminRolesGuard],
  exports: [JwtAuthGuard, AdminRolesGuard],
})
export class AuthModule {}

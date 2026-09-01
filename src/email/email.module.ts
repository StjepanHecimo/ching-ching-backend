import { Module } from "@nestjs/common";
import { MonitoringModule } from "../monitoring/monitoring.module";
import { EmailService } from "./email.service";

@Module({
  imports: [MonitoringModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}

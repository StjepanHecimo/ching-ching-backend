import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { Transporter } from "nodemailer";

export type OperationalEventLevel = "info" | "warning" | "error";

export type OperationalEvent = {
  id: string;
  level: OperationalEventLevel;
  source: string;
  message: string;
  createdAt: string;
  details?: Record<string, string | number | boolean | null>;
};

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly events: OperationalEvent[] = [];
  private readonly maxEvents = 50;
  private readonly alertCooldownMs = 15 * 60 * 1000;
  private readonly lastAlertSentAt = new Map<string, number>();
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  record(event: Omit<OperationalEvent, "id" | "createdAt">) {
    const nextEvent: OperationalEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };

    this.events.unshift(nextEvent);
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }

    if (nextEvent.level === "error") {
      void this.sendCriticalAlert(nextEvent);
    }
  }

  recentEvents() {
    return [...this.events];
  }

  private async sendCriticalAlert(event: OperationalEvent) {
    const to =
      this.configService.get<string>("MONITORING_ALERT_EMAIL")?.trim() ||
      "stjepanhecimo@hotmail.com";
    const alertKey = `${event.source}:${event.message}`;
    const now = Date.now();
    const lastSentAt = this.lastAlertSentAt.get(alertKey) ?? 0;

    if (now - lastSentAt < this.alertCooldownMs) {
      return;
    }

    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(
        `Critical monitoring alert could not be sent because SMTP is not configured: ${event.source} ${event.message}`,
      );
      return;
    }

    try {
      await transporter.sendMail({
        from: this.alertFrom(),
        to,
        subject: `Chin-Chin kritični alert: ${event.source}`,
        text: [
          "Chin-Chin kritični monitoring alert",
          "",
          `Izvor: ${event.source}`,
          `Poruka: ${event.message}`,
          `Vrijeme: ${event.createdAt}`,
          "",
          "Detalji:",
          this.formatDetails(event.details),
        ].join("\n"),
      });
      this.lastAlertSentAt.set(alertKey, now);
    } catch (error) {
      this.logger.warn(
        `Critical monitoring alert email failed: ${
          error instanceof Error ? error.message : "SMTP error"
        }`,
      );
    }
  }

  private getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.configService.get<string>("SMTP_HOST");
    const port = Number(this.configService.get<string>("SMTP_PORT") ?? 587);
    const user = this.configService.get<string>("SMTP_USER");
    const pass = this.configService.get<string>("SMTP_PASS");

    if (!host || !user || !pass) {
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    return this.transporter;
  }

  private alertFrom() {
    return (
      this.configService.get<string>("EMAIL_NO_REPLY_FROM") ??
      this.configService.get<string>("EMAIL_FROM") ??
      "Chin-Chin Monitoring <no-reply@chin-chin.hr>"
    );
  }

  private formatDetails(
    details?: Record<string, string | number | boolean | null>,
  ) {
    if (!details || Object.keys(details).length === 0) {
      return "-";
    }

    return Object.entries(details)
      .filter(([, value]) => value !== null && value !== "")
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }
}

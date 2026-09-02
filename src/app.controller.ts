import { Controller, Get, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { cpus, freemem, loadavg, totalmem, uptime } from "node:os";
import { statfsSync } from "node:fs";
import { Prisma } from "../generated/prisma/client";
import { UserRole } from "../generated/prisma/enums";
import { AdminRoles } from "./auth/decorators/admin-roles.decorator";
import { AdminRolesGuard } from "./auth/guards/admin-roles.guard";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { MonitoringService } from "./monitoring/monitoring.service";
import { PrismaService } from "./prisma/prisma.service";

type MonitoringStatus = "ok" | "warning" | "error";

type MonitoringCheck = {
  key: string;
  label: string;
  status: MonitoringStatus;
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

@Controller()
export class AppController {
  constructor(
    private readonly configService: ConfigService,
    private readonly monitoringService: MonitoringService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("health")
  health() {
    return {
      status: "ok",
      service: "chin-chin-backend",
    };
  }

  @Get("admin/monitoring")
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @AdminRoles(UserRole.ADMIN, UserRole.CHIN_CHIN_SUPPORT)
  async adminMonitoring() {
    const checks: MonitoringCheck[] = [
      await this.getDatabaseCheck(),
      this.getApiProcessCheck(),
      this.getMemoryCheck(),
      this.getCpuCheck(),
      this.getDiskCheck(),
      this.getConfigCheck("push", "Push notifikacije", [
        "FCM_PROJECT_ID",
        "FCM_SERVICE_ACCOUNT_JSON",
      ]),
      this.getConfigCheck("email", "Email slanje", [
        "SMTP_HOST",
        "SMTP_USER",
        "SMTP_PASS",
      ]),
      this.getConfigCheck("storage", "Cloudflare R2 / slike", [
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_PUBLIC_BASE_URL",
      ]),
      this.getPaymentConfigCheck(),
    ];

    const status = checks.some((check) => check.status === "error")
      ? "error"
      : checks.some((check) => check.status === "warning")
        ? "warning"
        : "ok";

    checks
      .filter((check) => check.status === "error")
      .forEach((check) => {
        this.monitoringService.record({
          level: "error",
          source: check.key,
          message: check.message,
          details: check.details,
        });
      });

    return {
      status,
      service: "chin-chin-backend",
      generatedAt: new Date().toISOString(),
      checks,
      events: this.monitoringService.recentEvents(),
    };
  }

  private async getDatabaseCheck(): Promise<MonitoringCheck> {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      const latencyMs = Date.now() - startedAt;
      return {
        key: "database",
        label: "Baza podataka",
        status: latencyMs > 750 ? "warning" : "ok",
        message:
          latencyMs > 750
            ? "Baza odgovara, ali sporije nego očekivano."
            : "Baza je dostupna.",
        details: { latencyMs },
      };
    } catch {
      return {
        key: "database",
        label: "Baza podataka",
        status: "error",
        message: "API se trenutačno ne može spojiti na bazu.",
      };
    }
  }

  private getApiProcessCheck(): MonitoringCheck {
    const processUptimeSeconds = Math.round(process.uptime());
    const hostUptimeSeconds = Math.round(uptime());
    const memory = process.memoryUsage();

    return {
      key: "api",
      label: "API proces",
      status: "ok",
      message: "API proces radi.",
      details: {
        processUptimeSeconds,
        hostUptimeSeconds,
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      },
    };
  }

  private getMemoryCheck(): MonitoringCheck {
    const totalBytes = totalmem();
    const freeBytes = freemem();
    const usedRatio =
      totalBytes > 0 ? (totalBytes - freeBytes) / totalBytes : 0;
    const usedPercent = Math.round(usedRatio * 100);
    const status: MonitoringStatus =
      usedRatio >= 0.93 ? "error" : usedRatio >= 0.82 ? "warning" : "ok";

    return {
      key: "memory",
      label: "RAM",
      status,
      message:
        status === "ok"
          ? "Memorija je u sigurnom rasponu."
          : status === "warning"
            ? "RAM je povišen, vrijedi pratiti server."
            : "RAM je kritično visok.",
      details: {
        usedPercent,
        freeMb: Math.round(freeBytes / 1024 / 1024),
        totalMb: Math.round(totalBytes / 1024 / 1024),
      },
    };
  }

  private getCpuCheck(): MonitoringCheck {
    const oneMinuteLoad = loadavg()[0] ?? 0;
    const coreCount = Math.max(1, cpus().length);
    const pressure = oneMinuteLoad / coreCount;
    const status: MonitoringStatus =
      pressure >= 2 ? "error" : pressure >= 1.2 ? "warning" : "ok";

    return {
      key: "cpu",
      label: "CPU",
      status,
      message:
        status === "ok"
          ? "CPU opterećenje je normalno."
          : status === "warning"
            ? "CPU je povišen."
            : "CPU je kritično opterećen.",
      details: {
        oneMinuteLoad: Number(oneMinuteLoad.toFixed(2)),
        cores: coreCount,
        loadPerCore: Number(pressure.toFixed(2)),
      },
    };
  }

  private getDiskCheck(): MonitoringCheck {
    try {
      const disk = statfsSync(process.cwd());
      const totalBytes = disk.blocks * disk.bsize;
      const freeBytes = disk.bfree * disk.bsize;
      const usedRatio =
        totalBytes > 0 ? (totalBytes - freeBytes) / totalBytes : 0;
      const usedPercent = Math.round(usedRatio * 100);
      const status: MonitoringStatus =
        usedRatio >= 0.92 ? "error" : usedRatio >= 0.8 ? "warning" : "ok";

      return {
        key: "disk",
        label: "Disk",
        status,
        message:
          status === "ok"
            ? "Disk ima dovoljno prostora."
            : status === "warning"
              ? "Disk se puni, treba ga pratiti."
              : "Disk je skoro pun.",
        details: {
          usedPercent,
          freeGb: Number((freeBytes / 1024 / 1024 / 1024).toFixed(1)),
          totalGb: Number((totalBytes / 1024 / 1024 / 1024).toFixed(1)),
        },
      };
    } catch {
      return {
        key: "disk",
        label: "Disk",
        status: "warning",
        message: "Nije moguće očitati stanje diska iz API procesa.",
      };
    }
  }

  private getConfigCheck(
    key: string,
    label: string,
    envKeys: string[],
  ): MonitoringCheck {
    const missing = envKeys.filter(
      (envKey) => !this.configService.get<string>(envKey)?.trim(),
    );

    return {
      key,
      label,
      status: missing.length ? "warning" : "ok",
      message: missing.length
        ? "Nedostaje dio konfiguracije. Provjeri server env varijable."
        : "Konfiguracija je postavljena.",
      details: {
        configured: envKeys.length - missing.length,
        total: envKeys.length,
        missing: missing.join(", ") || null,
      },
    };
  }

  private getPaymentConfigCheck(): MonitoringCheck {
    const worldlineMode =
      this.configService.get<string>("WORLDLINE_MODE") ??
      this.configService.get<string>("SAFERPAY_MODE") ??
      "mock";
    const isMock = worldlineMode.toLowerCase() === "mock";
    const requiredKeys = [
      "SAFERPAY_CUSTOMER_ID",
      "SAFERPAY_TERMINAL_ID",
      "SAFERPAY_API_USERNAME",
      "SAFERPAY_API_PASSWORD",
    ];
    const missing = requiredKeys.filter(
      (envKey) => !this.configService.get<string>(envKey)?.trim(),
    );

    return {
      key: "payments",
      label: "Worldline / plaćanja",
      status: isMock ? "warning" : missing.length ? "warning" : "ok",
      message: isMock
        ? "Plaćanja su u mock modu."
        : missing.length
          ? "Nedostaje dio payment konfiguracije."
          : "Payment konfiguracija je postavljena.",
      details: {
        mode: worldlineMode,
        configured: requiredKeys.length - missing.length,
        total: requiredKeys.length,
        missing: missing.join(", ") || null,
      },
    };
  }
}

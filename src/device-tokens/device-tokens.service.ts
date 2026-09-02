import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DevicePushApp,
  DevicePushPlatform,
  PushNotificationStatus,
} from "../../generated/prisma/enums";
import { MonitoringService } from "../monitoring/monitoring.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertDeviceTokenDto } from "./dto/upsert-device-token.dto";

const CUSTOMER_ANDROID_NOTIFICATION_CHANNEL_ID = "chin_chin_customer_high";
const VENUE_ANDROID_NOTIFICATION_CHANNEL_ID = "chin_chin_venue_high";

type PushPayload = {
  userId: string;
  app?: DevicePushApp;
  title: string;
  body: string;
  data?: Record<string, string>;
};

@Injectable()
export class DeviceTokensService {
  private fcmAccessToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly monitoringService: MonitoringService,
  ) {}

  async upsertForUser(userId: string, dto: UpsertDeviceTokenDto) {
    const token = dto.token.trim();
    const platform = (dto.platform ?? "UNKNOWN") as DevicePushPlatform;
    const app = dto.app as DevicePushApp;

    const row = await this.prisma.devicePushToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform,
        app,
        deviceId: dto.deviceId?.trim(),
        appVersion: dto.appVersion?.trim(),
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        platform,
        app,
        deviceId: dto.deviceId?.trim(),
        appVersion: dto.appVersion?.trim(),
        lastSeenAt: new Date(),
        disabledAt: null,
      },
    });

    return this.serializeToken(row);
  }

  async disableForUser(userId: string, token: string) {
    await this.prisma.devicePushToken.updateMany({
      where: { userId, token },
      data: { disabledAt: new Date() },
    });

    return { ok: true };
  }

  async sendToUser(payload: PushPayload) {
    const tokens = await this.prisma.devicePushToken.findMany({
      where: {
        userId: payload.userId,
        ...(payload.app ? { app: payload.app } : {}),
        disabledAt: null,
      },
      orderBy: { lastSeenAt: "desc" },
    });

    if (!tokens.length) {
      await this.prisma.pushNotificationLog.create({
        data: {
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
          status: PushNotificationStatus.SKIPPED,
          error: "No active device push token.",
        },
      });
      return { sent: 0, skipped: 1 };
    }

    let sent = 0;
    let queued = 0;
    let failed = 0;

    for (const token of tokens) {
      const log = await this.prisma.pushNotificationLog.create({
        data: {
          userId: payload.userId,
          deviceTokenId: token.id,
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
          status: PushNotificationStatus.PENDING,
        },
      });

      const result = await this.sendFcmNotification(token.token, payload);
      if (result === "queued") {
        queued += 1;
        continue;
      }

      if (result === "sent") {
        sent += 1;
        await this.prisma.pushNotificationLog.update({
          where: { id: log.id },
          data: { status: PushNotificationStatus.SENT, sentAt: new Date() },
        });
        continue;
      }

      failed += 1;
      const invalidDeviceToken = this.isInvalidFcmDeviceTokenError(result);
      await this.prisma.pushNotificationLog.update({
        where: { id: log.id },
        data: {
          status: PushNotificationStatus.FAILED,
          error: result,
        },
      });

      if (invalidDeviceToken) {
        await this.prisma.devicePushToken.update({
          where: { id: token.id },
          data: { disabledAt: new Date() },
        });
        continue;
      }

      this.recordPushFailure(payload, result);
    }

    if (failed > 0 && sent === 0 && queued === 0) {
      this.recordPushFailure(
        payload,
        "Nijedan spremljeni push token nije uspješno primio obavijest.",
      );
    }

    return { sent, queued, failed };
  }

  private recordPushFailure(payload: PushPayload, error: string) {
    this.monitoringService.record({
      level: "warning",
      source: "push",
      message: "Push notifikacija nije poslana.",
      details: {
        userId: payload.userId,
        app: payload.app ?? null,
        title: payload.title,
        error,
      },
    });
  }

  private isInvalidFcmDeviceTokenError(error: string) {
    return (
      error.includes("UNREGISTERED") ||
      error.includes("NotRegistered") ||
      error.includes("SENDER_ID_MISMATCH") ||
      error.includes("SenderId mismatch")
    );
  }

  private async sendFcmNotification(
    token: string,
    payload: PushPayload,
  ): Promise<"sent" | "queued" | string> {
    const projectId = this.configService.get<string>("FCM_PROJECT_ID")?.trim();
    if (!projectId) {
      return "queued";
    }

    try {
      const accessToken = await this.getFcmAccessToken();
      if (!accessToken) {
        return "queued";
      }

      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: payload.title,
                body: payload.body,
              },
              data: payload.data ?? {},
              android: {
                priority: "HIGH",
                notification: {
                  channel_id:
                    payload.app === DevicePushApp.VENUE_OWNER
                      ? VENUE_ANDROID_NOTIFICATION_CHANNEL_ID
                      : CUSTOMER_ANDROID_NOTIFICATION_CHANNEL_ID,
                  notification_priority: "PRIORITY_HIGH",
                  sound: "default",
                  default_sound: true,
                  default_vibrate_timings: true,
                },
              },
              apns: {
                headers: {
                  "apns-priority": "10",
                },
                payload: {
                  aps: {
                    alert: {
                      title: payload.title,
                      body: payload.body,
                    },
                    sound: "default",
                  },
                },
              },
            },
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        return `FCM request failed with ${response.status}: ${body}`;
      }

      return "sent";
    } catch (error) {
      return error instanceof Error ? error.message : "FCM request failed.";
    }
  }

  private async getFcmAccessToken() {
    if (
      this.fcmAccessToken &&
      this.fcmAccessToken.expiresAt > Date.now() + 60_000
    ) {
      return this.fcmAccessToken.token;
    }

    const serviceAccount = this.getFcmServiceAccount();
    if (!serviceAccount) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const assertion = this.signJwt(
      {
        alg: "RS256",
        typ: "JWT",
      },
      {
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      },
      serviceAccount.private_key,
    );

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `FCM OAuth token request failed with ${response.status}: ${await response.text()}`,
      );
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!body.access_token) {
      throw new Error("FCM OAuth response did not include access_token.");
    }

    this.fcmAccessToken = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };

    return this.fcmAccessToken.token;
  }

  private getFcmServiceAccount() {
    const json = this.configService
      .get<string>("FCM_SERVICE_ACCOUNT_JSON")
      ?.trim();
    const filePath = this.configService
      .get<string>("GOOGLE_APPLICATION_CREDENTIALS")
      ?.trim();

    if (!json && !filePath) {
      return null;
    }

    const parsed = JSON.parse(json || readFileSync(filePath!, "utf8")) as {
      client_email?: string;
      private_key?: string;
      project_id?: string;
    };

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "FCM service account must include client_email and private_key.",
      );
    }

    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      project_id: parsed.project_id,
    };
  }

  private signJwt(
    header: Record<string, unknown>,
    claims: Record<string, unknown>,
    privateKey: string,
  ) {
    const encodedHeader = this.base64Url(JSON.stringify(header));
    const encodedClaims = this.base64Url(JSON.stringify(claims));
    const unsignedToken = `${encodedHeader}.${encodedClaims}`;
    const signature = createSign("RSA-SHA256")
      .update(unsignedToken)
      .sign(privateKey);

    return `${unsignedToken}.${this.base64Url(signature)}`;
  }

  private base64Url(value: string | Buffer) {
    return Buffer.from(value)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  private serializeToken(token: {
    id: string;
    userId: string;
    token: string;
    provider: string;
    platform: DevicePushPlatform;
    app: DevicePushApp;
    deviceId: string | null;
    appVersion: string | null;
    lastSeenAt: Date;
    disabledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: token.id,
      userId: token.userId,
      provider: token.provider,
      platform: token.platform,
      app: token.app,
      deviceId: token.deviceId,
      appVersion: token.appVersion,
      lastSeenAt: token.lastSeenAt,
      disabledAt: token.disabledAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }
}

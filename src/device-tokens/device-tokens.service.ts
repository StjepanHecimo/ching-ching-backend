import { Injectable } from "@nestjs/common";
import {
  DevicePushApp,
  DevicePushPlatform,
  PushNotificationStatus,
} from "../../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertDeviceTokenDto } from "./dto/upsert-device-token.dto";

type PushPayload = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

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

    for (const token of tokens) {
      await this.prisma.pushNotificationLog.create({
        data: {
          userId: payload.userId,
          deviceTokenId: token.id,
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
          status: PushNotificationStatus.PENDING,
        },
      });
    }

    // Production FCM/APNs provider is intentionally isolated here.
    // Until credentials are configured, logs give us reliable monitoring
    // and the app still uses in-app polling when open.
    return { sent: 0, queued: tokens.length };
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

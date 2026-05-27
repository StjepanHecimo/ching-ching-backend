CREATE TYPE "DevicePushPlatform" AS ENUM ('IOS', 'ANDROID', 'WEB', 'MACOS', 'WINDOWS', 'LINUX', 'UNKNOWN');

CREATE TYPE "DevicePushApp" AS ENUM ('CUSTOMER', 'VENUE_OWNER');

CREATE TYPE "PushNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "device_push_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'FCM',
  "platform" "DevicePushPlatform" NOT NULL DEFAULT 'UNKNOWN',
  "app" "DevicePushApp" NOT NULL,
  "deviceId" TEXT,
  "appVersion" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_notification_logs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceTokenId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "data" JSONB,
  "status" "PushNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "push_notification_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_push_tokens_token_key" ON "device_push_tokens"("token");
CREATE INDEX "device_push_tokens_userId_idx" ON "device_push_tokens"("userId");
CREATE INDEX "device_push_tokens_app_idx" ON "device_push_tokens"("app");
CREATE INDEX "device_push_tokens_platform_idx" ON "device_push_tokens"("platform");
CREATE INDEX "device_push_tokens_disabledAt_idx" ON "device_push_tokens"("disabledAt");
CREATE INDEX "push_notification_logs_userId_idx" ON "push_notification_logs"("userId");
CREATE INDEX "push_notification_logs_deviceTokenId_idx" ON "push_notification_logs"("deviceTokenId");
CREATE INDEX "push_notification_logs_status_idx" ON "push_notification_logs"("status");

ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_notification_logs" ADD CONSTRAINT "push_notification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_notification_logs" ADD CONSTRAINT "push_notification_logs_deviceTokenId_fkey" FOREIGN KEY ("deviceTokenId") REFERENCES "device_push_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

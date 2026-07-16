import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendVerificationCode(input: { to: string; code: string }) {
    const accountSid = this.configService.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.configService.get<string>("TWILIO_AUTH_TOKEN");
    const from = this.configService.get<string>("TWILIO_FROM_NUMBER");

    if (!accountSid || !authToken || !from) {
      this.logger.warn(
        `SMS provider is not configured. Verification code for ${input.to}: ${input.code}`,
      );
      return { delivered: false, provider: "CONSOLE" as const };
    }

    const body = new URLSearchParams({
      To: input.to,
      From: from,
      Body: `Chin-Chin verifikacijski kod: ${input.code}`,
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      this.logger.error(
        `Twilio SMS failed with ${response.status}: ${responseText}`,
      );
      throw new Error("SMS verification message could not be sent.");
    }

    return { delivered: true, provider: "TWILIO" as const };
  }
}

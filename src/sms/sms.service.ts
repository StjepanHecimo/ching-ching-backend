import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendVerificationCode(input: { to: string; code: string }) {
    const provider =
      this.configService.get<string>("SMS_PROVIDER")?.trim().toUpperCase() ||
      "TWILIO";

    if (provider === "INFOBIP") {
      return this.sendWithInfobip(input);
    }

    if (provider !== "TWILIO") {
      throw new BadGatewayException(
        `SMS provider error: unsupported SMS_PROVIDER "${provider}".`,
      );
    }

    const accountSid = this.configService
      .get<string>("TWILIO_ACCOUNT_SID")
      ?.trim();
    const authToken = this.configService
      .get<string>("TWILIO_AUTH_TOKEN")
      ?.trim();
    const from = this.configService.get<string>("TWILIO_FROM_NUMBER")?.trim();
    const messagingServiceSid = this.configService
      .get<string>("TWILIO_MESSAGING_SERVICE_SID")
      ?.trim();

    if (!accountSid || !authToken || (!from && !messagingServiceSid)) {
      this.logger.warn(
        `SMS provider is not configured. Verification code for ${input.to}: ${input.code}`,
      );
      return { delivered: false, provider: "CONSOLE" as const };
    }

    if (!accountSid.startsWith("AC")) {
      throw new BadGatewayException(
        "SMS provider error: TWILIO_ACCOUNT_SID must start with AC.",
      );
    }

    const body = new URLSearchParams({
      To: input.to,
      Body: `Chin-Chin verifikacijski kod: ${input.code}`,
    });
    if (messagingServiceSid) {
      body.set("MessagingServiceSid", messagingServiceSid);
    } else if (from) {
      body.set("From", from);
    }

    this.logger.log(
      `Sending SMS verification via Twilio to ${this.maskPhone(input.to)} using ${
        messagingServiceSid ? "MessagingServiceSid" : "From"
      }.`,
    );

    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
          accountSid,
        )}/Messages.json`,
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
    } catch (error) {
      this.logger.error(
        `Twilio SMS network request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException(
        "SMS provider error: Twilio endpoint could not be reached.",
      );
    }

    if (!response.ok) {
      const responseText = await response.text();
      this.logger.error(
        `Twilio SMS failed with ${response.status}: ${responseText}`,
      );
      const message = this.twilioErrorMessage(responseText);
      throw new BadGatewayException(message);
    }

    return { delivered: true, provider: "TWILIO" as const };
  }

  private async sendWithInfobip(input: { to: string; code: string }) {
    const baseUrl = this.configService
      .get<string>("INFOBIP_BASE_URL")
      ?.trim()
      .replace(/\/+$/, "");
    const apiKey = this.configService.get<string>("INFOBIP_API_KEY")?.trim();
    const sender = this.configService.get<string>("INFOBIP_SMS_SENDER")?.trim();

    if (!baseUrl || !apiKey || !sender) {
      this.logger.warn(
        "Infobip SMS provider is not fully configured. Required: INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_SMS_SENDER.",
      );
      return { delivered: false, provider: "CONSOLE" as const };
    }

    const endpoint = `${baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`}/sms/3/messages`;
    const destination = input.to.trim().replace(/^\+/, "");

    this.logger.log(
      `Sending SMS verification via Infobip to ${this.maskPhone(input.to)}.`,
    );

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `App ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              sender,
              destinations: [{ to: destination }],
              content: {
                text: `Chin-Chin verifikacijski kod: ${input.code}`,
              },
            },
          ],
        }),
      });
    } catch (error) {
      this.logger.error(
        `Infobip SMS network request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException(
        "SMS provider error: Infobip endpoint could not be reached.",
      );
    }

    if (!response.ok) {
      const responseText = await response.text();
      this.logger.error(
        `Infobip SMS failed with ${response.status}: ${responseText}`,
      );
      throw new BadGatewayException(this.infobipErrorMessage(responseText));
    }

    const responseText = await response.text();
    const status = this.infobipAcceptedMessageStatus(responseText);
    this.logger.log(
      `Infobip SMS accepted for ${this.maskPhone(input.to)}.${status ? ` ${status}` : ""}`,
    );

    return { delivered: true, provider: "INFOBIP" as const };
  }

  private maskPhone(phone: string) {
    if (phone.length <= 6) {
      return phone;
    }
    return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
  }

  private twilioErrorMessage(responseText: string) {
    try {
      const body = JSON.parse(responseText) as { message?: unknown };
      if (typeof body.message === "string" && body.message.trim()) {
        return `SMS provider error: ${body.message}`;
      }
    } catch {
      // Keep the generic message below when Twilio returns non-JSON.
    }
    return "SMS verification message could not be sent.";
  }

  private infobipErrorMessage(responseText: string) {
    try {
      const body = JSON.parse(responseText) as {
        requestError?: { serviceException?: { text?: unknown } };
        error?: string;
      };
      const message = body.requestError?.serviceException?.text ?? body.error;
      if (typeof message === "string" && message.trim()) {
        return `SMS provider error: ${message}`;
      }
    } catch {
      // Keep the generic message below when Infobip returns non-JSON.
    }
    return "SMS verification message could not be sent.";
  }

  private infobipAcceptedMessageStatus(responseText: string) {
    if (!responseText.trim()) {
      return null;
    }
    try {
      const body = JSON.parse(responseText) as {
        messages?: Array<{
          messageId?: unknown;
          status?: { name?: unknown; description?: unknown };
        }>;
      };
      const message = body.messages?.[0];
      const statusName = message?.status?.name;
      const statusDescription = message?.status?.description;
      const messageId = message?.messageId;
      const parts = [
        typeof statusName === "string" ? `status=${statusName}` : null,
        typeof statusDescription === "string"
          ? `description=${statusDescription}`
          : null,
        typeof messageId === "string" ? `messageId=${messageId}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" ") : null;
    } catch {
      return null;
    }
  }
}

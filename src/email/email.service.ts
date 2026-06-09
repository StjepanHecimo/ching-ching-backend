import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { Transporter } from "nodemailer";

type VerificationEmailInput = {
  to: string;
  verificationLink: string;
  appVerificationLink: string;
  token: string;
};

type ReservationRefundEmailInput = {
  to: string;
  venueName: string;
  tableLabel?: string | null;
  amountCents: number;
  currency?: string;
};

type ReservationConfirmedEmailInput = {
  to: string;
  venueName: string;
  tableLabel?: string | null;
  startAt: Date;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async sendVerificationEmail(input: VerificationEmailInput) {
    const transporter = this.getTransporter();
    const from =
      this.configService.get<string>("EMAIL_FROM") ??
      "Chin-Chin <no-reply@chin-chin.local>";

    if (!transporter) {
      this.logVerificationFallback(input);
      return;
    }

    await transporter.sendMail({
      from,
      to: input.to,
      subject: "Chin-Chin verifikacijski link",
      text: [
        "Dobrodosli u Chin-Chin.",
        "",
        "Otvorite ovaj link za potvrdu maila:",
        input.appVerificationLink,
        "",
        "Ako se aplikacija ne otvori, koristite ovaj fallback link:",
        input.verificationLink,
        "",
        "Ako niste zatrazili ovaj link, slobodno ignorirajte ovu poruku.",
      ].join("\n"),
      html: this.verificationHtml(input),
    });

    this.logger.log(`Verification email sent to ${input.to}`);
  }

  async sendReservationRefundEmail(input: ReservationRefundEmailInput) {
    const transporter = this.getTransporter();
    const from =
      this.configService.get<string>("EMAIL_FROM") ??
      "Chin-Chin <no-reply@chin-chin.local>";

    if (!transporter) {
      this.logReservationRefundFallback(input);
      return;
    }

    const amount = this.formatCents(input.amountCents, input.currency);
    const venueName = input.venueName.trim() || "kafić";
    const tableLabel = input.tableLabel?.trim() || "Chin-Chin stol";

    await transporter.sendMail({
      from,
      to: input.to,
      subject: "Chin-Chin povrat sredstava",
      text: [
        "Chin-Chin povrat sredstava",
        "",
        `${venueName} je otkazao rezervaciju za ${tableLabel}.`,
        `Iznos povrata: ${amount}.`,
        "",
        "Pravila otkazivanja dostupna su u aplikaciji pod rezervacijama.",
        "",
        "Ako imaš pitanje, javi se Chin-Chin podršci.",
      ].join("\n"),
      html: this.reservationRefundHtml(input),
    });

    this.logger.log(`Reservation refund email sent to ${input.to}`);
  }

  async sendReservationConfirmedEmail(input: ReservationConfirmedEmailInput) {
    const transporter = this.getTransporter();
    const from =
      this.configService.get<string>("EMAIL_FROM") ??
      "Chin-Chin <no-reply@chin-chin.local>";

    if (!transporter) {
      this.logReservationConfirmedFallback(input);
      return;
    }

    const venueName = input.venueName.trim() || "kafić";
    const tableLabel = input.tableLabel?.trim() || "Chin-Chin stol";
    const reservationTime = this.formatDateTime(input.startAt);

    await transporter.sendMail({
      from,
      to: input.to,
      subject: "Chin-Chin rezervacija potvrđena",
      text: [
        "Chin-Chin rezervacija potvrđena",
        "",
        `${venueName} je potvrdio rezervaciju za ${tableLabel}.`,
        `Vrijeme rezervacije: ${reservationTime}.`,
        "",
        "Detalje rezervacije možeš provjeriti u Chin-Chin aplikaciji.",
      ].join("\n"),
      html: this.reservationConfirmedHtml(input),
    });

    this.logger.log(`Reservation confirmed email sent to ${input.to}`);
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

  private verificationHtml(input: VerificationEmailInput) {
    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;text-align:center;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;">Potvrdi svoj email</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 24px;color:#6c4127;">
              Otvori Chin-Chin aplikaciju i nastavi tamo gdje si stao.
            </p>
            <a href="${input.appVerificationLink}" style="display:inline-block;background:linear-gradient(135deg,#ff9f1c,#ff6b1a);color:#ffffff;padding:15px 24px;border-radius:12px;text-decoration:none;font-size:17px;font-weight:900;">
              Verificiraj email
            </a>
            <p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#79533d;">
              Ako se aplikacija ne otvori, koristi fallback link:<br />
              <a href="${input.verificationLink}" style="color:#c65a00;text-decoration:underline;">Potvrdi preko browsera</a>
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private reservationRefundHtml(input: ReservationRefundEmailInput) {
    const amount = this.escapeHtml(
      this.formatCents(input.amountCents, input.currency),
    );
    const venueName = this.escapeHtml(input.venueName.trim() || "kafić");
    const tableLabel = this.escapeHtml(
      input.tableLabel?.trim() || "Chin-Chin stol",
    );

    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;text-align:center;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;">Povrat sredstava je evidentiran</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#6c4127;">
              ${venueName} je otkazao rezervaciju za <strong>${tableLabel}</strong>.
            </p>
            <div style="display:inline-block;background:#2d1a10;color:#ffffff;padding:16px 26px;border-radius:12px;margin:2px 0 18px;">
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">Iznos povrata</div>
              <div style="font-size:30px;font-weight:900;line-height:1.15;">${amount}</div>
            </div>
            <p style="font-size:14px;line-height:1.55;margin:0;color:#79533d;">
              Pravila otkazivanja i detalje rezervacije možeš provjeriti u Chin-Chin aplikaciji pod rezervacijama.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private reservationConfirmedHtml(input: ReservationConfirmedEmailInput) {
    const venueName = this.escapeHtml(input.venueName.trim() || "kafić");
    const tableLabel = this.escapeHtml(
      input.tableLabel?.trim() || "Chin-Chin stol",
    );
    const reservationTime = this.escapeHtml(this.formatDateTime(input.startAt));

    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;text-align:center;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;">Rezervacija je potvrđena</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#6c4127;">
              ${venueName} je potvrdio tvoju rezervaciju za <strong>${tableLabel}</strong>.
            </p>
            <div style="display:inline-block;background:#2d1a10;color:#ffffff;padding:16px 26px;border-radius:12px;margin:2px 0 18px;">
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">Vrijeme rezervacije</div>
              <div style="font-size:24px;font-weight:900;line-height:1.2;">${reservationTime}</div>
            </div>
            <p style="font-size:14px;line-height:1.55;margin:0;color:#79533d;">
              Detalje rezervacije i check-in status možeš pratiti u Chin-Chin aplikaciji.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private logVerificationFallback(input: VerificationEmailInput) {
    this.logger.warn(
      "SMTP is not configured. Verification email was not sent; using console fallback.",
    );
    console.log("Chin-Chin verification email");
    console.log("To: " + input.to);
    console.log("App verification link: " + input.appVerificationLink);
    console.log("Verification link: " + input.verificationLink);
    console.log("Verification token: " + input.token);
  }

  private logReservationRefundFallback(input: ReservationRefundEmailInput) {
    this.logger.warn(
      "SMTP is not configured. Reservation refund email was not sent; using console fallback.",
    );
    console.log("Chin-Chin reservation refund email");
    console.log("To: " + input.to);
    console.log("Venue: " + input.venueName);
    console.log("Table: " + (input.tableLabel ?? "Chin-Chin stol"));
    console.log(
      "Refund amount: " + this.formatCents(input.amountCents, input.currency),
    );
  }

  private logReservationConfirmedFallback(
    input: ReservationConfirmedEmailInput,
  ) {
    this.logger.warn(
      "SMTP is not configured. Reservation confirmed email was not sent; using console fallback.",
    );
    console.log("Chin-Chin reservation confirmed email");
    console.log("To: " + input.to);
    console.log("Venue: " + input.venueName);
    console.log("Table: " + (input.tableLabel ?? "Chin-Chin stol"));
    console.log("Start: " + this.formatDateTime(input.startAt));
  }

  private formatCents(cents: number, currency = "EUR") {
    const amount = Math.max(0, Math.round(cents)) / 100;
    try {
      return new Intl.NumberFormat("hr-HR", {
        style: "currency",
        currency,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }

  private formatDateTime(date: Date) {
    return new Intl.DateTimeFormat("hr-HR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Zagreb",
    }).format(date);
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

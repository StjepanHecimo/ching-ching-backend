import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { Transporter } from "nodemailer";
import { MonitoringService } from "../monitoring/monitoring.service";
import {
  customerLanguageCode,
  customerLocale,
  isEnglishCustomer,
} from "../shared/customer-language";

type VerificationEmailInput = {
  to: string;
  verificationLink: string;
  appVerificationLink: string;
  token: string;
  languageCode?: string | null;
};

type ReservationRefundEmailInput = {
  to: string;
  venueName: string;
  tableLabel?: string | null;
  amountCents: number;
  currency?: string;
  sender?: "NO_REPLY" | "INFO" | "SUPPORT";
  languageCode?: string | null;
};

type ReservationConfirmedEmailInput = {
  to: string;
  venueName: string;
  tableLabel?: string | null;
  startAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  languageCode?: string | null;
};

type VenueProblemReportResolvedEmailInput = {
  to: string;
  venueName: string;
  reservationId: string;
  amountCents?: number | null;
  currency?: string | null;
  adminNotes?: string | null;
  languageCode?: string | null;
};

type CustomerProblemReportResolvedEmailInput = {
  to: string;
  venueName: string;
  reservationId: string;
  tableLabel?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  adminNotes?: string | null;
  languageCode?: string | null;
};

type VenueRoomDeletedEmailInput = {
  to: string;
  venueName: string;
  roomLabel: string;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly monitoringService: MonitoringService,
  ) {}

  async sendVerificationEmail(input: VerificationEmailInput) {
    const transporter = this.getTransporter();
    const from = this.infoFrom();
    const en = isEnglishCustomer(input.languageCode);

    if (!transporter) {
      this.logVerificationFallback(input);
      return;
    }

    await this.sendTrackedMail(transporter, "verification", input.to, {
      from,
      to: input.to,
      subject: en
        ? "Chin-Chin verification link"
        : "Chin-Chin verifikacijski link",
      text: en
        ? [
            "Welcome to Chin-Chin.",
            "",
            "Open this link to confirm your email:",
            input.appVerificationLink,
            "",
            "If the app does not open automatically, open the Chin-Chin app and continue verification.",
            "",
            "If you did not request this link, you can safely ignore this message.",
          ].join("\n")
        : [
            "Dobrodošli u Chin-Chin.",
            "",
            "Otvorite ovaj link za potvrdu maila:",
            input.appVerificationLink,
            "",
            "Ako se aplikacija ne otvori automatski, otvorite Chin-Chin aplikaciju i nastavite verifikaciju.",
            "",
            "Ako niste zatražili ovaj link, slobodno ignorirajte ovu poruku.",
          ].join("\n"),
      html: this.verificationHtml(input),
    });

    this.logger.log(`Verification email sent to ${input.to}`);
  }

  async sendReservationRefundEmail(input: ReservationRefundEmailInput) {
    const transporter = this.getTransporter();
    const from = this.senderFrom(input.sender ?? "NO_REPLY");
    const en = isEnglishCustomer(input.languageCode);

    if (!transporter) {
      this.logReservationRefundFallback(input);
      return;
    }

    const amount = this.formatCents(
      input.amountCents,
      input.currency,
      input.languageCode,
    );
    const venueName = input.venueName.trim() || (en ? "venue" : "kafić");
    const tableLabel =
      input.tableLabel?.trim() || (en ? "Chin-Chin table" : "Chin-Chin stol");

    await this.sendTrackedMail(transporter, "reservation_refund", input.to, {
      from,
      to: input.to,
      subject: en ? "Chin-Chin refund" : "Chin-Chin povrat sredstava",
      text: en
        ? [
            "Chin-Chin refund",
            "",
            `A refund for your reservation at ${venueName} for ${tableLabel} has been recorded.`,
            `Refund amount: ${amount}.`,
            "",
            "Cancellation rules are available in the app under Reservations.",
            "",
            "If you have any questions, contact Chin-Chin support.",
          ].join("\n")
        : [
            "Chin-Chin povrat sredstava",
            "",
            `Povrat sredstava za rezervaciju u ${venueName} za ${tableLabel} je evidentiran.`,
            `Iznos povrata: ${amount}.`,
            "",
            "Pravila otkazivanja dostupna su u aplikaciji pod rezervacijama.",
            "",
            "Ako imaš pitanje, javi se Chin-Chin podršci.",
          ].join("\n"),
      html: this.reservationRefundHtml(input),
    });

    this.logger.log(
      `Reservation refund email sent to ${input.to} from ${from}`,
    );
  }

  async sendReservationConfirmedEmail(input: ReservationConfirmedEmailInput) {
    const transporter = this.getTransporter();
    const from = this.noReplyFrom();
    const en = isEnglishCustomer(input.languageCode);

    if (!transporter) {
      this.logReservationConfirmedFallback(input);
      return;
    }

    const venueName = input.venueName.trim() || (en ? "venue" : "kafić");
    const tableLabel =
      input.tableLabel?.trim() || (en ? "Chin-Chin table" : "Chin-Chin stol");
    const reservationTime = this.formatDateTime(
      input.startAt,
      input.languageCode,
    );
    const checkInWindow = this.formatCheckInWindow(input);

    await this.sendTrackedMail(transporter, "reservation_confirmed", input.to, {
      from,
      to: input.to,
      subject: en
        ? "Chin-Chin reservation accepted"
        : "Chin-Chin rezervacija je prihvaćena",
      text: en
        ? [
            "Chin-Chin reservation accepted",
            "",
            `${venueName} accepted your reservation request for ${tableLabel}.`,
            `Reservation time: ${reservationTime}.`,
            "",
            `Please confirm your arrival, i.e. check in, in the Chin-Chin app during this period: ${checkInWindow}.`,
            "",
            "You can find the reservation and required arrival confirmation in the Chin-Chin app under Reservations.",
            "The invoice for the paid reservation will be available in the app inside reservation details.",
            "If the reservation is cancelled, you will be notified.",
          ].join("\n")
        : [
            "Chin-Chin rezervacija je prihvaćena",
            "",
            `${venueName} je prihvatio vaš zahtjev za rezervacijom za ${tableLabel}.`,
            `Vrijeme rezervacije: ${reservationTime}.`,
            "",
            `Molimo vas da potvrdu dolaska, odnosno check-in, napravite u Chin-Chin aplikaciji u periodu ${checkInWindow}.`,
            "",
            "Rezervaciju kao i potrebnu potvrdu Vašeg dolaska možete pronaći u Chin-Chin aplikaciji pod Rezervacije.",
            "Račun za plaćenu rezervaciju bit će dostupan u aplikaciji unutar detalja rezervacije.",
            "U slučaju otkazivanja bit ćete obaviješteni.",
          ].join("\n"),
      html: this.reservationConfirmedHtml(input),
    });

    this.logger.log(
      `Reservation confirmed email sent to ${input.to} from ${from}`,
    );
  }

  async sendVenueProblemReportResolvedEmail(
    input: VenueProblemReportResolvedEmailInput,
  ) {
    const transporter = this.getTransporter();
    const from = this.supportFrom();

    if (!transporter) {
      this.logVenueProblemReportResolvedFallback(input);
      return;
    }

    const amount = this.problemReportAmountLabel(input);
    const venueName = input.venueName.trim() || "kafić";
    const adminNotes =
      input.adminNotes?.trim() ||
      (input.amountCents != null && input.amountCents > 0
        ? "Prijava je pregledana i označena kao refundirana od strane Chin-Chin."
        : "Prijava je pregledana i riješena od strane Chin-Chin admina.");

    await this.sendTrackedMail(
      transporter,
      "venue_problem_report_resolved",
      input.to,
      {
        from,
        to: input.to,
        subject: "Chin-Chin prijava problema je riješena",
        text: [
          "Chin-Chin prijava problema je riješena",
          "",
          `Kafić: ${venueName}`,
          `ID rezervacije: ${input.reservationId}`,
          ...(input.amountCents != null && input.amountCents > 0
            ? [`Iznos korekcije: ${amount}`]
            : []),
          "",
          "Odgovor admina:",
          adminNotes,
          "",
          input.amountCents != null && input.amountCents > 0
            ? "Ova korekcija je evidentirana kao Chin-Chin support trošak prema ugostitelju."
            : "Prijava je zatvorena prema odgovoru admina.",
        ].join("\n"),
        html: this.venueProblemReportResolvedHtml(input),
      },
    );

    this.logger.log(`Venue problem report resolved email sent to ${input.to}`);
  }

  async sendCustomerProblemReportResolvedEmail(
    input: CustomerProblemReportResolvedEmailInput,
  ) {
    const transporter = this.getTransporter();
    const from = this.supportFrom();
    const en = isEnglishCustomer(input.languageCode);

    if (!transporter) {
      this.logCustomerProblemReportResolvedFallback(input);
      return;
    }

    const amount = this.customerProblemReportAmountLabel(input);
    const venueName = input.venueName.trim() || (en ? "venue" : "kafić");
    const tableLabel =
      input.tableLabel?.trim() || (en ? "Chin-Chin table" : "Chin-Chin stol");
    const adminNotes =
      input.adminNotes?.trim() ||
      (input.amountCents != null && input.amountCents > 0
        ? en
          ? "The report has been reviewed and the refund has been recorded."
          : "Prijava je pregledana i povrat sredstava je evidentiran."
        : en
          ? "The report has been reviewed and resolved by Chin-Chin support."
          : "Prijava je pregledana i riješena od strane Chin-Chin podrške.");

    await this.sendTrackedMail(
      transporter,
      "customer_problem_report_resolved",
      input.to,
      {
        from,
        to: input.to,
        subject: en
          ? "Chin-Chin response to your problem report"
          : "Chin-Chin odgovor na prijavu problema",
        text: en
          ? [
              "Chin-Chin response to your problem report",
              "",
              `Venue: ${venueName}`,
              `Table: ${tableLabel}`,
              `Reservation ID: ${input.reservationId}`,
              ...(input.amountCents != null && input.amountCents > 0
                ? [`Refund amount: ${amount}`]
                : []),
              "",
              "Admin response:",
              adminNotes,
              "",
              input.amountCents != null && input.amountCents > 0
                ? "The refund has been recorded through the Chin-Chin payment system."
                : "The report has been closed based on the admin response.",
            ].join("\n")
          : [
              "Chin-Chin odgovor na prijavu problema",
              "",
              `Kafić: ${venueName}`,
              `Stol: ${tableLabel}`,
              `ID rezervacije: ${input.reservationId}`,
              ...(input.amountCents != null && input.amountCents > 0
                ? [`Iznos povrata: ${amount}`]
                : []),
              "",
              "Odgovor admina:",
              adminNotes,
              "",
              input.amountCents != null && input.amountCents > 0
                ? "Povrat je evidentiran kroz Chin-Chin sustav plaćanja."
                : "Prijava je zatvorena prema odgovoru admina.",
            ].join("\n"),
        html: this.customerProblemReportResolvedHtml(input),
      },
    );

    this.logger.log(
      `Customer problem report resolved email sent to ${input.to}`,
    );
  }

  async sendVenueRoomDeletedEmail(input: VenueRoomDeletedEmailInput) {
    const transporter = this.getTransporter();
    const from = this.supportFrom();

    if (!transporter) {
      this.logVenueRoomDeletedFallback(input);
      return;
    }

    const venueName = input.venueName.trim() || "kafić";
    const roomLabel = input.roomLabel.trim() || "odabrani prostor";

    await this.sendTrackedMail(transporter, "venue_room_deleted", input.to, {
      from,
      to: input.to,
      subject: "Chin-Chin prostor je obrisan",
      text: [
        "Chin-Chin prostor je obrisan",
        "",
        `Za kafić ${venueName} obrisan je prostor: ${roomLabel}.`,
        "",
        "Promjena je odobrena i spremljena od strane Chin-Chin admina.",
        "Molimo vas da zatvorite i ponovno otvorite aplikaciju kako bi se novi prikaz prostora odmah učitao.",
        "",
        "Ako i nakon ponovnog otvaranja aplikacije ne vidite promjenu, javite se Chin-Chin podršci.",
      ].join("\n"),
      html: this.venueRoomDeletedHtml(input),
    });

    this.logger.log(`Venue room deleted email sent to ${input.to}`);
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

  private async sendTrackedMail(
    transporter: Transporter,
    context: string,
    to: string,
    mail: Parameters<Transporter["sendMail"]>[0],
  ) {
    try {
      await transporter.sendMail(mail);
    } catch (error) {
      this.monitoringService.record({
        level: "error",
        source: "email",
        message: "Email nije poslan.",
        details: {
          context,
          to,
          error: error instanceof Error ? error.message : "SMTP error.",
        },
      });
      throw error;
    }
  }

  private infoFrom() {
    return (
      this.configService.get<string>("EMAIL_FROM") ??
      this.formatSender(
        this.configService.get<string>("SMTP_FROM_NAME") ?? "Chin-Chin",
        this.configService.get<string>("SMTP_FROM_EMAIL") ??
          "no-reply@chin-chin.local",
      )
    );
  }

  private noReplyFrom() {
    return (
      this.configService.get<string>("EMAIL_NO_REPLY_FROM") ??
      this.formatSender(
        this.configService.get<string>("SMTP_NO_REPLY_FROM_NAME") ??
          "Chin-Chin",
        this.configService.get<string>("SMTP_NO_REPLY_FROM_EMAIL") ??
          "no-reply@chin-chin.hr",
      )
    );
  }

  private supportFrom() {
    return (
      this.configService.get<string>("EMAIL_SUPPORT_FROM") ??
      this.formatSender(
        this.configService.get<string>("SMTP_SUPPORT_FROM_NAME") ??
          "Chin-Chin Support",
        this.configService.get<string>("SMTP_SUPPORT_FROM_EMAIL") ??
          this.configService.get<string>("SMTP_FROM_EMAIL") ??
          "support@chin-chin.local",
      )
    );
  }

  private senderFrom(sender: "NO_REPLY" | "INFO" | "SUPPORT") {
    if (sender === "SUPPORT") {
      return this.supportFrom();
    }
    if (sender === "INFO") {
      return this.infoFrom();
    }
    return this.noReplyFrom();
  }

  private formatSender(name: string, email: string) {
    return `${name.trim()} <${email.trim()}>`;
  }

  private verificationHtml(input: VerificationEmailInput) {
    const en = isEnglishCustomer(input.languageCode);
    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;text-align:center;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;">${en ? "Confirm your email" : "Potvrdi svoj email"}</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 24px;color:#6c4127;">
              ${en ? "Open the Chin-Chin app and continue where you left off." : "Otvori Chin-Chin aplikaciju i nastavi tamo gdje si stao."}
            </p>
            <a href="${input.appVerificationLink}" style="display:inline-block;background:#2d1a10;color:#ffffff !important;padding:15px 26px;border-radius:10px;text-decoration:none;font-size:17px;font-weight:900;border:2px solid #2d1a10;">
              ${en ? "Verify email" : "Verificiraj email"}
            </a>
            <p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#79533d;">
              ${en ? "If the app does not open automatically, open the Chin-Chin app and continue verification." : "Ako se aplikacija ne otvori automatski, otvori Chin-Chin aplikaciju i nastavi verifikaciju."}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private reservationRefundHtml(input: ReservationRefundEmailInput) {
    const en = isEnglishCustomer(input.languageCode);
    const amount = this.escapeHtml(
      this.formatCents(input.amountCents, input.currency, input.languageCode),
    );
    const venueName = this.escapeHtml(
      input.venueName.trim() || (en ? "venue" : "kafić"),
    );
    const tableLabel = this.escapeHtml(
      input.tableLabel?.trim() || (en ? "Chin-Chin table" : "Chin-Chin stol"),
    );

    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;text-align:center;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;">${en ? "Refund recorded" : "Povrat sredstava je evidentiran"}</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#6c4127;">
              ${en ? `A refund for your reservation at <strong>${venueName}</strong> for <strong>${tableLabel}</strong> has been recorded.` : `Povrat sredstava za rezervaciju u <strong>${venueName}</strong> za <strong>${tableLabel}</strong> je evidentiran.`}
            </p>
            <div style="display:inline-block;background:#2d1a10;color:#ffffff;padding:16px 26px;border-radius:12px;margin:2px 0 18px;">
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">${en ? "Refund amount" : "Iznos povrata"}</div>
              <div style="font-size:30px;font-weight:900;line-height:1.15;">${amount}</div>
            </div>
            <p style="font-size:14px;line-height:1.55;margin:0;color:#79533d;">
              ${en ? "Cancellation rules and reservation details are available in the Chin-Chin app under Reservations." : "Pravila otkazivanja i detalje rezervacije možeš provjeriti u Chin-Chin aplikaciji pod rezervacijama."}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private reservationConfirmedHtml(input: ReservationConfirmedEmailInput) {
    const en = isEnglishCustomer(input.languageCode);
    const venueName = this.escapeHtml(
      input.venueName.trim() || (en ? "venue" : "kafić"),
    );
    const tableLabel = this.escapeHtml(
      input.tableLabel?.trim() || (en ? "Chin-Chin table" : "Chin-Chin stol"),
    );
    const reservationTime = this.escapeHtml(
      this.formatDateTime(input.startAt, input.languageCode),
    );
    const checkInWindow = this.escapeHtml(this.formatCheckInWindow(input));

    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;text-align:center;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;">${en ? "Reservation accepted" : "Rezervacija je prihvaćena"}</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#6c4127;">
              ${en ? `${venueName} accepted your reservation request for <strong>${tableLabel}</strong>.` : `${venueName} je prihvatio vaš zahtjev za rezervacijom za <strong>${tableLabel}</strong>.`}
            </p>
            <div style="display:inline-block;background:#2d1a10;color:#ffffff;padding:16px 26px;border-radius:12px;margin:2px 0 18px;">
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">${en ? "Reservation time" : "Vrijeme rezervacije"}</div>
              <div style="font-size:24px;font-weight:900;line-height:1.2;">${reservationTime}</div>
            </div>
            <p style="font-size:14px;line-height:1.55;margin:0;color:#79533d;">
              ${en ? `Please confirm your arrival, i.e. check in, in the Chin-Chin app during this period: <strong>${checkInWindow}</strong>.` : `Molimo vas da potvrdu dolaska, odnosno check-in, napravite u Chin-Chin aplikaciji u periodu <strong>${checkInWindow}</strong>.`}
            </p>
            <p style="font-size:14px;line-height:1.55;margin:12px 0 0;color:#79533d;">
              ${en ? "If the reservation is cancelled, you will be notified." : "U slučaju otkazivanja bit ćete obaviješteni."}
            </p>
            <p style="font-size:14px;line-height:1.55;margin:12px 0 0;color:#79533d;">
              ${en ? "You can find the reservation and required arrival confirmation in the Chin-Chin app under <strong>Reservations</strong>." : "Rezervaciju kao i potrebnu potvrdu Vašeg dolaska možete pronaći u Chin-Chin aplikaciji pod <strong>Rezervacije</strong>."}
            </p>
            <p style="font-size:14px;line-height:1.55;margin:12px 0 0;color:#79533d;">
              ${en ? "The invoice for the paid reservation will be available in the app inside <strong>reservation details</strong>." : "Račun za plaćenu rezervaciju bit će dostupan u aplikaciji unutar <strong>detalja rezervacije</strong>."}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private venueProblemReportResolvedHtml(
    input: VenueProblemReportResolvedEmailInput,
  ) {
    const venueName = this.escapeHtml(input.venueName.trim() || "kafić");
    const reservationId = this.escapeHtml(input.reservationId);
    const amount =
      input.amountCents != null && input.amountCents > 0
        ? this.escapeHtml(this.problemReportAmountLabel(input))
        : null;
    const adminNotes = this.escapeHtml(
      input.adminNotes?.trim() ||
        "Prijava je pregledana i riješena od strane Chin-Chin admina.",
    );

    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;text-align:center;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;text-align:center;">Prijava problema je riješena</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#6c4127;text-align:center;">
              Prijava za <strong>${venueName}</strong> pregledana je od strane Chin-Chin admina.
            </p>
            <div style="background:#2d1a10;color:#ffffff;padding:16px 18px;border-radius:12px;margin:2px 0 18px;">
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">ID rezervacije</div>
              <div style="font-size:16px;font-weight:900;line-height:1.25;word-break:break-word;">${reservationId}</div>
              ${
                amount
                  ? `<div style="height:1px;background:rgba(255,255,255,.18);margin:14px 0;"></div>
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">Iznos korekcije</div>
              <div style="font-size:28px;font-weight:900;line-height:1.15;">${amount}</div>`
                  : ""
              }
            </div>
            <div style="background:#fff9e8;border:1px solid #e3c883;border-radius:12px;padding:14px 16px;">
              <div style="font-size:13px;font-weight:900;color:#7a2f12;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Odgovor admina</div>
              <p style="font-size:15px;line-height:1.55;margin:0;color:#63391e;">${adminNotes}</p>
            </div>
            <p style="font-size:13px;line-height:1.55;margin:18px 0 0;color:#79533d;text-align:center;">
              ${
                amount
                  ? "Ova korekcija je evidentirana kao Chin-Chin support trošak prema ugostitelju."
                  : "Ova prijava je zatvorena prema odgovoru admina."
              }
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private customerProblemReportResolvedHtml(
    input: CustomerProblemReportResolvedEmailInput,
  ) {
    const en = isEnglishCustomer(input.languageCode);
    const venueName = this.escapeHtml(
      input.venueName.trim() || (en ? "venue" : "kafić"),
    );
    const reservationId = this.escapeHtml(input.reservationId);
    const tableLabel = this.escapeHtml(
      input.tableLabel?.trim() || (en ? "Chin-Chin table" : "Chin-Chin stol"),
    );
    const amount =
      input.amountCents != null && input.amountCents > 0
        ? this.escapeHtml(this.customerProblemReportAmountLabel(input))
        : null;
    const adminNotes = this.escapeHtml(
      input.adminNotes?.trim() ||
        (en
          ? "The report has been reviewed and resolved by Chin-Chin support."
          : "Prijava je pregledana i riješena od strane Chin-Chin podrške."),
    );

    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;text-align:center;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;text-align:center;">${en ? "Problem report response" : "Odgovor na prijavu problema"}</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#6c4127;text-align:center;">
              ${en ? `The report for <strong>${venueName}</strong> and <strong>${tableLabel}</strong> has been reviewed by Chin-Chin support.` : `Prijava za <strong>${venueName}</strong> i <strong>${tableLabel}</strong> pregledana je od strane Chin-Chin podrške.`}
            </p>
            <div style="background:#2d1a10;color:#ffffff;padding:16px 18px;border-radius:12px;margin:2px 0 18px;">
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">${en ? "Reservation ID" : "ID rezervacije"}</div>
              <div style="font-size:16px;font-weight:900;line-height:1.25;word-break:break-word;">${reservationId}</div>
              ${
                amount
                  ? `<div style="height:1px;background:rgba(255,255,255,.18);margin:14px 0;"></div>
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">${en ? "Refund amount" : "Iznos povrata"}</div>
              <div style="font-size:28px;font-weight:900;line-height:1.15;">${amount}</div>`
                  : ""
              }
            </div>
            <div style="background:#fff9e8;border:1px solid #e3c883;border-radius:12px;padding:14px 16px;">
              <div style="font-size:13px;font-weight:900;color:#7a2f12;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">${en ? "Admin response" : "Odgovor admina"}</div>
              <p style="font-size:15px;line-height:1.55;margin:0;color:#63391e;">${adminNotes}</p>
            </div>
            <p style="font-size:13px;line-height:1.55;margin:18px 0 0;color:#79533d;text-align:center;">
              ${
                amount
                  ? en
                    ? "The refund has been recorded through the Chin-Chin payment system."
                    : "Povrat je evidentiran kroz Chin-Chin sustav plaćanja."
                  : en
                    ? "The report has been closed based on the admin response."
                    : "Ova prijava je zatvorena prema odgovoru admina."
              }
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private venueRoomDeletedHtml(input: VenueRoomDeletedEmailInput) {
    const venueName = this.escapeHtml(input.venueName.trim() || "kafić");
    const roomLabel = this.escapeHtml(
      input.roomLabel.trim() || "odabrani prostor",
    );

    return `
      <div style="margin:0;padding:0;background:#ffc857;">
        <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Arial,sans-serif;color:#2d1a10;">
          <div style="background:#fff4d6;border:2px solid #ff9f1c;border-radius:18px;padding:28px;text-align:center;box-shadow:0 12px 32px rgba(45,26,16,0.12);">
            <div style="font-size:38px;font-weight:900;letter-spacing:0;margin-bottom:4px;">Chin-Chin</div>
            <div style="height:6px;width:96px;margin:0 auto 22px;border-radius:999px;background:linear-gradient(90deg,#ffcf57,#ff7a1a);"></div>
            <h1 style="font-size:25px;line-height:1.15;margin:0 0 10px;">Prostor je obrisan</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#6c4127;">
              Za kafić <strong>${venueName}</strong> obrisan je prostor:
            </p>
            <div style="display:inline-block;background:#2d1a10;color:#ffffff;padding:16px 26px;border-radius:12px;margin:2px 0 18px;">
              <div style="font-size:13px;font-weight:800;color:#ffd66b;text-transform:uppercase;letter-spacing:.04em;">Prostor</div>
              <div style="font-size:24px;font-weight:900;line-height:1.2;">${roomLabel}</div>
            </div>
            <p style="font-size:14px;line-height:1.55;margin:0;color:#79533d;">
              Promjena je odobrena i spremljena od strane Chin-Chin admina.
            </p>
            <p style="font-size:14px;line-height:1.55;margin:12px 0 0;color:#79533d;">
              Molimo vas da zatvorite i ponovno otvorite aplikaciju kako bi se novi prikaz prostora odmah učitao.
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
    console.log("Check-in: " + this.formatCheckInWindow(input));
  }

  private logVenueProblemReportResolvedFallback(
    input: VenueProblemReportResolvedEmailInput,
  ) {
    this.logger.warn(
      "SMTP is not configured. Venue problem report resolved email was not sent; using console fallback.",
    );
    console.log("Chin-Chin venue problem report resolved email");
    console.log("To: " + input.to);
    console.log("Venue: " + input.venueName);
    console.log("Reservation ID: " + input.reservationId);
    if (input.amountCents != null && input.amountCents > 0) {
      console.log("Amount: " + this.problemReportAmountLabel(input));
    }
    console.log("Admin notes: " + (input.adminNotes ?? "-"));
  }

  private logCustomerProblemReportResolvedFallback(
    input: CustomerProblemReportResolvedEmailInput,
  ) {
    this.logger.warn(
      "SMTP is not configured. Customer problem report resolved email was not sent; using console fallback.",
    );
    console.log("Chin-Chin customer problem report resolved email");
    console.log("To: " + input.to);
    console.log("Venue: " + input.venueName);
    console.log("Table: " + (input.tableLabel ?? "Chin-Chin stol"));
    console.log("Reservation ID: " + input.reservationId);
    if (input.amountCents != null && input.amountCents > 0) {
      console.log("Amount: " + this.customerProblemReportAmountLabel(input));
    }
    console.log("Admin notes: " + (input.adminNotes ?? "-"));
  }

  private logVenueRoomDeletedFallback(input: VenueRoomDeletedEmailInput) {
    this.logger.warn(
      "SMTP is not configured. Venue room deleted email was not sent; using console fallback.",
    );
    console.log("Chin-Chin venue room deleted email");
    console.log("To: " + input.to);
    console.log("Venue: " + input.venueName);
    console.log("Room: " + input.roomLabel);
  }

  private problemReportAmountLabel(
    input: VenueProblemReportResolvedEmailInput,
  ) {
    return input.amountCents != null
      ? this.formatCents(
          input.amountCents,
          input.currency ?? "EUR",
          input.languageCode,
        )
      : isEnglishCustomer(input.languageCode)
        ? "Not specified"
        : "Nije naveden";
  }

  private customerProblemReportAmountLabel(
    input: CustomerProblemReportResolvedEmailInput,
  ) {
    return input.amountCents != null
      ? this.formatCents(
          input.amountCents,
          input.currency ?? "EUR",
          input.languageCode,
        )
      : isEnglishCustomer(input.languageCode)
        ? "Not specified"
        : "Nije naveden";
  }

  private formatCents(
    cents: number,
    currency = "EUR",
    languageCode?: string | null,
  ) {
    const amount = Math.max(0, Math.round(cents)) / 100;
    try {
      return new Intl.NumberFormat(customerLocale(languageCode), {
        style: "currency",
        currency,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }

  private formatDateTime(date: Date, languageCode?: string | null) {
    return new Intl.DateTimeFormat(customerLocale(languageCode), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Zagreb",
    }).format(date);
  }

  private formatTime(date: Date, languageCode?: string | null) {
    return new Intl.DateTimeFormat(customerLocale(languageCode), {
      timeStyle: "short",
      timeZone: "Europe/Zagreb",
    }).format(date);
  }

  private formatCheckInWindow(input: ReservationConfirmedEmailInput) {
    return `${this.formatTime(input.checkInOpensAt, input.languageCode)} - ${this.formatTime(
      input.checkInClosesAt,
      input.languageCode,
    )}`;
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

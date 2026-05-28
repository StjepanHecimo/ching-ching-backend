import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { Transporter } from "nodemailer";

type VerificationEmailInput = {
  to: string;
  verificationLink: string;
  appVerificationLink: string;
  token: string;
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
}

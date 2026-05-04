import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { UserStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { RegisterVenueOwnerDto } from "./dto/register-venue-owner.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";

type RefreshTokenPayload = {
  sub: string;
  tokenType: "refresh";
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async registerVenueOwner(dto: RegisterVenueOwnerDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException("Email is already registered.");
    }

    const verificationToken = this.createVerificationToken();
    const tokenHash = this.hashToken(verificationToken);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const venueSlug = this.slugify(dto.venueName);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phoneNumber: dto.phoneNumber?.trim(),
        },
      });

      const venue = await tx.venue.create({
        data: {
          ownerId: user.id,
          name: dto.venueName.trim(),
          slug: venueSlug,
          address: dto.venueAddress?.trim(),
          city: dto.venueCity?.trim(),
          country: dto.venueCountry?.trim() ?? "HR",
        },
      });

      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      });

      return { user, venue };
    });

    this.logVerificationEmail(result.user.email, verificationToken);

    return {
      userId: result.user.id,
      venueId: result.venue.id,
      email: result.user.email,
      status: result.user.status,
      message: "Registration created. Email verification is required.",
      devVerificationToken: verificationToken,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    return this.verifyEmailToken(dto.token);
  }

  async verifyEmailToken(token: string) {
    if (!token || token.length !== 64) {
      throw new BadRequestException("Verification token is invalid.");
    }

    const tokenHash = this.hashToken(token);
    const verificationToken =
      await this.prisma.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

    if (!verificationToken || verificationToken.usedAt) {
      throw new BadRequestException("Verification token is invalid.");
    }

    if (verificationToken.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Verification token has expired.");
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({
        where: { id: verificationToken.id },
        data: { usedAt: new Date() },
      });

      return tx.user.update({
        where: { id: verificationToken.userId },
        data: {
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
    });

    return {
      userId: user.id,
      email: user.email,
      status: user.status,
      message: "Email verified.",
    };
  }

  async resendVerification(dto: ResendVerificationDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || user.status === UserStatus.ACTIVE) {
      return {
        message:
          "If an unverified account exists for this email, a new verification email has been sent.",
      };
    }

    const verificationToken = this.createVerificationToken();
    const tokenHash = this.hashToken(verificationToken);

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });

      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      });
    });

    this.logVerificationEmail(user.email, verificationToken);

    return {
      message:
        "If an unverified account exists for this email, a new verification email has been sent.",
      devVerificationToken: verificationToken,
    };
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("Email verification is required.");
    }

    const tokens = await this.issueTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    const tokenHash = this.hashToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken || storedToken.userId !== payload.sub) {
      throw new UnauthorizedException("Invalid refresh token.");
    }

    if (storedToken.revokedAt) {
      throw new UnauthorizedException("Refresh token has been revoked.");
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token has expired.");
    }

    if (storedToken.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User account is not active.");
    }

    const tokens = await this.issueTokenPair({
      id: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: storedToken.id },
        data: {
          revokedAt: new Date(),
          rotatedAt: new Date(),
        },
      });

      await tx.refreshToken.create({
        data: {
          userId: storedToken.user.id,
          tokenHash: this.hashToken(tokens.refreshToken),
          expiresAt: this.createRefreshTokenExpiryDate(),
        },
      });
    });

    return tokens;
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        venues: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User no longer exists.");
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      venues: user.venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        address: venue.address,
        city: venue.city,
        country: venue.country,
      })),
    };
  }

  private async issueTokenPair(user: {
    id: string;
    email: string;
    role: string;
  }): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
      {
        secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: "15m",
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        tokenType: "refresh",
      },
      {
        secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
        expiresIn: "30d",
      },
    );

    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        token,
        {
          secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
        },
      );

      if (payload.tokenType !== "refresh") {
        throw new UnauthorizedException("Invalid refresh token.");
      }

      return payload;
    } catch {
      throw new UnauthorizedException("Invalid refresh token.");
    }
  }

  private async storeRefreshToken(userId: string, refreshToken: string) {
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.createRefreshTokenExpiryDate(),
      },
    });
  }

  private createRefreshTokenExpiryDate() {
    return new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  }

  private createVerificationToken() {
    return randomBytes(32).toString("hex");
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private logVerificationEmail(email: string, token: string) {
    const verificationLink =
      this.configService.getOrThrow<string>("APP_WEB_URL") +
      "/api/auth/verify-email?token=" +
      token;

    console.log("Chin-Chin verification email");
    console.log("To: " + email);
    console.log("Verification link: " + verificationLink);
    console.log("Verification token: " + token);
  }

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}

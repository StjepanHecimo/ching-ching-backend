import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { UserRole, UserStatus } from "../../generated/prisma/enums";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { SmsService } from "../sms/sms.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";
import { RegisterVenueOwnerDto } from "./dto/register-venue-owner.dto";
import { RequestPhoneChangeDto } from "./dto/request-phone-change.dto";
import { RequestRegistrationPhoneDto } from "./dto/request-registration-phone.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { UpdateCustomerProfileDto } from "./dto/update-customer-profile.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { VerifyPhoneChangeDto } from "./dto/verify-phone-change.dto";
import { VerifyRegistrationPhoneDto } from "./dto/verify-registration-phone.dto";

type RefreshTokenPayload = {
  sub: string;
  tokenType: "refresh";
  jti?: string;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

const DEFAULT_REFRESH_TOKEN_DAYS = 365;
const ADMIN_ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
const ADMIN_LOGIN_ATTEMPT_LIMIT = 5;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000;
const PHONE_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const PHONE_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const PHONE_VERIFICATION_ATTEMPT_LIMIT = 5;
const ZAGREB_LOCATION_BIAS = {
  circle: {
    center: {
      latitude: 45.815,
      longitude: 15.9819,
    },
    radius: 50000,
  },
};
const CROATIA_ADDRESS_HINT_PATTERN = /\b(zagreb|hrvatska|croatia)\b/i;
const ADMIN_PANEL_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.ADMIN_ACCOUNTING,
  UserRole.CHIN_CHIN_SUPPORT,
];

type AdminLoginAttempt = {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
};

type GooglePlaceAutocompletePrediction = {
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
};

@Injectable()
export class AuthService {
  private readonly adminLoginAttempts = new Map<string, AdminLoginAttempt>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
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
    const passwordHash = await bcrypt.hash(this.createVerificationToken(), 12);
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
          venueType: this.normalizeVenueType(dto.venueType),
          businessOib: dto.venueBusinessOib.trim(),
          address: dto.venueAddress?.trim(),
          city: dto.venueCity?.trim(),
          country: dto.venueCountry?.trim() ?? "HR",
          latitude: dto.venueLatitude,
          longitude: dto.venueLongitude,
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

    await this.sendVerificationEmail(
      result.user.email,
      verificationToken,
      result.user.role,
    );

    return {
      userId: result.user.id,
      venueId: result.venue.id,
      email: result.user.email,
      status: result.user.status,
      message: "Registration created. Email verification is required.",
      devVerificationToken: verificationToken,
    };
  }

  async venueAddressSuggestions(input: string, sessionToken?: string) {
    const normalizedInput = input.trim();
    if (normalizedInput.length < 3) {
      return { suggestions: [] };
    }

    const apiKey = this.googleMapsServerApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Pretraga adrese trenutno nije dostupna.",
      );
    }

    const autocompleteInputs =
      this.venueAddressAutocompleteInputs(normalizedInput);

    for (const autocompleteInput of autocompleteInputs) {
      const suggestions = await this.fetchVenueAddressSuggestions(
        autocompleteInput,
        apiKey,
        sessionToken,
      );
      if (suggestions.length > 0) {
        return { suggestions };
      }
    }

    return { suggestions: [] };
  }

  private venueAddressAutocompleteInputs(input: string) {
    const inputs = [input];
    if (!CROATIA_ADDRESS_HINT_PATTERN.test(input)) {
      inputs.push(`${input} Hrvatska`);
    }
    return inputs;
  }

  private async fetchVenueAddressSuggestions(
    input: string,
    apiKey: string,
    sessionToken?: string,
  ) {
    const response = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
        },
        body: JSON.stringify({
          input,
          languageCode: "hr",
          locationBias: ZAGREB_LOCATION_BIAS,
          includedRegionCodes: ["hr"],
          ...(sessionToken?.trim()
            ? { sessionToken: sessionToken.trim() }
            : {}),
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      this.logGooglePlacesError("autocomplete", response.status, details);
      throw new BadRequestException("Pretraga adrese nije uspjela.");
    }

    const payload = (await response.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
        };
      }>;
    };

    return (payload.suggestions ?? [])
      .map((suggestion) => suggestion.placePrediction)
      .filter(
        (
          prediction,
        ): prediction is Required<
          Pick<GooglePlaceAutocompletePrediction, "placeId">
        > &
          GooglePlaceAutocompletePrediction => {
          return Boolean(prediction?.placeId && prediction.text?.text);
        },
      )
      .slice(0, 5)
      .map((prediction) => ({
        placeId: prediction.placeId,
        label: prediction.text?.text,
        mainText: prediction.structuredFormat?.mainText?.text,
        secondaryText: prediction.structuredFormat?.secondaryText?.text,
      }));
  }

  async venueAddressDetails(placeId: string) {
    const normalizedPlaceId = placeId.trim().replace(/^places\//, "");
    if (!normalizedPlaceId || !/^[A-Za-z0-9_-]+$/.test(normalizedPlaceId)) {
      throw new BadRequestException("Identifikator adrese nije ispravan.");
    }

    const apiKey = this.googleMapsServerApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Pretraga adrese trenutno nije dostupna.",
      );
    }

    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(normalizedPlaceId)}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "id,formattedAddress,shortFormattedAddress,addressComponents,location",
        },
      },
    );

    if (!response.ok) {
      const details = await response.text();
      this.logGooglePlacesError("details", response.status, details);
      throw new BadRequestException("Detalji adrese nisu dostupni.");
    }

    const payload = (await response.json()) as {
      id?: string;
      formattedAddress?: string;
      shortFormattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      addressComponents?: Array<{
        types?: string[];
        longText?: string;
        shortText?: string;
      }>;
    };
    const components = payload.addressComponents ?? [];
    const cityComponent = components.find((component) =>
      component.types?.some((type) =>
        ["locality", "postal_town", "administrative_area_level_2"].includes(
          type,
        ),
      ),
    );
    const countryComponent = components.find((component) =>
      component.types?.includes("country"),
    );

    if (
      typeof payload.location?.latitude !== "number" ||
      typeof payload.location?.longitude !== "number"
    ) {
      throw new BadRequestException("Odabrana adresa nema lokaciju.");
    }

    return {
      placeId: payload.id ?? normalizedPlaceId,
      address: payload.shortFormattedAddress ?? payload.formattedAddress ?? "",
      city: cityComponent?.longText ?? "",
      country: countryComponent?.shortText ?? "HR",
      latitude: payload.location.latitude,
      longitude: payload.location.longitude,
    };
  }

  private googleMapsServerApiKey() {
    return this.configService.get<string>("GOOGLE_MAPS_SERVER_API_KEY")?.trim();
  }

  private logGooglePlacesError(
    operation: string,
    status: number,
    details: string,
  ) {
    const safeDetails = details.replace(/"X-Goog-Api-Key"[^,}]*/gi, "");
    console.error(`[AuthService] Google Places ${operation} failed`, {
      status,
      details: safeDetails.slice(0, 500),
    });
  }

  async registerCustomer(dto: RegisterCustomerDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException("Email is already registered.");
    }
    await this.assertPhoneNumberAvailable(phoneNumber);

    const phoneVerification = await this.consumeRegistrationPhoneToken(
      phoneNumber,
      dto.phoneVerificationToken,
    );
    const verificationToken = this.createVerificationToken();
    const tokenHash = this.hashToken(verificationToken);
    const passwordHash = await bcrypt.hash(this.createVerificationToken(), 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phoneNumber,
          phoneVerifiedAt: phoneVerification.verifiedAt,
          age: dto.age,
          gender: dto.gender,
          role: UserRole.CUSTOMER,
        },
      });

      await tx.emailVerificationToken.create({
        data: {
          userId: createdUser.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      });
      await tx.registrationPhoneVerificationCode.update({
        where: { id: phoneVerification.id },
        data: { usedAt: new Date() },
      });

      return createdUser;
    });

    await this.sendVerificationEmail(user.email, verificationToken, user.role);

    return {
      userId: user.id,
      email: user.email,
      status: user.status,
      message: "Customer registration created. Email verification is required.",
      devVerificationToken: verificationToken,
      user: this.serializeAuthUser(user),
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    return this.verifyEmailToken(dto.token);
  }

  async requestRegistrationPhoneVerification(dto: RequestRegistrationPhoneDto) {
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    await this.assertPhoneNumberAvailable(phoneNumber);
    const latestCode =
      await this.prisma.registrationPhoneVerificationCode.findFirst({
        where: { phoneNumber, usedAt: null },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

    if (latestCode) {
      const elapsedMs = Date.now() - latestCode.createdAt.getTime();
      if (elapsedMs < PHONE_VERIFICATION_RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil(
          (PHONE_VERIFICATION_RESEND_COOLDOWN_MS - elapsedMs) / 1000,
        );
        throw new HttpException(
          `Pričekajte ${waitSeconds} sekundi prije ponovnog slanja koda.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = this.createPhoneVerificationCode();
    const codeHash = this.hashRegistrationPhoneVerificationCode(
      phoneNumber,
      code,
    );
    const expiresAt = new Date(Date.now() + PHONE_VERIFICATION_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.registrationPhoneVerificationCode.updateMany({
        where: { phoneNumber, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.registrationPhoneVerificationCode.create({
        data: { phoneNumber, codeHash, expiresAt },
      });
    });

    const smsResult = await this.smsService.sendVerificationCode({
      to: phoneNumber,
      code,
    });

    return {
      message: "Registration phone verification code was sent.",
      expiresAt,
      devVerificationCode: smsResult.delivered ? undefined : code,
    };
  }

  async verifyRegistrationPhone(dto: VerifyRegistrationPhoneDto) {
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    const code = dto.code.trim();
    await this.assertPhoneNumberAvailable(phoneNumber);
    const storedCode =
      await this.prisma.registrationPhoneVerificationCode.findFirst({
        where: { phoneNumber, usedAt: null },
        orderBy: { createdAt: "desc" },
      });

    if (!storedCode || storedCode.usedAt) {
      throw new BadRequestException("Verification code is invalid.");
    }
    if (storedCode.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Verification code has expired.");
    }
    if (storedCode.attempts >= PHONE_VERIFICATION_ATTEMPT_LIMIT) {
      throw new BadRequestException("Verification code has too many attempts.");
    }

    const codeHash = this.hashRegistrationPhoneVerificationCode(
      phoneNumber,
      code,
    );
    if (storedCode.codeHash !== codeHash) {
      await this.prisma.registrationPhoneVerificationCode.update({
        where: { id: storedCode.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException("Verification code is invalid.");
    }

    const phoneVerificationToken = this.createVerificationToken();
    await this.prisma.registrationPhoneVerificationCode.update({
      where: { id: storedCode.id },
      data: {
        attempts: { increment: 1 },
        verifiedAt: new Date(),
        tokenHash: this.hashToken(phoneVerificationToken),
      },
    });

    return {
      message: "Phone number verified for registration.",
      phoneNumber,
      phoneVerificationToken,
    };
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
        include: {
          venues: true,
        },
      });
    });

    const tokens = await this.issueTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return {
      ...tokens,
      userId: user.id,
      email: user.email,
      status: user.status,
      message: "Email verified.",
      user: this.serializeAuthUser(user),
      venue: user.venues[0]
        ? {
            id: user.venues[0].id,
            name: user.venues[0].name,
            slug: user.venues[0].slug,
            businessOib: user.venues[0].businessOib,
            venueType: user.venues[0].venueType,
            address: user.venues[0].address,
            city: user.venues[0].city,
            country: user.venues[0].country,
          }
        : null,
    };
  }

  async resendVerification(dto: ResendVerificationDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        venues: true,
      },
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

    await this.sendVerificationEmail(user.email, verificationToken, user.role);

    return {
      message:
        "If an unverified account exists for this email, a new verification email has been sent.",
      devVerificationToken: verificationToken,
    };
  }

  async requestLoginVerification(dto: ResendVerificationDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        venues: true,
      },
    });

    if (!user) {
      return {
        message:
          "If an account exists for this email, a login verification email has been sent.",
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

    await this.sendVerificationEmail(user.email, verificationToken, user.role);

    return {
      message:
        "If an account exists for this email, a login verification email has been sent.",
      devVerificationToken: verificationToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        role: user.role,
        age: user.age,
        gender: user.gender,
      },
      venue: user.venues[0]
        ? {
            id: user.venues[0].id,
            name: user.venues[0].name,
            slug: user.venues[0].slug,
            businessOib: user.venues[0].businessOib,
            venueType: user.venues[0].venueType,
            address: user.venues[0].address,
            city: user.venues[0].city,
            country: user.venues[0].country,
          }
        : null,
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

  async adminLogin(dto: LoginDto, ipAddress?: string) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const attemptKeys = this.getAdminLoginAttemptKeys(
      normalizedEmail,
      ipAddress,
    );
    this.assertAdminLoginAllowed(attemptKeys);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !ADMIN_PANEL_ROLES.includes(user.role)) {
      this.recordFailedAdminLogin(attemptKeys);
      throw new UnauthorizedException("Invalid email or password.");
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      this.recordFailedAdminLogin(attemptKeys);
      throw new UnauthorizedException("Invalid email or password.");
    }

    if (user.status !== UserStatus.ACTIVE) {
      this.recordFailedAdminLogin(attemptKeys);
      throw new UnauthorizedException("Admin account is not active.");
    }

    this.clearAdminLoginAttempts(attemptKeys);

    const accessToken = await this.issueAdminAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    const expiresAt = new Date(
      Date.now() + ADMIN_ACCESS_TOKEN_TTL_SECONDS * 1000,
    ).toISOString();

    return {
      accessToken,
      expiresAt,
      expiresInSeconds: ADMIN_ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  private getAdminLoginAttemptKeys(email: string, ipAddress?: string) {
    return [`email:${email}`, ipAddress ? `ip:${ipAddress}` : null].filter(
      (key): key is string => Boolean(key),
    );
  }

  private assertAdminLoginAllowed(keys: string[]) {
    const now = Date.now();
    for (const key of keys) {
      const attempt = this.adminLoginAttempts.get(key);
      if (!attempt) {
        continue;
      }
      if (attempt.lockedUntil && attempt.lockedUntil > now) {
        throw new HttpException(
          "Too many admin login attempts. Try again later.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (attempt.lockedUntil && attempt.lockedUntil <= now) {
        this.adminLoginAttempts.delete(key);
      }
    }
  }

  private recordFailedAdminLogin(keys: string[]) {
    const now = Date.now();
    for (const key of keys) {
      const previous = this.adminLoginAttempts.get(key);
      const isFreshWindow =
        !previous || now - previous.firstAttemptAt > ADMIN_LOGIN_WINDOW_MS;
      const next: AdminLoginAttempt = isFreshWindow
        ? { count: 1, firstAttemptAt: now }
        : {
            ...previous,
            count: previous.count + 1,
          };

      if (next.count >= ADMIN_LOGIN_ATTEMPT_LIMIT) {
        next.lockedUntil = now + ADMIN_LOGIN_LOCK_MS;
      }

      this.adminLoginAttempts.set(key, next);
    }
  }

  private clearAdminLoginAttempts(keys: string[]) {
    keys.forEach((key) => this.adminLoginAttempts.delete(key));
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
      const revoked = await tx.refreshToken.updateMany({
        where: { id: storedToken.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          rotatedAt: new Date(),
        },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedException("Refresh token has been revoked.");
      }

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
      phoneVerifiedAt: user.phoneVerifiedAt,
      age: user.age,
      gender: user.gender,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      venues: user.venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        businessOib: venue.businessOib,
        venueType: venue.venueType,
        address: venue.address,
        city: venue.city,
        country: venue.country,
      })),
    };
  }

  async updateCustomerProfile(userId: string, dto: UpdateCustomerProfileDto) {
    const normalizedEmail = dto.email?.trim().toLowerCase();
    const firstName = dto.firstName?.trim();
    const lastName = dto.lastName?.trim();
    if (
      normalizedEmail === undefined &&
      firstName === undefined &&
      lastName === undefined
    ) {
      throw new BadRequestException("No profile changes were provided.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException("User no longer exists.");
    }
    if (user.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(
        "Only customer accounts can update customer profile.",
      );
    }

    const emailChanged =
      normalizedEmail !== undefined &&
      normalizedEmail !== user.email.toLowerCase();
    if (emailChanged) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (existingUser && existingUser.id !== user.id) {
        throw new ConflictException("Email is already registered.");
      }
    }

    let verificationToken: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...(firstName !== undefined ? { firstName } : {}),
          ...(lastName !== undefined ? { lastName } : {}),
          ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
          ...(emailChanged ? { emailVerifiedAt: null } : {}),
        },
      });

      if (emailChanged) {
        verificationToken = this.createVerificationToken();
        await tx.emailVerificationToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hashToken(verificationToken),
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
          },
        });
      }
    });

    if (verificationToken) {
      await this.sendVerificationEmail(
        normalizedEmail!,
        verificationToken,
        UserRole.CUSTOMER,
      );
    }

    return {
      user: await this.me(user.id),
      emailVerificationRequired: emailChanged,
      message: emailChanged
        ? "Profile updated. Email verification is required for the new email."
        : "Profile updated.",
    };
  }

  async requestCustomerPhoneChange(userId: string, dto: RequestPhoneChangeDto) {
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException("User no longer exists.");
    }
    if (user.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(
        "Only customer accounts can update customer phone.",
      );
    }
    await this.assertPhoneNumberAvailable(phoneNumber, user.id);

    const latestCode = await this.prisma.phoneVerificationCode.findFirst({
      where: { userId: user.id, phoneNumber, usedAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (latestCode) {
      const elapsedMs = Date.now() - latestCode.createdAt.getTime();
      if (elapsedMs < PHONE_VERIFICATION_RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil(
          (PHONE_VERIFICATION_RESEND_COOLDOWN_MS - elapsedMs) / 1000,
        );
        throw new HttpException(
          `Pričekajte ${waitSeconds} sekundi prije ponovnog slanja koda.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = this.createPhoneVerificationCode();
    const codeHash = this.hashPhoneVerificationCode(user.id, phoneNumber, code);
    const expiresAt = new Date(Date.now() + PHONE_VERIFICATION_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.phoneVerificationCode.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.phoneVerificationCode.create({
        data: {
          userId: user.id,
          phoneNumber,
          codeHash,
          expiresAt,
        },
      });
    });

    const smsResult = await this.smsService.sendVerificationCode({
      to: phoneNumber,
      code,
    });

    return {
      message: "Phone verification code was sent.",
      expiresAt,
      devVerificationCode: smsResult.delivered ? undefined : code,
    };
  }

  async verifyCustomerPhoneChange(userId: string, dto: VerifyPhoneChangeDto) {
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    const code = dto.code.trim();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException("User no longer exists.");
    }
    if (user.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(
        "Only customer accounts can update customer phone.",
      );
    }
    await this.assertPhoneNumberAvailable(phoneNumber, user.id);

    const storedCode = await this.prisma.phoneVerificationCode.findFirst({
      where: { userId: user.id, phoneNumber, usedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!storedCode || storedCode.usedAt) {
      throw new BadRequestException("Verification code is invalid.");
    }
    if (storedCode.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Verification code has expired.");
    }
    if (storedCode.attempts >= PHONE_VERIFICATION_ATTEMPT_LIMIT) {
      throw new BadRequestException("Verification code has too many attempts.");
    }
    const codeHash = this.hashPhoneVerificationCode(user.id, phoneNumber, code);
    if (storedCode.codeHash !== codeHash) {
      await this.prisma.phoneVerificationCode.update({
        where: { id: storedCode.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException("Verification code is invalid.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.phoneVerificationCode.update({
        where: { id: storedCode.id },
        data: { usedAt: new Date(), attempts: { increment: 1 } },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { phoneNumber, phoneVerifiedAt: new Date() },
      });
    });

    return {
      user: await this.me(user.id),
      message: "Phone number verified and updated.",
    };
  }

  private async consumeRegistrationPhoneToken(
    phoneNumber: string,
    token: string,
  ) {
    const tokenHash = this.hashToken(token.trim());
    const storedToken =
      await this.prisma.registrationPhoneVerificationCode.findUnique({
        where: { tokenHash },
      });

    if (
      !storedToken ||
      storedToken.phoneNumber !== phoneNumber ||
      !storedToken.verifiedAt ||
      storedToken.usedAt
    ) {
      throw new BadRequestException("Phone verification is required.");
    }
    if (storedToken.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Phone verification has expired.");
    }

    return storedToken;
  }

  private async assertPhoneNumberAvailable(
    phoneNumber: string,
    excludeUserId?: string,
  ) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        phoneNumber,
        phoneVerifiedAt: { not: null },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException(
        "Phone number is already verified on another account.",
      );
    }
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
        jti: this.createVerificationToken(),
      },
      {
        secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
        expiresIn: `${this.refreshTokenTtlDays()}d`,
      },
    );

    return { accessToken, refreshToken };
  }

  private async issueAdminAccessToken(user: {
    id: string;
    email: string;
    role: string;
  }) {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenType: "admin",
      },
      {
        secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: `${ADMIN_ACCESS_TOKEN_TTL_SECONDS}s`,
      },
    );
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
    try {
      await this.prisma.refreshToken.create({
        data: {
          userId,
          tokenHash: this.hashToken(refreshToken),
          expiresAt: this.createRefreshTokenExpiryDate(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Refresh token collision. Retry login.");
      }
      throw error;
    }
  }

  private createRefreshTokenExpiryDate() {
    return new Date(
      Date.now() + 1000 * 60 * 60 * 24 * this.refreshTokenTtlDays(),
    );
  }

  private refreshTokenTtlDays() {
    const configuredDays = Number(
      this.configService.get<string>("JWT_REFRESH_TOKEN_DAYS"),
    );
    if (Number.isFinite(configuredDays) && configuredDays >= 30) {
      return Math.floor(configuredDays);
    }
    return DEFAULT_REFRESH_TOKEN_DAYS;
  }

  private createVerificationToken() {
    return randomBytes(32).toString("hex");
  }

  private createPhoneVerificationCode() {
    return randomInt(100000, 1000000).toString();
  }

  private normalizePhoneNumber(phoneNumber: string) {
    const normalized = phoneNumber.trim().replace(/[\s().-]/g, "");
    if (/^\+[1-9]\d{5,14}$/.test(normalized)) {
      return normalized;
    }
    if (/^00[1-9]\d{5,14}$/.test(normalized)) {
      return `+${normalized.slice(2)}`;
    }
    if (/^0\d{7,14}$/.test(normalized)) {
      return `+385${normalized.slice(1)}`;
    }

    throw new BadRequestException(
      "Phone number must be in a valid international format.",
    );
  }

  private hashPhoneVerificationCode(
    userId: string,
    phoneNumber: string,
    code: string,
  ) {
    return this.hashToken(`${userId}:${phoneNumber}:${code}`);
  }

  private hashRegistrationPhoneVerificationCode(
    phoneNumber: string,
    code: string,
  ) {
    return this.hashToken(`registration:${phoneNumber}:${code}`);
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async sendVerificationEmail(
    email: string,
    token: string,
    role: UserRole | string,
  ) {
    const verificationLink =
      this.configService.getOrThrow<string>("APP_WEB_URL") +
      "/api/auth/verify-email?token=" +
      token;
    const appScheme =
      role === UserRole.CUSTOMER ? "chinchincustomer" : "chinchinvenue";
    const appVerificationLink = `${appScheme}://verify-email?token=${token}`;

    await this.emailService.sendVerificationEmail({
      to: email,
      verificationLink,
      appVerificationLink,
      token,
    });
  }

  private serializeAuthUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phoneNumber: string | null;
    phoneVerifiedAt?: Date | null;
    age: number | null;
    gender: string | null;
    role: string;
    status: string;
  }) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      phoneVerifiedAt: user.phoneVerifiedAt ?? null,
      age: user.age,
      gender: user.gender,
      role: user.role,
      status: user.status,
    };
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

  private normalizeVenueType(value?: string | null) {
    const normalized = value?.trim().toUpperCase();
    return normalized === "NIGHT_CAFFE" || normalized === "CLUB"
      ? normalized
      : "NIGHT_CAFFE";
  }
}

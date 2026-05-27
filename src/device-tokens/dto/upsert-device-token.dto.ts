import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class UpsertDeviceTokenDto {
  @IsString()
  @Length(20, 4096)
  token!: string;

  @IsOptional()
  @IsIn(["IOS", "ANDROID", "WEB", "MACOS", "WINDOWS", "LINUX", "UNKNOWN"])
  platform?:
    | "IOS"
    | "ANDROID"
    | "WEB"
    | "MACOS"
    | "WINDOWS"
    | "LINUX"
    | "UNKNOWN";

  @IsIn(["CUSTOMER", "VENUE_OWNER"])
  app!: "CUSTOMER" | "VENUE_OWNER";

  @IsOptional()
  @IsString()
  @Length(2, 120)
  deviceId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  appVersion?: string;
}

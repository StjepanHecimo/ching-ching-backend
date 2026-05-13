import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";

export class ReservationAvailabilityQueryDto {
  @IsIn(["ADVANCE", "LIVE"])
  type!: "ADVANCE" | "LIVE";

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  partySize!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  userLatitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  userLongitude?: number;
}

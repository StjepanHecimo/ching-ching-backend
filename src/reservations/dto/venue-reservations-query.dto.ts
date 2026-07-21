import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsIn,
  IsOptional,
  Max,
  Min,
} from "class-validator";

export class VenueReservationsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn([
    "ALL",
    "COMPLETED",
    "CANCELLED",
    "REFUNDED",
    "NO_SHOW",
    "REPORTED",
  ])
  status?: string;

  @IsOptional()
  @IsIn(["NEWEST", "OLDEST"])
  sort?: string;
}

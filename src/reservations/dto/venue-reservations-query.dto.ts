import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
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
}

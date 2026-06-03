import { Type } from "class-transformer";
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class CreateReservationDto {
  @IsIn(["ADVANCE", "LIVE"])
  type!: "ADVANCE" | "LIVE";

  @IsString()
  @Length(2, 120)
  tableId!: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
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

  @IsOptional()
  @IsString()
  @Length(2, 120)
  customerName?: string;

  @IsOptional()
  @IsEmail()
  @Length(4, 180)
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @Length(5, 40)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  notes?: string;
}

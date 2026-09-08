import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class PreferredReservationDrinkDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  sizeLabel?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  priceLabel?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  mixerLabel?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  mixerName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  mixerQuantity?: string;
}

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
  @Max(12)
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

  @IsOptional()
  @IsString()
  @Length(1, 120)
  preferredDrinkName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  preferredDrinkSizeLabel?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  preferredDrinkPriceLabel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PreferredReservationDrinkDto)
  preferredDrinks?: PreferredReservationDrinkDto[];
}

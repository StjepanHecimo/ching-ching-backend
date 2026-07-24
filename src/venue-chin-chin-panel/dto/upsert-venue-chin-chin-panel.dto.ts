import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class VenueChinChinPanelPromotionalDrinkDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  promoPriceLabel?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  promoSizeLabel?: string;
}

export class VenueChinChinPanelEventDto {
  @IsOptional()
  @IsString()
  @Length(2, 40)
  day?: string;

  @IsOptional()
  @IsString()
  @Length(2, 20)
  startsAt?: string;

  @IsOptional()
  @IsString()
  @Length(2, 20)
  endsAt?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  contentName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  eventName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_500_000)
  posterDataUrl?: string;

  @IsOptional()
  @IsString()
  @Length(2, 240)
  description?: string;
}

export class UpsertVenueChinChinPanelDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => VenueChinChinPanelPromotionalDrinkDto)
  promotionalDrinks!: VenueChinChinPanelPromotionalDrinkDto[];

  @IsBoolean()
  hasDraftBeer!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  draftBeers?: string[];

  @IsBoolean()
  hasEvent!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  events?: VenueChinChinPanelEventDto[];

  @IsOptional()
  @IsString()
  @Length(2, 40)
  eventDay?: string;

  @IsOptional()
  @IsString()
  @Length(2, 20)
  eventStartsAt?: string;

  @IsOptional()
  @IsString()
  @Length(2, 20)
  eventEndsAt?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  eventBand?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  eventContentName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 240)
  eventDescription?: string;
}

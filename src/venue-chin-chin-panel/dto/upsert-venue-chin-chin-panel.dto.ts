import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

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
  @Length(2, 120)
  contentName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 240)
  description?: string;
}

export class UpsertVenueChinChinPanelDto {
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  promotionalDrinks!: string[];

  @IsBoolean()
  hasDraftBeer!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
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

import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

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
  @Length(2, 240)
  eventDescription?: string;
}

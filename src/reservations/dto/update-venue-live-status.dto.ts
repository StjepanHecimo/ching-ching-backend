import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class UpdateVenueLiveStatusDto {
  @IsBoolean()
  isLive!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isChinChinPanelListed?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  advanceChinChinTableIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  liveChinChinTableIds?: string[];

  @IsOptional()
  @IsString()
  liveRoomLabel?: string;
}

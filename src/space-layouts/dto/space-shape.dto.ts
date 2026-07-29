import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { LayoutPhotoDto } from "./layout-photo.dto";

export class SpaceShapeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  roomLabel?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  requestedTableCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  widthMeters?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  lengthMeters?: number;

  @IsOptional()
  @IsIn(["rectangle", "custom"])
  shapeType?: "rectangle" | "custom";

  @IsOptional()
  @IsBoolean()
  isTemporarySpace?: boolean;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  outline?: Array<{
    x: number;
    y: number;
  }>;

  @IsOptional()
  @IsObject()
  features?: {
    hasToilet?: boolean;
    hasBar?: boolean;
    hasStage?: boolean;
    hasBilliardsOrDarts?: boolean;
    hasTv?: boolean;
    hasDjMusicCorner?: boolean;
    hasStairs?: boolean;
    hasMainWalkway?: boolean;
  };

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LayoutPhotoDto)
  photos?: LayoutPhotoDto[];
}

import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { LayoutPhotoDto } from "./layout-photo.dto";

export class RequestTableUpdatePreviewDto {
  @IsString()
  @Length(2, 120)
  tableId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LayoutPhotoDto)
  photo?: LayoutPhotoDto;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(12)
  seats?: number;

  @IsOptional()
  @IsIn(["STANDARD", "LARGE"])
  chinChinTier?: "STANDARD" | "LARGE";
}

export class RequestTableUpdatesPreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestTableUpdatePreviewDto)
  updates!: RequestTableUpdatePreviewDto[];

  @IsOptional()
  @IsString()
  @Length(2, 500)
  ownerNotes?: string;
}

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  ValidateNested,
} from "class-validator";
import { LayoutPhotoDto } from "./layout-photo.dto";
import { LayoutReferenceFileDto } from "./layout-reference-file.dto";
import { SpaceShapeDto } from "./space-shape.dto";

export class GenerateSpaceLayoutPreviewDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => LayoutReferenceFileDto)
  floorPlanFile!: LayoutReferenceFileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SpaceShapeDto)
  space?: SpaceShapeDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SpaceShapeDto)
  rooms?: SpaceShapeDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => LayoutPhotoDto)
  venuePhotos?: LayoutPhotoDto[];
}

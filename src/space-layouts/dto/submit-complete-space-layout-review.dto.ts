import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";
import { LayoutPhotoDto } from "./layout-photo.dto";
import { LayoutReferenceFileDto } from "./layout-reference-file.dto";
import { SavedLayoutImageDto } from "./save-space-layout.dto";
import { SpaceShapeDto } from "./space-shape.dto";

export class SubmitCompleteSpaceLayoutReviewDto {
  @IsUUID()
  venueId!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LayoutPhotoDto)
  photos?: LayoutPhotoDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => LayoutPhotoDto)
  venuePhotos?: LayoutPhotoDto[];

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

  @IsObject()
  aiSuggestion!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  selectedLayoutOptionId?: string;

  @IsOptional()
  @IsIn(["flutter-editor", "api", "admin"])
  editedBy?: "flutter-editor" | "api" | "admin";

  @IsObject()
  layout!: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => SavedLayoutImageDto)
  renderedImage?: SavedLayoutImageDto;

  @IsOptional()
  @IsIn(["ADD_ROOM"])
  changeRequestType?: "ADD_ROOM";

  @IsOptional()
  @IsString()
  @Length(2, 500)
  ownerNotes?: string;
}

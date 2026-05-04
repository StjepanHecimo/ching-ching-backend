import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";
import { LayoutPhotoDto } from "./layout-photo.dto";
import { SpaceShapeDto } from "./space-shape.dto";

export class CreateSpaceLayoutDto {
  @IsUUID()
  venueId!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => LayoutPhotoDto)
  photos!: LayoutPhotoDto[];

  @IsDefined()
  @ValidateNested()
  @Type(() => SpaceShapeDto)
  space!: SpaceShapeDto;
}

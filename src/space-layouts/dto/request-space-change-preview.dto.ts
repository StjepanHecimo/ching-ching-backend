import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";
import { LayoutPhotoDto } from "./layout-photo.dto";

export class RequestSpaceChangePreviewDto {
  @IsIn(["EDIT_SPACE", "DELETE_ROOM", "PROFILE_IMAGES"])
  type!: "EDIT_SPACE" | "DELETE_ROOM" | "PROFILE_IMAGES";

  @IsOptional()
  @IsString()
  @Length(1, 160)
  roomLabel?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  remodelLevel?: string;

  @IsOptional()
  @IsString()
  @Length(2, 800)
  ownerNotes?: string;

  @IsOptional()
  @IsString()
  @Length(10, 1000)
  profileDescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => LayoutPhotoDto)
  attachments?: LayoutPhotoDto[];
}

import { Type } from "class-transformer";
import { IsDefined, IsOptional, IsString, Length, ValidateNested } from "class-validator";
import { LayoutPhotoDto } from "./layout-photo.dto";

export class RequestTableAdditionPreviewDto {
  @IsString()
  @Length(2, 120)
  tableId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LayoutPhotoDto)
  photo!: LayoutPhotoDto;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  ownerNotes?: string;
}

import { Type } from "class-transformer";
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

class CustomerProblemReportPhotoDto {
  @IsString()
  @Length(1, 160)
  fileName!: string;

  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/)
  mimeType!: string;

  @IsString()
  @IsOptional()
  @MaxLength(3_000_000)
  dataUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  remoteUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  key?: string;
}

export class CreateCustomerProblemReportDto {
  @IsString()
  @Length(5, 1000)
  problemDescription!: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerProblemReportPhotoDto)
  photo?: CustomerProblemReportPhotoDto;
}

export class CreateCustomerProblemReportPhotoUploadUrlDto {
  @IsString()
  @Length(2, 180)
  fileName!: string;

  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/)
  mimeType!: string;
}

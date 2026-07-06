import { Type } from "class-transformer";
import {
  IsObject,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from "class-validator";

class CustomerProblemReportPhotoDto {
  @IsString()
  @Length(1, 160)
  fileName!: string;

  @IsString()
  @Length(5, 80)
  mimeType!: string;

  @IsString()
  @MaxLength(3_000_000)
  dataUrl!: string;
}

export class CreateCustomerProblemReportDto {
  @IsString()
  @Length(5, 1000)
  problemDescription!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => CustomerProblemReportPhotoDto)
  photo!: CustomerProblemReportPhotoDto;
}

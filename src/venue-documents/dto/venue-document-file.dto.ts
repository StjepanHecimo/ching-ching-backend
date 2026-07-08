import { IsOptional, IsString, Length, Matches } from "class-validator";

export class VenueDocumentFileDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  id?: string;

  @IsString()
  @Length(1, 180)
  fileName!: string;

  @IsString()
  @Matches(/^(application\/pdf|image\/jpeg)$/)
  mimeType!: string;

  @IsString()
  @Length(10, 20_000_000)
  dataUrl!: string;
}

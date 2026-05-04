import { IsOptional, IsString, IsUrl, Length, Matches } from "class-validator";

export class LayoutPhotoDto {
  @IsString()
  @Length(2, 180)
  fileName!: string;

  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp|heic|heif)$/)
  mimeType!: string;

  @IsOptional()
  @IsString()
  dataUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  remoteUrl?: string;
}

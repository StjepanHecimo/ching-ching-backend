import { IsOptional, IsString, IsUrl, Length, Matches } from "class-validator";

export class LayoutReferenceFileDto {
  @IsString()
  @Length(2, 180)
  fileName!: string;

  @IsString()
  @Matches(/^(image\/(jpeg|jpg|png|webp|heic|heif)|application\/pdf)$/)
  mimeType!: string;

  @IsOptional()
  @IsString()
  dataUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  remoteUrl?: string;
}

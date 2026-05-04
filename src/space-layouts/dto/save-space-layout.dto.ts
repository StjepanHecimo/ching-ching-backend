import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
} from "class-validator";

export class SavedLayoutImageDto {
  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/)
  mimeType!: string;

  @IsOptional()
  @IsString()
  dataUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  remoteUrl?: string;
}

export class SaveSpaceLayoutDto {
  @IsOptional()
  @IsString()
  selectedLayoutOptionId?: string;

  @IsOptional()
  @IsIn(["flutter-editor", "api", "admin"])
  editedBy?: "flutter-editor" | "api" | "admin";

  @IsObject()
  layout!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  renderedImage?: SavedLayoutImageDto;
}

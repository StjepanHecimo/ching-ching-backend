import { IsString, Length, Matches } from "class-validator";

export class CreateTablePhotoUploadUrlDto {
  @IsString()
  @Length(2, 180)
  fileName!: string;

  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/)
  mimeType!: string;
}

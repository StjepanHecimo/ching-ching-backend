import { IsString, Length } from "class-validator";

export class RequestTableDeletionPreviewDto {
  @IsString()
  @Length(2, 120)
  tableId!: string;

  @IsString()
  @Length(2, 500)
  ownerNotes!: string;
}

import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsOptional, IsString, Length, ValidateNested } from "class-validator";
import { VenueDocumentFileDto } from "./venue-document-file.dto";

export class SubmitVenueDocumentsDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => VenueDocumentFileDto)
  documents!: VenueDocumentFileDto[];

  @IsOptional()
  @IsString()
  @Length(2, 500)
  ownerNotes?: string;
}

import { IsOptional, IsString, Length } from "class-validator";

export class ReviewVenueDocumentsDto {
  @IsOptional()
  @IsString()
  @Length(2, 500)
  reviewNotes?: string;
}

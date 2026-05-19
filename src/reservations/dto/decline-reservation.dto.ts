import { IsOptional, IsString, Length } from "class-validator";

export class DeclineReservationDto {
  @IsOptional()
  @IsString()
  @Length(2, 500)
  notes?: string;
}

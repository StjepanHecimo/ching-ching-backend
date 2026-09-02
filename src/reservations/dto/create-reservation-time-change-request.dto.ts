import { IsISO8601, IsOptional } from "class-validator";

export class CreateReservationTimeChangeRequestDto {
  @IsISO8601()
  requestedStartAt!: string;

  @IsOptional()
  @IsISO8601()
  requestedEndAt?: string;
}

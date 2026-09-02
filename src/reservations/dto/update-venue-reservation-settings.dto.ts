import { IsInt, IsOptional, Max, Min } from "class-validator";

export class UpdateVenueReservationSettingsDto {
  @IsInt()
  @Min(12 * 60)
  @Max(25 * 60 + 59)
  reservationWindowStartMinutes!: number;

  @IsInt()
  @Min(12 * 60)
  @Max(26 * 60)
  reservationWindowEndMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(18 * 60)
  @Max(25 * 60 + 59)
  liveReservationWindowStartMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(18 * 60)
  @Max(26 * 60)
  liveReservationWindowEndMinutes?: number;
}

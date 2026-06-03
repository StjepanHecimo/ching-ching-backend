import { IsInt, Max, Min } from "class-validator";

export class UpdateVenueReservationSettingsDto {
  @IsInt()
  @Min(12 * 60)
  @Max(23 * 60)
  reservationWindowStartMinutes!: number;

  @IsInt()
  @Min(12 * 60)
  @Max(23 * 60)
  reservationWindowEndMinutes!: number;
}

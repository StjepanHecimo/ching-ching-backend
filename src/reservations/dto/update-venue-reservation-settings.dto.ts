import { IsInt, Max, Min } from "class-validator";

export class UpdateVenueReservationSettingsDto {
  @IsInt()
  @Min(12 * 60)
  @Max(25 * 60 + 59)
  reservationWindowStartMinutes!: number;

  @IsInt()
  @Min(12 * 60)
  @Max(26 * 60)
  reservationWindowEndMinutes!: number;
}

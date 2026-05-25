import { IsInt, Max, Min } from "class-validator";

export class UpdateVenueReservationSettingsDto {
  @IsInt()
  @Min(18 * 60)
  @Max(23 * 60 + 30)
  reservationWindowStartMinutes!: number;

  @IsInt()
  @Min(18 * 60)
  @Max(23 * 60 + 30)
  reservationWindowEndMinutes!: number;
}

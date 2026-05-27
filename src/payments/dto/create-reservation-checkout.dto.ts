import { IsBoolean, IsOptional } from "class-validator";

export class CreateReservationCheckoutDto {
  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;
}

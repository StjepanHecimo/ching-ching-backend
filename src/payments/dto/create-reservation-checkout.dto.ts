import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CreateReservationCheckoutDto {
  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsBoolean()
  useDefaultPaymentMethod?: boolean;
}

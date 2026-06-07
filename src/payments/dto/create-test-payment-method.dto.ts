import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class CreateTestPaymentMethodDto {
  @IsString()
  @Length(12, 24)
  cardNumber!: string;

  @IsOptional()
  @IsString()
  @Length(2, 32)
  brand?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2026)
  @Max(2100)
  expiryYear!: number;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  holderName?: string;
}

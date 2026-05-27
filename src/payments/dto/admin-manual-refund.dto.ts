import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from "class-validator";

export class AdminManualRefundDto {
  @IsIn(["CUSTOMER", "VENUE"])
  target!: "CUSTOMER" | "VENUE";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  reason?: string;
}

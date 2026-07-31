import { IsIn, IsString, MinLength } from "class-validator";

export class UpdateVenueLivePricingBoostDto {
  @IsIn(["X1", "X2", "X3"])
  livePricingBoost!: "X1" | "X2" | "X3";

  @IsString()
  @MinLength(1)
  adminPassword!: string;
}

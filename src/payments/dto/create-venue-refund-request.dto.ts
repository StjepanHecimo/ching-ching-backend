import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

export class CreateVenueRefundRequestDto {
  @IsString()
  @Length(5, 1000)
  problemDescription!: string;

  @IsOptional()
  @IsBoolean()
  releaseNoShowTable?: boolean;
}

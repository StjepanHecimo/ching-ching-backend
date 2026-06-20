import { IsString, Length } from "class-validator";

export class CreateVenueRefundRequestDto {
  @IsString()
  @Length(5, 1000)
  problemDescription!: string;
}

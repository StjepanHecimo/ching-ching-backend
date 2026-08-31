import { IsOptional, IsString, Length, Matches } from "class-validator";

export class RequestPhoneChangeDto {
  @IsString()
  @Length(6, 30)
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @Length(11, 11)
  @Matches(/^[A-Za-z0-9+/]{11}$/)
  androidAppHash?: string;
}

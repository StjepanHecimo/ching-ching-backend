import { IsString, Length } from "class-validator";

export class VerifyPhoneChangeDto {
  @IsString()
  @Length(6, 30)
  phoneNumber!: string;

  @IsString()
  @Length(4, 8)
  code!: string;
}

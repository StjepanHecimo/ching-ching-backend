import { IsString, Length } from "class-validator";

export class RequestRegistrationPhoneDto {
  @IsString()
  @Length(6, 30)
  phoneNumber!: string;
}

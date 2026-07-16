import { IsString, Length } from "class-validator";

export class RequestPhoneChangeDto {
  @IsString()
  @Length(6, 30)
  phoneNumber!: string;
}

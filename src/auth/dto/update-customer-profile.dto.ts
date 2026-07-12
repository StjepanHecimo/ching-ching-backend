import { IsEmail, IsString, Length } from "class-validator";

export class UpdateCustomerProfileDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 30)
  phoneNumber!: string;
}

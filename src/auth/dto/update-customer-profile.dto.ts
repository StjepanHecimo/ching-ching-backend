import { IsEmail, IsOptional, IsString, Length } from "class-validator";

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

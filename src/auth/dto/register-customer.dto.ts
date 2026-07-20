import {
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class RegisterCustomerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 80)
  firstName!: string;

  @IsString()
  @Length(2, 80)
  lastName!: string;

  @IsString()
  @Length(6, 30)
  phoneNumber!: string;

  @IsString()
  @Length(32, 256)
  phoneVerificationToken!: string;

  @IsInt()
  @Min(16)
  @Max(100)
  age!: number;

  @IsIn(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"])
  gender!: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";
}

import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

export class RegisterVenueOwnerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 80)
  firstName!: string;

  @IsString()
  @Length(2, 80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @Length(6, 30)
  phoneNumber?: string;

  @IsString()
  @Length(2, 120)
  venueName!: string;

  @IsOptional()
  @IsIn(["CAFE", "NIGHT_CAFFE", "CLUB"])
  venueType?: "CAFE" | "NIGHT_CAFFE" | "CLUB";

  @IsString()
  @Matches(/^\d{11}$/, {
    message: "venueBusinessOib must contain exactly 11 digits",
  })
  venueBusinessOib!: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  venueAddress?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  venueCity?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  venueCountry?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  venueLatitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  venueLongitude?: number;
}

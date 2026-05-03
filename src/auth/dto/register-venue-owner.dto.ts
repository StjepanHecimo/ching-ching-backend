import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class RegisterVenueOwnerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

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
}

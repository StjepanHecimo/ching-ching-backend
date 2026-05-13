import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class UpdateReservationStatusDto {
  @IsIn([
    "REQUESTED",
    "CONFIRMED",
    "CANCELLED",
    "RESERVED",
    "CHECK_IN_PENDING",
    "CHECKED_IN",
    "SEATED",
    "CANCELLED_BY_USER",
    "COMPLETED",
    "NO_SHOW",
    "RELEASED",
  ])
  status!:
    | "REQUESTED"
    | "CONFIRMED"
    | "CANCELLED"
    | "RESERVED"
    | "CHECK_IN_PENDING"
    | "CHECKED_IN"
    | "SEATED"
    | "CANCELLED_BY_USER"
    | "COMPLETED"
    | "NO_SHOW"
    | "RELEASED";

  @IsOptional()
  @IsString()
  @Length(2, 500)
  notes?: string;
}

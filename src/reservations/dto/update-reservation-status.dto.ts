import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class UpdateReservationStatusDto {
  @IsIn([
    "REQUESTED",
    "PENDING_VENUE_CONFIRMATION",
    "CONFIRMED",
    "DECLINED",
    "EXPIRED",
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
    | "PENDING_VENUE_CONFIRMATION"
    | "CONFIRMED"
    | "DECLINED"
    | "EXPIRED"
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

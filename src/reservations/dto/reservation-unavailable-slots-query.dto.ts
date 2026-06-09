import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class ReservationUnavailableSlotsQueryDto {
  @IsIn(["ADVANCE", "LIVE"])
  type!: "ADVANCE" | "LIVE";

  @IsDateString()
  date!: string;

  @IsString()
  @Length(2, 120)
  tableId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  partySize!: number;
}

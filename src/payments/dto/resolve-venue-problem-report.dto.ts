import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Min } from "class-validator";

export class ResolveVenueProblemReportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  adminNotes?: string;
}

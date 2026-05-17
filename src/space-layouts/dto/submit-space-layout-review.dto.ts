import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class SubmitSpaceLayoutReviewDto {
  @IsOptional()
  @IsString()
  @Length(2, 500)
  ownerNotes?: string;
}

export class ReviewSpaceLayoutDto {
  @IsIn(["approve", "request_changes"])
  decision!: "approve" | "request_changes";

  @IsOptional()
  @IsString()
  @Length(2, 500)
  reviewNotes?: string;

  @IsOptional()
  adjustedLayout?: Record<string, unknown>;
}

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

export class SubmitSpaceLayoutReviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  topDrinks!: string[];

  @IsString()
  @Length(2, 80)
  musicType!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  themeTags!: string[];

  @IsBoolean()
  servesFood!: boolean;

  @IsOptional()
  @IsString()
  @Length(2, 240)
  foodDescription?: string;

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

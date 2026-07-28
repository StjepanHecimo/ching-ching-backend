import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

export class ApproveAdjustedLayoutPreviewDto {
  @IsObject()
  layout!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  adjustedBy?: string;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  reviewNotes?: string;

  @IsOptional()
  @IsBoolean()
  forceApprove?: boolean;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  adminTablePhotos?: Array<Record<string, unknown>>;
}

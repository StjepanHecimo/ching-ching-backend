import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class SpaceShapeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  roomLabel?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  requestedTableCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  widthMeters?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  lengthMeters?: number;

  @IsOptional()
  @IsIn(["rectangle", "custom"])
  shapeType?: "rectangle" | "custom";

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  outline?: Array<{
    x: number;
    y: number;
  }>;
}

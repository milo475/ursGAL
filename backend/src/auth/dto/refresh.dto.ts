import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  // V5: httpOnly cookie-гоор ирэх үед body хоосон байж болно —
  // controller cookie-г уншина. Аль нь ч байхгүй бол service 401 өгнө.
  @IsOptional()
  @MaxLength(1000)
  refreshToken?: string;
}

import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Public } from '../auth/decorators/public.decorator';
import { UPLOADS_DIR } from '../uploads.config';
import { SAFE_UPLOAD_NAME, UploadAccessGuard } from './upload-access.guard';

/**
 * Байршуулсан файлыг үйлчлэх — эрхийн хамгаалалттай (V5).
 * Хандах дүрмийг `UploadAccessGuard` тодорхойлно.
 */
const CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

@Controller('uploads')
export class UploadsController {
  /**
   * `@Public()` нь ГЛОБАЛ JwtAuthGuard-ыг чөлөөлнө — эрхийг доорх
   * `UploadAccessGuard` өөрөө шийднэ (барааны зураг нээлттэй, бусад
   * нь нэвтрэлт шаардана). Хоёулаа ажиллавал нээлттэй зураг ч
   * хаагдана.
   */
  @Public()
  @UseGuards(UploadAccessGuard)
  @Get(':name')
  @Header('X-Content-Type-Options', 'nosniff')
  serve(@Param('name') name: string, @Res() res: Response): void {
    if (!SAFE_UPLOAD_NAME.test(name)) {
      throw new BadRequestException('Файлын нэр буруу');
    }

    const path = join(UPLOADS_DIR, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new NotFoundException('Файл олдсонгүй');
    }

    res.setHeader(
      'Content-Type',
      CONTENT_TYPE[extname(name).toLowerCase()] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    createReadStream(path).pipe(res);
  }
}

import { BadRequestException } from '@nestjs/common';
import { openSync, readSync, closeSync, unlinkSync } from 'node:fs';

/**
 * ЗУРГИЙН ЖИНХЭНЭ АГУУЛГЫГ ШАЛГАХ (V5).
 *
 * ═══ ЯАГААД ХЭРЭГТЭЙ ВЭ ═══
 * Multer-ийн `fileFilter` нь зөвхөн КЛИЕНТИЙН ЗАРЛАСАН `mimetype`-ыг
 * хардаг. Түүнийг хүссэнээрээ хуурамчлах боломжтой: HTML/скрипт
 * агуулгатай файлыг `Content-Type: image/png` гэж илгээхэд хүлээн
 * авагдаж, сервер дээр хадгалагдана.
 *
 * Файлын ЭХНИЙ БАЙТУУД (magic bytes) нь хуурамчлагдахгүй — тэдгээр
 * нь форматын өөрийнх нь тодорхойлолт. Тиймээс хадгалсны ДАРАА
 * агуулгыг нь уншиж шалгана; таарахгүй бол файлыг устгаад
 * татгалзана.
 *
 * (fileFilter дотор шалгаж болохгүй: diskStorage ашиглаж байгаа тул
 * тэр мөчид файл дискэн дээр бүрэн бичигдээгүй байдаг.)
 */

/** Форматын гарын үсэг — эхний байтуудаар танина */
const SIGNATURES: Array<{ ext: string; check: (b: Buffer) => boolean }> = [
  {
    ext: 'png',
    // 89 50 4E 47 0D 0A 1A 0A
    check: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    ext: 'jpeg',
    // FF D8 FF
    check: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'webp',
    // "RIFF" .... "WEBP"
    check: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/**
 * Файл жинхэнэ зураг мөн эсэхийг шалгана.
 * Биш бол файлыг УСТГААД `BadRequestException` шиднэ.
 *
 * @param path хадгалагдсан файлын бүтэн зам
 */
export function assertRealImage(path: string): void {
  let head: Buffer;
  try {
    const fd = openSync(path, 'r');
    try {
      head = Buffer.alloc(12);
      readSync(fd, head, 0, 12, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new BadRequestException('Файлыг уншиж чадсангүй');
  }

  if (SIGNATURES.some((s) => s.check(head))) return;

  // Хуурамч файлыг сервер дээр үлдээхгүй
  try {
    unlinkSync(path);
  } catch {
    // устгаж чадаагүй ч татгалзсан хэвээр
  }
  throw new BadRequestException(
    'Зураг биш файл байна. PNG, JPEG эсвэл WebP оруулна уу.',
  );
}

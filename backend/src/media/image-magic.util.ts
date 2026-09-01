/**
 * Зургийн ЖИНХЭНЭ төрлийг агуулгын эхний байтуудаас (magic number) тодорхойлно.
 * Клиентийн зарласан Content-Type хуурамчлагдаж болох тул (R-2) байршуулсан
 * файлын агуулгыг серверт бодитоор шалгахад ашиглана.
 *
 * Дэмжих зөвшөөрөгдсөн төрлүүд delivery-ийн ALLOWED_MIME-тэй ижил:
 * image/jpeg, image/png, image/webp. Танигдахгүй бол null.
 */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 && // P
    buf[2] === 0x4e && // N
    buf[3] === 0x47 && // G
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: "RIFF"????"WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}

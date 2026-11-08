import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Нэвтэрсэн бүх хэрэглэгчид харагдах public түлхүүрүүд + default утга */
export const PUBLIC_SETTINGS: Record<string, string> = {
  companyName: 'Ochir',
  companyPhone: '',
  // Нийтийн захиалгын хуудсанд харагдах данс (V5)
  bankName: '',
  bankAccount: '',
  bankHolder: '',
  /**
   * Хугацаа дуусахаас хэдэн хоногийн ӨМНӨ анхааруулах вэ (V5).
   * Компанийн дүрэм: «дуусахаас 30 хоногийн өмнө устгалд оруулна».
   */
  expiryWarnDays: '30',
  /**
   * DM-ийн хариу загвар (V5).
   *
   * Захиалга баталгаажсаны дараа борлуулагч Instagram/Facebook руу
   * буцаж бичдэг мессеж. Өмнө нь ҮҮНИЙГ ГАРААР бичдэг байсан —
   * өдөрт 20 захиалга бол өдөрт 20 удаа.
   *
   * Орлуулгууд (гүйцэтгэл нь frontend/src/lib/dmMessage.js-д):
   *   {нэр} {дугаар} {бараа} {нийт} {хаяг} {данс} {утас} {компани}
   */
  /**
   * Давтан захиалга (V5) — нэмэлт бүтээгдэхүүн дуусах дөхөхөд
   * үйлчлүүлэгчид сануулах логикийн тохиргоо.
   */
  /** Бараанд тусад нь заагаагүй бол нэг ширхэг хэдэн хоног хүрэх вэ */
  defaultDaysSupply: '30',
  /** Дуусахаас хэдэн хоногийн ӨМНӨ жагсаалтад гарах вэ */
  reorderLeadDays: '7',
  /** Хэдэн хоног хоцорсныг хойш нь жагсаалтаас хасах вэ (хаясан үйлчлүүлэгч) */
  reorderMaxOverdue: '60',
  /** Сануулгын мессежийн загвар — {нэр} {бараа} {хоног} {компани} {утас} */
  reorderTemplate: [
    'Сайн байна уу, {нэр}!',
    '',
    'Таны авсан {бараа} дуусах дөхөж байгаа байх.',
    'Дахин захиалах бол энэ мессежид хариулаарай — бид бэлдье.',
    '',
    'Баярлалаа!',
    '',
    'Холбоо барих: {утас}',
  ].join('\n'),
  dmTemplate: [
    'Сайн байна уу, {нэр}!',
    '',
    'Таны захиалга баталгаажлаа. Дугаар: {дугаар}',
    '',
    '{бараа}',
    'Нийт: {нийт}',
    '',
    'Хүргэх хаяг:',
    '{хаяг}',
    '',
    '{данс}',
    '',
    'Жолооч хүргэхийн өмнө утсаар холбогдоно.',
    'Баярлалаа!',
    '',
    'Холбоо барих: {утас}',
  ].join('\n'),
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public түлхүүрүүд — DB-д байхгүй бол default */
  async getPublic(): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: Object.keys(PUBLIC_SETTINGS) } },
    });
    const out = { ...PUBLIC_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async get(key: string): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? PUBLIC_SETTINGS[key] ?? '';
  }

  async isEnabled(key: string): Promise<boolean> {
    return (await this.get(key)) === 'true';
  }

  /** Зөвшөөрөгдсөн түлхүүрүүдийг upsert-ээр хадгална */
  async setMany(entries: Record<string, string>) {
    for (const [key, value] of Object.entries(entries)) {
      if (!(key in PUBLIC_SETTINGS)) {
        throw new BadRequestException(`Буруу тохиргооны түлхүүр: ${key}`);
      }
      if (typeof value !== 'string') {
        throw new BadRequestException('Тохиргооны утга string байна');
      }
    }
    await this.prisma.$transaction(
      Object.entries(entries).map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    return this.getPublic();
  }

}

import { Injectable } from '@nestjs/common';
import { parseDateRange } from '../date-range.util';
import { formatShortAddress } from '../orders/address.util';
import { PrismaService } from '../prisma/prisma.service';
import { categoryLabel } from '../finance/finance-categories';
import { FinanceService } from '../finance/finance.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';

const range = (from?: string, to?: string) => parseDateRange(from, to, 30);

const fmtDate = (d: Date | null) =>
  d
    ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
        .replace('T', ' ')
    : '';

/**
 * CSV escape: хашилт, таслал, мөр агуулбал давхар хашилтад.
 *
 * ═══ ФОРМУЛЫН ХАЛДЛАГААС ХАМГААЛНА (V5) ═══
 * Үйлчлүүлэгч нэрээ `=HYPERLINK(...)` гэж өгвөл ажилтан CSV-г
 * Excel-ээр нээхэд ФОРМУЛА БОЛЖ АЖИЛЛАДАГ байв — фишинг линк,
 * өгөгдөл урсгах суваг. Давхар хашилт үүнээс хамгаалдаггүй:
 * Excel хашилтыг тайлаад л формулаа ажиллуулна.
 *
 * `=`, `+`, `-`, `@`, tab, CR-ээр эхэлсэн утгын өмнө `'` залгана —
 * Excel түүнийг энгийн текст гэж үзнэ. ЖИНХЭНЭ СӨРӨГ ТООГ хөндөхгүй
 * (тайланд «-171500.00» олон бий) — цэвэр тоо формула биш.
 */
function cell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = "'" + s;
  }
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel-д кирилл зөв гарахын тулд UTF-8 BOM-той CSV угсарна */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const STATUS_MN: Record<string, string> = {
  NEW: 'Шинэ',
  CONFIRMED: 'Баталгаажсан',
  PREPARING: 'Бэлтгэж буй',
  READY: 'Бэлэн',
  COMPLETED: 'Дууссан',
  CANCELLED: 'Цуцлагдсан',
};
const DELIVERY_MN: Record<string, string> = {
  PENDING: 'Хүлээгдэж буй',
  ASSIGNED: 'Хуваарилагдсан',
  ON_THE_WAY: 'Замд яваа',
  DELIVERED: 'Хүргэгдсэн',
  FAILED: 'Амжилтгүй',
};
const REASON_MN: Record<string, string> = {
  PURCHASE_IN: 'Орлого',
  MANUAL_OUT: 'Зарлага',
  CORRECTION: 'Тохируулга',
  INITIAL: 'Эхний орлого',
  ORDER: 'Захиалга',
  ORDER_CANCEL: 'Цуцлалт',
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  async deliveryCsv(from?: string, to?: string) {
    const { start, end } = range(from, to);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: {
        assignedDriver: { select: { fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return toCsv(
      [
        'Захиалгын дугаар',
        'Огноо',
        'Харилцагч',
        'Утас',
        'Хаяг',
        'Барааны тоо',
        'Дүн',
        'Статус',
        'Хүргэлтийн статус',
        'Жолооч',
        'Хүргэсэн огноо',
      ],
      orders.map((o) => [
        o.orderNo,
        fmtDate(o.createdAt),
        o.customerName ?? '',
        o.phone,
        formatShortAddress(o),
        o._count.items,
        String(o.totalAmount),
        STATUS_MN[o.orderStatus] ?? o.orderStatus,
        DELIVERY_MN[o.deliveryStatus] ?? o.deliveryStatus,
        o.assignedDriver?.fullName ?? '',
        fmtDate(o.deliveredAt),
      ]),
    );
  }

  async inventoryCsv(from?: string, to?: string) {
    const { start, end } = range(from, to);
    const moves = await this.prisma.stockMovement.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: {
        product: { select: { name: true, sku: true } },
        user: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return toCsv(
      ['Огноо', 'Бараа', 'SKU', 'Өөрчлөлт', 'Шалтгаан', 'Тэмдэглэл', 'Хэрэглэгч'],
      moves.map((m) => [
        fmtDate(m.createdAt),
        m.product?.name ?? '—',
        m.product?.sku ?? '—',
        m.qtyChange,
        REASON_MN[m.reason] ?? m.reason,
        m.note ?? '',
        m.user?.fullName ?? '',
      ]),
    );
  }

  async financeCsv(from?: string, to?: string) {
    const { start, end } = range(from, to);
    const entries = await this.prisma.financeEntry.findMany({
      where: { entryDate: { gte: start, lte: end } },
      include: { createdBy: { select: { fullName: true } } },
      orderBy: { entryDate: 'asc' },
    });
    return toCsv(
      ['Огноо', 'Төрөл', 'Ангилал', 'Дүн', 'Тэмдэглэл', 'Бүртгэсэн'],
      entries.map((e) => [
        fmtDate(e.entryDate),
        e.type === 'INCOME' ? 'Орлого' : 'Зарлага',
        categoryLabel(e.type, e.category),
        String(e.amount),
        e.note ?? '',
        e.createdBy?.fullName ?? '',
      ]),
    );
  }

  /**
   * ОРЛОГО ТАЙЛАН CSV — нягтлан руу өгөх файл.
   *
   * Мөрөөр нь Excel-д буулгахад бэлэн бүтэцтэй: борлуулалт, ЗБӨ,
   * нийт ашиг, зардал ангиллаар, цэвэр ашиг. Төгсгөлд нь тайланд
   * ОРООГҮЙ мөнгөн гүйлгээг тусад нь жагсаана — нягтлан яагаад
   * хасагдсаныг харж, өөрийн бүртгэлдээ зөв тусгана.
   */
  async pnlCsv(from: string | undefined, to: string | undefined, user: AuthUser) {
    const { start, end } = range(from, to);
    const d = await this.finance.pnl(start, end, user);

    const rows: unknown[][] = [
      ['Борлуулалт', d.revenue],
      ['Зарсан барааны өртөг', `-${d.cogs}`],
      ['НИЙТ АШИГ', d.grossProfit],
    ];
    if (Number(d.otherIncome) !== 0) rows.push(['Бусад орлого', d.otherIncome]);
    for (const e of d.expenses) rows.push([e.label, `-${e.amount}`]);
    rows.push(['Зардлын дүн', `-${d.expenseTotal}`]);
    rows.push(['ЦЭВЭР АШИГ', d.netProfit]);

    if (d.excluded.length) {
      rows.push([], ['Тайланд ороогүй мөнгөн гүйлгээ', '']);
      for (const e of d.excluded) rows.push([e.label, e.amount]);
    }

    return toCsv(
      [`Орлого тайлан ${fmtDate(start).slice(0, 10)} — ${fmtDate(end).slice(0, 10)}`, '₮'],
      rows,
    );
  }
}

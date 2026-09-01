import { open, unlink } from 'node:fs/promises';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  OrderStatus,
  Prisma,
} from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { formatFullAddress, formatShortAddress } from '../orders/address.util';
import { PrismaService } from '../prisma/prisma.service';
import { detectImageMime } from '../media/image-magic.util';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Байршуулсан зургийн ЖИНХЭНЭ агуулгыг (magic byte) шалгаж, зарласан MIME
 * төрөлтэй нь таарч байгаа эсэхийг батална (R-2). Клиент Content-Type-ыг
 * хуурамчлаж болох тул зөвхөн multer-ийн fileFilter (mimetype/өргөтгөл)
 * хангалтгүй. Таарахгүй бол дискнээс устгаж алдаа шиднэ — хуурамч агуулгатай
 * файл (ж: .png нэртэй HTML/скрипт) серверт үлдэхгүй.
 */
async function assertRealImage(file: Express.Multer.File): Promise<void> {
  let detected: string | null = null;
  const handle = await open(file.path, 'r');
  try {
    const buf = Buffer.alloc(12);
    await handle.read(buf, 0, 12, 0);
    detected = detectImageMime(buf);
  } finally {
    await handle.close();
  }

  if (!detected || detected !== file.mimetype) {
    // Хуурамч/танигдахгүй файлыг дискэн дээр үлдээхгүй
    await unlink(file.path).catch(() => undefined);
    throw new BadRequestException(
      'Файлын агуулга зураг биш байна (jpg/png/webp байх ёстой)',
    );
  }
}

const DRIVER_SELECT = {
  select: { id: true, username: true, fullName: true },
};

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Жолооч хуваарилах.
   *
   * orderStatus-ыг ЭНД өөрчилдөггүй (READY/SHIPPED болгодоггүй) — сонголтын
   * тайлбар: DeliveryStatus enum (PENDING→ASSIGNED→ON_THE_WAY→DELIVERED/FAILED)
   * нь хүргэлтийн явцыг өөрөө бүрэн илэрхийлдэг тусдаа дамжлага. Харин
   * orderStatus нь агуулахын бэлтгэлийн төлөв: жолооч хуваарилагдсан ч бараа
   * бэлтгэгдэж дуусаагүй (PREPARING) байж болно. Хоёр асуудлыг хольж нэг
   * талбарт шахвал "хуваарилагдсан гэхдээ бэлдэж дуусаагүй" төлөв алга болно.
   * Тиймээс: хуваарилалт = deliveryStatus:ASSIGNED, харин орderStatus-ын
   * READY(SHIPPED) руу шилжихийг агуулах өөрөө статусын товчоор хийнэ.
   */
  async assignDriver(orderId: string, driverId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Захиалга олдсонгүй');
    }

    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
    });
    if (!driver || driver.role !== 'DRIVER' || !driver.isActive) {
      throw new BadRequestException(
        'Жолооч олдсонгүй эсвэл идэвхгүй байна (role=DRIVER байх ёстой)',
      );
    }

    // CONFIRMED / PREPARING(=PACKED) / READY захиалгад хуваарилна.
    // READY нь "гарахад бэлэн" — жолооч хуваарилах хамгийн байгалийн
    // мөч. Урьд нь зөвшөөрөгддөггүй байсан тул PREPARING үед хуваарилаад
    // READY болгосны дараа хүргэлт нь FAILED болвол дахин хуваарилах
    // ямар ч арга үлддэггүй байв (мухардмал: захиалга COMPLETED руу ч
    // явахгүй, шинэ жолоочид ч өгөгдөхгүй).
    const ASSIGNABLE: OrderStatus[] = [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
    ];
    if (!ASSIGNABLE.includes(order.orderStatus)) {
      throw new BadRequestException(
        `${order.orderStatus} төлөвтэй захиалгад жолооч хуваарилах боломжгүй (CONFIRMED, PREPARING эсвэл READY байх ёстой)`,
      );
    }

    const assigned = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        assignedDriverId: driverId,
        assignedAt: new Date(),
        deliveryStatus: DeliveryStatus.ASSIGNED,
      },
      include: { assignedDriver: DRIVER_SELECT },
    });
    await this.notifications.notifyDriverAssigned(driverId, assigned);
    return assigned;
  }

  /** Жолоочийн өөрийн дуусаагүй хүргэлтүүд — маршрутын дарааллаар */
  async myDeliveries(driverId: string) {
    const rows = await this.prisma.order.findMany({
      where: {
        assignedDriverId: driverId,
        deliveryStatus: {
          in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ON_THE_WAY],
        },
      },
      select: {
        routeOrder: true,
        id: true,
        orderNo: true,
        customerName: true,
        phone: true,
        extraPhone: true,
        region: true,
        district: true,
        khoroo: true,
        building: true,
        entrance: true,
        floor: true,
        door: true,
        province: true,
        soum: true,
        transport: true,
        addressDetail: true,
        note: true,
        totalAmount: true,
        deliveryStatus: true,
        assignedAt: true,
        items: { select: { productName: true, qty: true } },
      },
      // Маршрут заасан нь эхэндээ (1..n), заагаагүй нь хуваарилагдсан дарааллаар
      orderBy: [
        { routeOrder: { sort: 'asc', nulls: 'last' } },
        { assignedAt: 'asc' },
      ],
    });
    return rows.map((r) => {
      const fullAddress = formatFullAddress(r);
      return {
        ...r,
        fullAddress,
        // Гадны API биш — зүгээр л газрын зургийн хайлтын линк
        mapUrl:
          'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(fullAddress),
      };
    });
  }

  /**
   * Хүргэлтийн ops самбар: идэвхтэй хүргэлтүүд deliveryStatus бүрээр +
   * жолооч бүрийн өнөөдрийн ачаалал — нэг хүсэлтээр.
   */
  async opsBoard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const BOARD_SELECT = {
      id: true,
      orderNo: true,
      customerName: true,
      phone: true,
      region: true,
      district: true,
      khoroo: true,
      province: true,
      soum: true,
      totalAmount: true,
      orderStatus: true,
      deliveryStatus: true,
      routeOrder: true,
      assignedAt: true,
      assignedDriver: DRIVER_SELECT,
    };
    const [orders, deliveredToday, drivers, activeGroups, todayGroups] =
      await Promise.all([
      this.prisma.order.findMany({
        where: {
          deliveryStatus: {
            in: [
              DeliveryStatus.PENDING,
              DeliveryStatus.ASSIGNED,
              DeliveryStatus.ON_THE_WAY,
              DeliveryStatus.FAILED,
            ],
          },
          orderStatus: {
            notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED, OrderStatus.NEW],
          },
        },
        select: BOARD_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: {
          deliveryStatus: DeliveryStatus.DELIVERED,
          deliveredAt: { gte: today },
        },
        select: BOARD_SELECT,
        orderBy: { deliveredAt: 'desc' },
      }),
      this.prisma.user.findMany({
        where: { role: 'DRIVER', isActive: true },
        select: {
          id: true,
          fullName: true,
          driverProfile: { select: { isAvailable: true } },
        },
      }),
      this.prisma.order.groupBy({
        by: ['assignedDriverId'],
        where: {
          assignedDriverId: { not: null },
          deliveryStatus: {
            in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ON_THE_WAY],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['assignedDriverId'],
        where: {
          assignedDriverId: { not: null },
          deliveryStatus: DeliveryStatus.DELIVERED,
          deliveredAt: { gte: today },
        },
        _count: { _all: true },
      }),
    ]);

    const board: Record<string, unknown[]> = {
      PENDING: [],
      ASSIGNED: [],
      ON_THE_WAY: [],
      FAILED: [],
      DELIVERED_TODAY: [],
    };
    for (const o of orders) {
      board[o.deliveryStatus].push({
        ...o,
        shortAddress: formatShortAddress(o),
      });
    }
    for (const o of deliveredToday) {
      board.DELIVERED_TODAY.push({
        ...o,
        shortAddress: formatShortAddress(o),
      });
    }

    const activeById = new Map(
      activeGroups.map((g) => [g.assignedDriverId, g._count._all]),
    );
    const todayById = new Map(
      todayGroups.map((g) => [g.assignedDriverId, g._count._all]),
    );

    return {
      board,
      drivers: drivers.map((d) => ({
        id: d.id,
        name: d.fullName,
        isAvailable: d.driverProfile?.isAvailable ?? null,
        active: activeById.get(d.id) ?? 0,
        deliveredToday: todayById.get(d.id) ?? 0,
      })),
    };
  }

  /** Жолооч нарын жагсаалт — гүйцэтгэл, хөлс, ачаалалтай нь (drivers.view) */
  async driversList() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [users, activeGroups, todayGroups, totalGroups] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'DRIVER' },
        select: {
          id: true,
          fullName: true,
          username: true,
          isActive: true,
          createdAt: true,
          driverProfile: {
            select: {
              feePerDelivery: true,
              vehicleInfo: true,
              isAvailable: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.groupBy({
        by: ['assignedDriverId'],
        where: {
          assignedDriverId: { not: null },
          deliveryStatus: {
            in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ON_THE_WAY],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['assignedDriverId'],
        where: {
          assignedDriverId: { not: null },
          deliveryStatus: DeliveryStatus.DELIVERED,
          deliveredAt: { gte: today },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['assignedDriverId'],
        where: {
          assignedDriverId: { not: null },
          deliveryStatus: DeliveryStatus.DELIVERED,
        },
        _count: { _all: true },
      }),
    ]);

    const countBy = (groups: { assignedDriverId: string | null; _count: { _all: number } }[]) =>
      new Map(groups.map((g) => [g.assignedDriverId, g._count._all]));
    const activeBy = countBy(activeGroups);
    const todayBy = countBy(todayGroups);
    const totalBy = countBy(totalGroups);

    return users.map((u) => ({
      id: u.id,
      name: u.fullName,
      email: u.username,
      isActive: u.isActive,
      isAvailable: u.driverProfile?.isAvailable ?? null,
      feePerDelivery: u.driverProfile?.feePerDelivery ?? null,
      vehicleInfo: u.driverProfile?.vehicleInfo ?? null,
      active: activeBy.get(u.id) ?? 0,
      deliveredToday: todayBy.get(u.id) ?? 0,
      totalDelivered: totalBy.get(u.id) ?? 0,
    }));
  }

  /** Жолоочийн маршрутын дараалал тавих: orderIds[i] → routeOrder i+1 */
  async setRouteOrder(driverId: string, orderIds: string[]) {
    if (new Set(orderIds).size !== orderIds.length) {
      throw new BadRequestException('Захиалга давхардсан байна');
    }
    const active = await this.prisma.order.findMany({
      where: {
        assignedDriverId: driverId,
        deliveryStatus: {
          in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ON_THE_WAY],
        },
      },
      select: { id: true },
    });
    const activeSet = new Set(active.map((o) => o.id));
    for (const id of orderIds) {
      if (!activeSet.has(id)) {
        throw new BadRequestException(
          'Зөвхөн тухайн жолоочийн идэвхтэй хүргэлтүүд байх ёстой',
        );
      }
    }
    await this.prisma.$transaction(
      orderIds.map((id, i) =>
        this.prisma.order.update({
          where: { id },
          data: { routeOrder: i + 1 },
        }),
      ),
    );
    return { ok: true, count: orderIds.length };
  }

  /**
   * Жолооч замд гарлаа гэж тэмдэглэнэ: ASSIGNED → ON_THE_WAY.
   *
   * ON_THE_WAY төлөв нь enum-д, ops самбарын баганад, жолоочийн
   * ачааллын тоололд — нийт 12 газарт УНШИГДДАГ байсан ч түүнийг
   * БИЧДЭГ код байхгүй байсан (жолооч ASSIGNED-аас шууд DELIVERED рүү
   * үсэрдэг). Энэ endpoint тэр цоорхойг нөхнө: диспетчер жолооч гарсан
   * эсэхийг самбар дээр бодитоор харна.
   */
  async start(orderId: string, driverId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Захиалга олдсонгүй');
    }
    if (order.assignedDriverId !== driverId) {
      throw new ForbiddenException('Энэ хүргэлт танд хуваарилагдаагүй');
    }
    if (order.deliveryStatus === DeliveryStatus.ON_THE_WAY) {
      return order; // идемпотент — офлайн дараалал давхар илгээж болно
    }
    if (order.deliveryStatus !== DeliveryStatus.ASSIGNED) {
      throw new BadRequestException(
        'Зөвхөн хуваарилагдсан хүргэлтэд «замд гарлаа» гэж тэмдэглэнэ',
      );
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: { deliveryStatus: DeliveryStatus.ON_THE_WAY },
    });
  }

  /** Хүргэлт баталгаажуулах (зурагтай) эсвэл амжилтгүй гэж тэмдэглэх */
  async complete(
    orderId: string,
    driverId: string,
    dto: CompleteDeliveryDto,
    file?: Express.Multer.File,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Захиалга олдсонгүй');
    }
    if (order.assignedDriverId !== driverId) {
      throw new ForbiddenException('Энэ хүргэлт танд хуваарилагдаагүй');
    }
    if (order.deliveryStatus === DeliveryStatus.DELIVERED) {
      throw new BadRequestException('Энэ захиалга аль хэдийн хүргэгдсэн');
    }

    // R-2: байршуулсан файлын агуулга ҮНЭХЭЭР зураг мөн эсэхийг magic
    // byte-аар батална. Хуурамч бол дискнээс устгаад 400 шиднэ.
    if (file) {
      await assertRealImage(file);
    }

    const proofUrl = file ? `/api/uploads/${file.filename}` : null;

    if (dto.success) {
      // Зураг ЗААВАЛ БИШ: хүлээн авагч гэртээ байгаагүй үед жолооч
      // тайлбараар (ж: "доод талын дэлгүүрт үлдээсэн") баталгаажуулж
      // болно — тайлбар нь admin/manager-т захиалгын дэлгэрэнгүйд гарна
      // V4: DELIVERED дээр орлого ҮҮСЭХГҮЙ — орлого = төлбөр.
      // Төлөгдөөгүй хүргэгдсэн захиалга авлагад тоологдоно.
      const delivered = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          orderStatus: OrderStatus.COMPLETED,
          deliveryStatus: DeliveryStatus.DELIVERED,
          deliveredAt: new Date(),
          deliveryProofUrl: proofUrl,
          deliveryNote: dto.note?.trim() || null,
        },
      });
      if (delivered.customerId) {
        await this.notifications.notifyOrderStatus(
          delivered.customerId,
          delivered,
        );
      }
      return delivered;
    }

    if (!dto.note?.trim()) {
      throw new BadRequestException('Шалтгаан бичнэ үү');
    }
    const failed = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        deliveryStatus: DeliveryStatus.FAILED,
        deliveryNote: dto.note.trim(),
        ...(proofUrl ? { deliveryProofUrl: proofUrl } : {}),
      },
    });
    await this.notifications.notifyDeliveryFailed(failed, dto.note.trim());
    return failed;
  }

  /** Жолоочийн гүйцэтгэл + цалин */
  async myStats(driverId: string) {
    const weekAgo = new Date();
    weekAgo.setHours(0, 0, 0, 0);
    weekAgo.setDate(weekAgo.getDate() - 6);

    const mine: Prisma.OrderWhereInput = { assignedDriverId: driverId };

    const [
      totalDelivered,
      assignedThisWeek,
      deliveredThisWeek,
      recent,
      profile,
      unpaidCount,
      payoutAgg,
    ] = await Promise.all([
      this.prisma.order.count({
        where: { ...mine, deliveryStatus: DeliveryStatus.DELIVERED },
      }),
      this.prisma.order.count({
        where: { ...mine, assignedAt: { gte: weekAgo } },
      }),
      this.prisma.order.count({
        where: {
          ...mine,
          deliveryStatus: DeliveryStatus.DELIVERED,
          deliveredAt: { gte: weekAgo },
        },
      }),
      this.prisma.order.findMany({
        where: {
          ...mine,
          deliveryStatus: DeliveryStatus.DELIVERED,
          deliveredAt: { gte: weekAgo },
        },
        select: { deliveredAt: true },
      }),
      this.prisma.driverProfile.findUnique({ where: { userId: driverId } }),
      // Тооцоонд ороогүй хүргэлтүүд (payroll V3)
      this.prisma.order.count({
        where: {
          ...mine,
          deliveryStatus: DeliveryStatus.DELIVERED,
          payoutId: null,
          // V4: цалингаас хасах буцаалттай захиалга тооцогдохгүй
          returns: { none: { excludeFromPayroll: true } },
        },
      }),
      this.prisma.driverPayout.groupBy({
        by: ['status'],
        where: { driverId },
        _sum: { totalAmount: true },
      }),
    ]);

    const dayKey = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);

    const byDay = new Map<string, { date: string; delivered: number }>();
    for (let i = 0; i < 7; i++) {
      const key = dayKey(new Date(weekAgo.getTime() + i * DAY_MS));
      byDay.set(key, { date: key, delivered: 0 });
    }
    for (const r of recent) {
      if (!r.deliveredAt) continue;
      const row = byDay.get(dayKey(r.deliveredAt));
      if (row) row.delivered += 1;
    }

    // Цалингийн задаргаа (Decimal — float биш):
    // unpaid = тооцоонд ороогүй хүргэлт × одоогийн хөлс,
    // pendingPayout/paidTotal = хаагдсан тооцоонуудын нийлбэр
    const fee = profile?.feePerDelivery ?? new Prisma.Decimal(0);
    const zero = new Prisma.Decimal(0);
    const sumFor = (status: 'PENDING' | 'PAID') =>
      payoutAgg.find((g) => g.status === status)?._sum.totalAmount ?? zero;

    return {
      totalDelivered,
      assignedThisWeek,
      deliveredThisWeek,
      last7Days: [...byDay.values()],
      feePerDelivery: profile?.feePerDelivery ?? null,
      unpaidCount,
      earnings: {
        unpaid: fee.mul(unpaidCount),
        pendingPayout: sumFor('PENDING'),
        paidTotal: sumFor('PAID'),
      },
    };
  }
}

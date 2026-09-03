import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  DeliveryStatus,
  FinanceType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PERM } from '../permissions/permission-keys';
import { PermissionsService } from '../permissions/permissions.service';
import { lockOrderForUpdate } from '../prisma/lock.util';
import { PrismaService } from '../prisma/prisma.service';
import { formatFullAddress, formatShortAddress } from './address.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { applyBatchDelta } from '../stock/batch.util';

/**
 * Зөвшөөрөгдсөн статус шилжилтүүд.
 * NEW → CONFIRMED → PREPARING (бэлтгэж буй) → READY (гарахад бэлэн) → COMPLETED.
 * COMPLETED болон CANCELLED — эцсийн, цааш шилжихгүй.
 */
/**
 * Захиалгын төлөвийн шилжилтүүд.
 *
 * PREPARING/READY нь НЯРАВЫН бэлтгэлийн үе шат. Нярав ажилладаггүй
 * жижиг ачаалалд борлуулагч жолооч хуваарилаад шууд дуусгах хэрэгтэй
 * болдог тул CONFIRMED/PREPARING-ээс COMPLETED руу шууд явж болно —
 * бэлтгэлийн хоёр товчийг заавал дарах шаардлагагүй.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [
    OrderStatus.PREPARING,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ],
  PREPARING: [
    OrderStatus.READY,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ],
  READY: [OrderStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'
  );
}

/** createdBy-г буцаахдаа passwordHash задруулахгүй */
const CREATED_BY_SELECT = {
  select: { id: true, username: true, fullName: true, role: true },
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Захиалга үүсгэх — бүх өөрчлөлт нэг transaction дотор.
   *
   * orderNo-гийн арга: тухайн өдрийн хамгийн их дугаарыг tx дотор уншиж +1.
   * Дотоод цөөн хэрэглэгчтэй систем тул мөргөлдөөн ховор; давхардвал
   * orderNo-гийн unique constraint P2002 өгч бүх transaction буцна —
   * түүнийг 3 хүртэл удаа retry хийнэ. Тусдаа counter хүснэгт шаардахгүй,
   * зөв байдлыг нь DB-ийн constraint өөрөө баталгаажуулдаг тул энэ аргыг сонгосон.
   */
  async create(dto: CreateOrderDto, user: AuthUser) {
    const allowed = await this.permissions.has(
      user.id,
      user.role,
      PERM.ORDERS_CREATE,
    );
    if (!allowed) {
      throw new ForbiddenException('Хандах эрх байхгүй');
    }

    const phone = dto.customerPhone ?? null;
    const customerName = dto.customerName ?? null;
    if (!phone) {
      throw new BadRequestException('Утасны дугаар заавал');
    }

    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Нэг бараа давхардаж орсон байна');
    }


    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        const { order, lowStockCrossed } = await this.createInTransaction(
          dto,
          user.id,
          ids,
          phone,
          customerName,
          dto.paid === true,
        );
        // Transaction амжилттай болсны ДАРАА мэдэгдэнэ (rollback-д илгээхгүй)
        for (const p of lowStockCrossed) {
          await this.notifications.notifyLowStock(p);
        }
        return order;
      } catch (e) {
        if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS) {
          continue; // orderNo мөргөлдсөн — дахин оролдоно
        }
        throw e;
      }
    }
  }

  private async createInTransaction(
    dto: CreateOrderDto,
    userId: string,
    ids: string[],
    phone: string,
    customerName: string | null,
    markPaid: boolean,
  ) {
    const lowStockCrossed: {
      id: string;
      name: string;
      stockQty: number;
      lowStockLimit: number;
    }[] = [];
    const order = await this.prisma.$transaction(async (tx) => {
      // 1. Бүх барааг нэг мөсөн авч шалгана
      const products = await tx.product.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      for (const item of dto.items) {
        const product = byId.get(item.productId);
        if (!product) {
          throw new BadRequestException(
            `Бараа олдсонгүй (id: ${item.productId})`,
          );
        }
        if (!product.isActive) {
          throw new BadRequestException(`«${product.name}» идэвхгүй байна`);
        }
        if (item.qty > product.stockQty) {
          throw new BadRequestException(
            `«${product.name}» үлдэгдэл хүрэлцэхгүй (байгаа: ${product.stockQty}, хүссэн: ${item.qty})`,
          );
        }
      }

      // 2. orderNo: ORD-YYYYMMDD-NNNN
      const now = new Date();
      const ymd = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('');
      const prefix = `ORD-${ymd}-`;
      // Дугаарыг ТООГООР олно. `orderBy: { orderNo: 'desc' }` нь мөрийн
      // (string) эрэмбэ тул өдөрт 9999-ээс дээш захиалга орвол '9999' нь
      // '10000'-ээс их гэж тооцогдож дугаар давхардаж эхэлдэг байсан.
      // Нэг өдрийн мөрүүд цөөн (нэг богино багана) тул ачаалал өчүүхэн.
      const todays = await tx.order.findMany({
        where: { orderNo: { startsWith: prefix } },
        select: { orderNo: true },
      });
      const maxNum = todays.reduce((max, o) => {
        const n = parseInt(o.orderNo.slice(prefix.length), 10);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      const nextNum = maxNum + 1;
      const orderNo = prefix + String(nextNum).padStart(4, '0');

      // 3–4. Snapshot + нийт дүн (Decimal — float хэрэглэхгүй)
      let totalAmount = new Prisma.Decimal(0);
      const itemsData = dto.items.map((item) => {
        const product = byId.get(item.productId)!;
        const lineTotal = product.price.mul(item.qty);
        totalAmount = totalAmount.add(lineTotal);
        return {
          productId: product.id,
          productName: product.name, // snapshot
          qty: item.qty,
          priceAtOrder: product.price, // snapshot
          costAtOrder: product.costPrice, // өртгийн snapshot (v4)
          lineTotal,
        };
      });

      // 5. Order + OrderItem-үүд.
      // Хаяг: зөвхөн өөрийн горимын талбаруудыг хадгалж, эсрэг горимынхыг null
      const isUB = dto.region === 'ULAANBAATAR';
      const order = await tx.order.create({
        data: {
          orderNo,
          customerName,
          phone,
          extraPhone: dto.extraPhone ?? null,
          region: dto.region,
          district: isUB ? dto.district : null,
          khoroo: isUB ? dto.khoroo : null,
          building: isUB ? dto.building : null,
          entrance: isUB ? dto.entrance : null,
          floor: isUB ? dto.floor : null,
          door: isUB ? dto.door : null,
          province: isUB ? null : dto.province,
          soum: isUB ? null : dto.soum,
          transport: isUB ? null : dto.transport,
          addressDetail: isUB ? null : (dto.addressDetail ?? null),
          note: dto.note,
          channel: dto.channel ?? 'OTHER',
          totalAmount,
          createdById: userId,
          items: { create: itemsData },
        },
        include: { items: true, createdBy: CREATED_BY_SELECT },
      });

      // 6–7. Үлдэгдэл хасах + StockMovement (тус бүр update)
      for (const item of dto.items) {
        const updated = await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { decrement: item.qty } },
        });
        // 1-р шалгалтын дараа өөр transaction үлдэгдэл авчихсан байж
        // болзошгүй — атом decrement сөрөг гарвал бүгдийг буцаана
        if (updated.stockQty < 0) {
          throw new BadRequestException(
            `«${updated.name}» үлдэгдэл хүрэлцэхгүй`,
          );
        }
        // Лимитэд ХҮРЭХ/ДООШ ОРОХ МӨЧ: өмнө нь > лимит, одоо ≤ лимит.
        // Босго нь Products хуудасны lowStock шүүлттэй (`<=`) ижил.
        if (
          updated.stockQty <= updated.lowStockLimit &&
          updated.stockQty + item.qty > updated.lowStockLimit
        ) {
          lowStockCrossed.push(updated);
        }
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            qtyChange: -item.qty,
            reason: 'ORDER',
            refId: order.id,
            userId,
          },
        });
        await applyBatchDelta(tx, item.productId, -item.qty);
      }

      // 8. "Төлсөн" гэж бүртгэсэн бол бүтэн төлбөрийг ЭНД шууд бүртгэнэ —
      // ОРЛОГО = ТӨЛБӨР зарчмаар Payment + INCOME entry нэг transaction-д.
      // (customer-ийн илгээсэн paid флагийг create() дээр хаясан байдаг.)
      if (markPaid && totalAmount.gt(0)) {
        // Бэлэн мөнгө системд байхгүй (V5) — бүх төлбөр шилжүүлэг
        const method = PaymentMethod.TRANSFER;
        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            amount: totalAmount,
            method,
            note: 'Захиалга үүсгэхэд төлсөн',
            receivedById: userId,
          },
        });
        await tx.financeEntry.create({
          data: {
            type: FinanceType.INCOME,
            category: 'PAYMENT',
            amount: totalAmount,
            note: `Төлбөр ${orderNo} (Шилжүүлэг)`,
            refOrderId: order.id,
            refPaymentId: payment.id,
            createdById: userId,
          },
        });
        const paidOrder = await tx.order.update({
          where: { id: order.id },
          data: { paidAmount: totalAmount, paymentStatus: PaymentStatus.PAID },
          include: { items: true, createdBy: CREATED_BY_SELECT },
        });
        return paidOrder;
      }

      return order;
    });
    return { order, lowStockCrossed };
  }

  /** Засвар зөвшөөрөгдөх төлөвүүд — дууссан/цуцалсан захиалга хөшинө */
  private static readonly EDITABLE: OrderStatus[] = [
    OrderStatus.NEW,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
  ];

  /**
   * Захиалга засах (V5) — хаяг, хүлээн авагч, бараа.
   *
   * DM-ээр ажилладаг тул «хаягаа буруу хэлсэн», «нэгийг нэмээд өгөөч»
   * гэдэг өдөр тутмын явдал. Өмнө нь баталгаажсаны дараа засах арга
   * байхгүй тул цуцлаад дахин шивдэг байв — дугаар үсэрч, түүх тасардаг.
   *
   * Бараа солиход ҮЛДЭГДЭЛ ЗӨРҮҮГЭЭР нь тохируулагдана (нэмсэн нь
   * хасагдаж, хассан нь буцаж орно). Үнэ нь ХУУЧИН мөрүүд дээр
   * snapshot-оороо үлдэнэ — засвар нь өнөөдрийн үнээр дахин үнэлэхгүй.
   */
  async update(id: string, dto: UpdateOrderDto, user: AuthUser) {
    if (dto.items) {
      const ids = dto.items.map((i) => i.productId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException('Нэг бараа давхардаж орсон байна');
      }
    }

    const lowStockCrossed: {
      id: string;
      name: string;
      stockQty: number;
      lowStockLimit: number;
    }[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      // Төлбөр/буцаалттай зэрэг орохоос хамгаална (paidAmount уншиж бичнэ)
      const exists = await lockOrderForUpdate(tx, id);
      if (!exists) {
        throw new NotFoundException('Захиалга олдсонгүй');
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id },
        include: { items: true, returns: { select: { id: true } } },
      });

      if (!OrdersService.EDITABLE.includes(order.orderStatus)) {
        throw new BadRequestException(
          `${order.orderStatus} төлөвтэй захиалгыг засах боломжгүй`,
        );
      }

      let totalAmount = order.totalAmount;

      if (dto.items) {
        if (order.returns.length > 0) {
          throw new BadRequestException(
            'Буцаалт бүртгэгдсэн захиалгын барааг засах боломжгүй',
          );
        }

        const wanted = new Map(dto.items.map((i) => [i.productId, i.qty]));
        const current = new Map(order.items.map((i) => [i.productId, i]));
        const touched = [...new Set([...wanted.keys(), ...current.keys()])];

        const products = await tx.product.findMany({
          where: { id: { in: touched } },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        // 1. Зөрүүг бүрэн шалгана — нэг нь ч бүтэхгүй бол юу ч хөдлөхгүй
        for (const productId of touched) {
          const want = wanted.get(productId) ?? 0;
          const have = current.get(productId)?.qty ?? 0;
          const delta = want - have; // + нэмсэн, − хассан
          if (delta === 0) continue;
          const product = byId.get(productId);
          if (!product) {
            throw new BadRequestException(`Бараа олдсонгүй (id: ${productId})`);
          }
          if (delta > 0 && !product.isActive) {
            throw new BadRequestException(`«${product.name}» идэвхгүй байна`);
          }
          if (delta > product.stockQty) {
            throw new BadRequestException(
              `«${product.name}» үлдэгдэл хүрэлцэхгүй (байгаа: ${product.stockQty}, нэмэх: ${delta})`,
            );
          }
        }

        // 2. Мөрүүдийг тааруулж, үлдэгдлийг зөрүүгээр нь хөдөлгөнө
        totalAmount = new Prisma.Decimal(0);
        for (const productId of touched) {
          const want = wanted.get(productId) ?? 0;
          const line = current.get(productId);
          const product = byId.get(productId)!;
          // Хуучин мөрийн үнэ snapshot-оороо үлдэнэ; шинэ мөр өнөөдрийнхөөр
          const price = line?.priceAtOrder ?? product.price;
          const delta = want - (line?.qty ?? 0);

          if (want === 0) {
            await tx.orderItem.delete({ where: { id: line!.id } });
          } else if (line) {
            await tx.orderItem.update({
              where: { id: line.id },
              data: { qty: want, lineTotal: price.mul(want) },
            });
          } else {
            await tx.orderItem.create({
              data: {
                orderId: id,
                productId,
                productName: product.name,
                qty: want,
                priceAtOrder: price,
                costAtOrder: product.costPrice,
                lineTotal: price.mul(want),
              },
            });
          }
          if (want > 0) totalAmount = totalAmount.add(price.mul(want));

          if (delta !== 0) {
            const updated = await tx.product.update({
              where: { id: productId },
              data: { stockQty: { decrement: delta } },
            });
            if (updated.stockQty < 0) {
              throw new BadRequestException(
                `«${updated.name}» үлдэгдэл хүрэлцэхгүй`,
              );
            }
            if (
              delta > 0 &&
              updated.stockQty <= updated.lowStockLimit &&
              updated.stockQty + delta > updated.lowStockLimit
            ) {
              lowStockCrossed.push(updated);
            }
            await tx.stockMovement.create({
              data: {
                productId,
                qtyChange: -delta,
                reason: 'ORDER_EDIT',
                note: `Захиалга ${order.orderNo} засварлав`,
                refId: id,
                userId: user.id,
              },
            });
            await applyBatchDelta(tx, productId, -delta);
          }
        }

        /**
         * ТӨЛСНӨӨС ДООШ БУУЛГАХЫГ ХОРИГЛОНО (V5).
         *
         * Үгүй бол: 100,000₮ төлсөн захиалгыг 50,000₮ болтол засахад
         * төлөв ТӨЛСӨН хэвээр үлдэж, илүү 50,000₮ нь хаана ч
         * харагдахгүй «алга болдог» байв — буцаалтын бичилт ч үүсэхгүй,
         * анхааруулга ч гарахгүй. Цуцлалтад ижил хамгаалалт байсан
         * (төлбөртэйг цуцлахыг хориглодог) — засварт дутуу байсныг нөхөв.
         */
        if (order.paidAmount.gt(totalAmount)) {
          throw new BadRequestException(
            `Төлсөн дүн (${order.paidAmount.toFixed(0)}₮) шинэ нийт дүнгээс ` +
              `(${totalAmount.toFixed(0)}₮) их болж байна. Эхлээд илүү ` +
              'төлбөрийн бүртгэлийг устгаж мөнгийг буцаана уу ' +
              '(захиалгын дэлгэрэнгүй → төлбөрийн мөр → ×)',
          );
        }
      }

      // 3. Хаяг — region илгээвэл эсрэг горимынхыг цэвэрлэнэ
      const address: Prisma.OrderUpdateInput = {};
      if (dto.region) {
        const isUB = dto.region === 'ULAANBAATAR';
        Object.assign(address, {
          region: dto.region,
          district: isUB ? dto.district : null,
          khoroo: isUB ? dto.khoroo : null,
          building: isUB ? dto.building : null,
          entrance: isUB ? (dto.entrance ?? null) : null,
          floor: isUB ? (dto.floor ?? null) : null,
          door: isUB ? (dto.door ?? null) : null,
          province: isUB ? null : dto.province,
          soum: isUB ? null : dto.soum,
          transport: isUB ? null : (dto.transport ?? null),
          addressDetail: isUB ? null : (dto.addressDetail ?? null),
        });
      }

      return tx.order.update({
        where: { id },
        data: {
          ...address,
          ...(dto.customerName !== undefined
            ? { customerName: dto.customerName }
            : {}),
          ...(dto.customerPhone !== undefined
            ? { phone: dto.customerPhone }
            : {}),
          ...(dto.extraPhone !== undefined
            ? { extraPhone: dto.extraPhone || null }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note || null } : {}),
          ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
          ...(dto.items
            ? {
                totalAmount,
                // Дүн өөрчлөгдвөл төлбөрийн төлөв дагаж шинэчлэгдэнэ:
                // 20,000-ийн PAID захиалга 30,000 болбол PARTIAL болно
                paymentStatus: order.paidAmount.gte(totalAmount)
                  ? PaymentStatus.PAID
                  : order.paidAmount.gt(0)
                    ? PaymentStatus.PARTIAL
                    : PaymentStatus.UNPAID,
              }
            : {}),
        },
        include: {
          items: true,
          createdBy: CREATED_BY_SELECT,
          assignedDriver: CREATED_BY_SELECT,
          warehouse: { select: { id: true, fullName: true } },
        },
      });
    });

    for (const p of lowStockCrossed) {
      await this.notifications.notifyLowStock(p);
    }
    return { ...result, fullAddress: formatFullAddress(result) };
  }

  async updateStatus(id: string, status: OrderStatus, user: AuthUser) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Захиалга олдсонгүй');
    }

    // OPERATOR зөвхөн өөрийн шивсэн захиалгыг удирдана; ADMIN/MANAGER бүгдийг
    if (user.role === 'OPERATOR' && order.createdById !== user.id) {
      throw new ForbiddenException(
        'Зөвхөн өөрийн үүсгэсэн захиалгын статусыг өөрчлөх боломжтой',
      );
    }

    // Цуцлах нь тусдаа эрх (V5) — бэлтгэл хийдэг нярав арилжааны
    // шийдвэр гаргахгүй. Төлөвийн шилжилтийн шалгалтаас ӨМНӨ.
    if (status === OrderStatus.CANCELLED) {
      const canCancel = await this.permissions.has(
        user.id,
        user.role,
        PERM.ORDERS_CANCEL,
      );
      if (!canCancel) {
        throw new ForbiddenException('Захиалга цуцлах эрх байхгүй');
      }
    }

    /**
     * Төлбөртэй захиалгыг шууд цуцлахыг хориглоно (V5).
     *
     * Цуцлалт нь үлдэгдлийг буцаадаг ч МӨНГИЙГ хөнддөггүй байсан тул
     * бараа агуулахад ирчихээд, төлбөр нь ОРЛОГО болж номд үлддэг байв
     * (paidAmount, PAID төлөв, INCOME бичилт бүгд хэвээр). Улмаас
     * борлуулалт цуцлагдсаныг хасдаг атал орлого нь хасдаггүй байсан.
     *
     * PaymentsService нь цуцлагдсан захиалгад төлбөр НЭМЭХИЙГ аль
     * хэдийн хориглодог — энэ нь тэрхүү дүрмийн нөгөө тал.
     */
    if (status === OrderStatus.CANCELLED && order.paidAmount.gt(0)) {
      throw new BadRequestException(
        'Төлбөртэй захиалгыг цуцлах боломжгүй. Эхлээд төлбөрийн бүртгэлийг ' +
          'устгаж мөнгийг буцаана уу (захиалгын дэлгэрэнгүй → төлбөрийн мөр → ×)',
      );
    }

    if (!ALLOWED_TRANSITIONS[order.orderStatus].includes(status)) {
      throw new BadRequestException(
        `${order.orderStatus}-ээс ${status} руу шууд шилжих боломжгүй`,
      );
    }

    // Цуцлалт: статус + үлдэгдэл буцаах + movement — нэг transaction
    if (status === OrderStatus.CANCELLED) {
      const cancelled = await this.prisma.$transaction(async (tx) => {
        const cancelled = await tx.order.update({
          where: { id },
          data: {
            orderStatus: OrderStatus.CANCELLED,
            // Жолооч хуваарилагдсан байсан бол хуваарилалтыг цуцална.
            // deliveryStatus-ыг МӨН буцаана: өмнө нь ASSIGNED хэвээр үлдэж,
            // жолоочийн жагсаалт/ачааллын тоолуур/маршрутын дараалалд
            // цуцлагдсан захиалга мөнхөд тоологддог байсан.
            assignedDriverId: null,
            assignedAt: null,
            deliveryStatus: DeliveryStatus.PENDING,
            routeOrder: null,
          },
          include: { items: true, createdBy: CREATED_BY_SELECT },
        });

        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: { increment: item.qty } },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              qtyChange: item.qty,
              reason: 'ORDER_CANCEL',
              refId: order.id,
              userId: user.id,
            },
          });
          await applyBatchDelta(tx, item.productId, item.qty);
        }

        return cancelled;
      });
      return cancelled;
    }

    // V4: COMPLETED дээр орлого ҮҮСЭХГҮЙ — орлого = төлбөр
    // (PaymentsService.addPayment). Тиймээс энгийн шилжилтээр явна.

    // Бусад шилжилт — зөвхөн статус update
    const updated = await this.prisma.order.update({
      where: { id },
      data: { orderStatus: status },
      include: { items: true, createdBy: CREATED_BY_SELECT },
    });
    return updated;
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        createdBy: CREATED_BY_SELECT,
        assignedDriver: CREATED_BY_SELECT,
        payments: {
          include: {
            receivedBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        returns: {
          include: {
            items: true,
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('Захиалга олдсонгүй');
    }
    // Бүтэцлэгдсэн талбаруудын хамт нэг мөр хаягийг өгнө
    return { ...order, fullAddress: formatFullAddress(order) };
  }

  async findAll(query: QueryOrdersDto) {
    const {
      status,
      deliveryStatus,
      paymentStatus,
      channel,
      district,
      driverId,
      search,
      page = 1,
      limit = 20,
    } = query;

    const where: Prisma.OrderWhereInput = {
      ...(status ? { orderStatus: status } : {}),
      ...(deliveryStatus ? { deliveryStatus } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(channel ? { channel } : {}),
      ...(district ? { district } : {}),
      ...(driverId ? { assignedDriverId: driverId } : {}),
      ...(search
        ? {
            OR: [
              { orderNo: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          _count: { select: { items: true } },
          createdBy: CREATED_BY_SELECT,
          assignedDriver: CREATED_BY_SELECT,
          warehouse: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((o) => ({ ...o, shortAddress: formatShortAddress(o) })),
      total,
      page,
      limit,
    };
  }
}

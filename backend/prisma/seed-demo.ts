/**
 * НЭЭЛТТЭЙ ДЕМОНЫ SEED — «Демо дэлгүүр».
 *
 *   DEMO_MODE=1 npx tsx prisma/seed-demo.ts
 *
 * ⚠ DB-ийн БҮХ хүснэгтийг (_prisma_migrations-аас бусад) ЦЭВЭРЛЭЭД
 * дахин дүүргэнэ. Тиймээс DEMO_MODE=1 үед л ажиллана — бодит
 * өгөгдөлтэй DB дээр санамсаргүй ажиллахаас хамгаална.
 *
 * Үүсгэх зүйлс: компанийн тохиргоо, 4 ангилал, 20 бараа, 3 хүргэгч,
 * 1 борлуулагч, сүүлийн 14 хоногт тархсан 40 захиалга (янз бүрийн
 * статус) + төлбөр/орлого, зарлага, нөөцийн хөдөлгөөн.
 *
 * Демо хэрэглэгч: demo@ochir.mn / Demo1234 (ADMIN — бүх хуудсыг
 * харна) нь DEMO_READONLY_USERS-ээр ЗӨВХӨН УНШИХ эрхтэй.
 * Бусад хэрэглэгчдийн нууц үг санамсаргүй — хэн ч нэвтэрч чадахгүй.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';

if (process.env.DEMO_MODE !== '1') {
  console.error('seed-demo: DEMO_MODE=1 биш тул зогсов (DB-г бүхэлд нь цэвэрлэдэг скрипт).');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

export const DEMO_USER = { username: 'demo@ochir.mn', password: 'Demo1234' };

/** Тогтмол seed-тэй PRNG — дахин ажиллуулахад ижил өгөгдөл */
let seed = 20261108;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const D = (n: number | string) => new Prisma.Decimal(n);

async function reset() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

const randomHash = () => bcrypt.hash(randomBytes(24).toString('hex'), 10);

const CATEGORIES = ['Хувцас', 'Гоо сайхан', 'Гэр ахуй', 'Хүүхдийн бараа'] as const;

// [нэр, ангилал, үнэ, өртөг, эцсийн үлдэгдэл, бага үлдэгдлийн хязгаар]
const PRODUCTS: [string, (typeof CATEGORIES)[number], number, number, number, number][] = [
  ['Ноолууран ороолт', 'Хувцас', 89000, 52000, 14, 5],
  ['Эрэгтэй хүрэм, хар', 'Хувцас', 159000, 98000, 6, 3],
  ['Эмэгтэй пальто, бор', 'Хувцас', 219000, 140000, 4, 3],
  ['Хөвөн цамц, цагаан', 'Хувцас', 39000, 18000, 32, 10],
  ['Ноосон малгай', 'Хувцас', 29000, 13000, 2, 5],
  ['Жинсэн өмд, slim', 'Хувцас', 69000, 38000, 18, 5],
  ['Чийгшүүлэх тос 50мл', 'Гоо сайхан', 45000, 24000, 22, 8],
  ['Нүүрний маск, 10ш', 'Гоо сайхан', 25000, 11000, 40, 10],
  ['Уруулын будаг, улаан', 'Гоо сайхан', 32000, 15000, 7, 8],
  ['Үсний шампунь 400мл', 'Гоо сайхан', 28000, 14000, 26, 10],
  ['Нарнаас хамгаалах тос SPF50', 'Гоо сайхан', 49000, 27000, 0, 5],
  ['Үнэртэй ус 30мл', 'Гоо сайхан', 79000, 45000, 9, 4],
  ['Аромат лаа', 'Гэр ахуй', 22000, 9000, 35, 10],
  ['Керамик аяга, 2ш', 'Гэр ахуй', 34000, 16000, 12, 6],
  ['Хөнжлийн бүрээс, давхар', 'Гэр ахуй', 95000, 55000, 8, 4],
  ['Гал тогооны алчуур, 3ш', 'Гэр ахуй', 18000, 7000, 3, 8],
  ['Хүүхдийн ноосон оймс', 'Хүүхдийн бараа', 15000, 6000, 45, 10],
  ['Хүүхдийн дулаан комбинезон', 'Хүүхдийн бараа', 129000, 78000, 5, 3],
  ['Модон тоглоом, барилга', 'Хүүхдийн бараа', 42000, 21000, 11, 5],
  ['Хүүхдийн усны сав 350мл', 'Хүүхдийн бараа', 19000, 8000, 27, 8],
];

const DRIVERS = [
  { username: 'driver1@demo.ochir.mn', fullName: 'Бат-Эрдэнэ Ганбаатар', phone: '88112233', vehicle: 'Мотоцикл · Honda', zones: ['БЗД', 'СБД', 'ЧД'] },
  { username: 'driver2@demo.ochir.mn', fullName: 'Төмөрбаатар Энхтайван', phone: '99223344', vehicle: 'Prius 30', zones: ['ХУД', 'БГД'] },
  { username: 'driver3@demo.ochir.mn', fullName: 'Ганзориг Мөнхжаргал', phone: '95334455', vehicle: 'Мотоцикл · Yamaha', zones: ['СХД', 'БГД', 'ЧД'] },
];

const NAMES = ['Сараа', 'Номин', 'Анужин', 'Тэмүүлэн', 'Мөнх-Эрдэнэ', 'Солонго', 'Хулан', 'Энхжин', 'Билгүүн', 'Оюунаа', 'Ганболд', 'Нандин', 'Удвал', 'Цэцэгмаа', 'Батзориг', 'Марал', 'Халиун', 'Отгонбаяр'];
const DISTRICTS = ['БЗД', 'БЗД', 'СБД', 'ХУД', 'ХУД', 'БГД', 'СХД', 'ЧД'];
const BUILDINGS = ['13-р хороолол', 'Нарны хороолол', 'Зайсан', '120 мянгат', 'Хүннү 2222', 'Сансар', 'River Garden', 'Энхтайвны өргөн чөлөө', 'Ирээдүй хотхон'];
const CHANNELS = ['INSTAGRAM', 'INSTAGRAM', 'INSTAGRAM', 'FACEBOOK', 'FACEBOOK', 'PHONE'] as const;
const FAIL_NOTES = ['Утсаа аваагүй, гэртээ байгаагүй', 'Хаяг буруу, харилцагч маргааш авна гэсэн'];

type Kind = 'NEW' | 'CONFIRMED' | 'ASSIGNED' | 'ON_THE_WAY' | 'DELIVERED' | 'FAILED' | 'CANCELLED';

/** Захиалгын нас (хоног)-аас хамаарч бодит статус */
function kindFor(daysAgo: number, i: number): Kind {
  if (daysAgo === 0) return pick(['NEW', 'NEW', 'CONFIRMED', 'ASSIGNED', 'ON_THE_WAY'] as const);
  if (daysAgo === 1) return pick(['ASSIGNED', 'ON_THE_WAY', 'DELIVERED', 'DELIVERED', 'FAILED'] as const);
  if (i % 13 === 5) return 'CANCELLED';
  if (i % 17 === 3) return 'FAILED';
  return 'DELIVERED';
}

const ymd = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('');
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

async function main() {
  await reset();

  // ── Хэрэглэгчид ──
  const demo = await prisma.user.create({
    data: {
      username: DEMO_USER.username,
      passwordHash: await bcrypt.hash(DEMO_USER.password, 10),
      fullName: 'Демо Хэрэглэгч',
      role: 'ADMIN',
    },
  });
  const seller = await prisma.user.create({
    data: { username: 'seller@demo.ochir.mn', passwordHash: await randomHash(), fullName: 'Номин Борлуулагч', role: 'SELLER' },
  });
  const drivers: Awaited<ReturnType<typeof prisma.user.create>>[] = [];
  for (const d of DRIVERS) {
    const u = await prisma.user.create({
      data: {
        username: d.username,
        passwordHash: await randomHash(),
        fullName: d.fullName,
        phone: d.phone,
        role: 'DRIVER',
        driverProfile: { create: { feePerDelivery: D(5000), vehicleInfo: d.vehicle, zones: d.zones } },
      },
    });
    drivers.push(u);
  }

  // ── Тохиргоо ──
  await prisma.setting.createMany({
    data: [
      { key: 'companyName', value: 'Демо дэлгүүр' },
      { key: 'companyPhone', value: '7700-0000' },
    ],
  });

  // ── Бараа ──
  const cats = new Map<string, string>();
  for (const name of CATEGORIES) cats.set(name, (await prisma.category.create({ data: { name } })).id);

  const products: Awaited<ReturnType<typeof prisma.product.create>>[] = [];
  for (const [i, [name, cat, price, cost, , low]] of PRODUCTS.entries()) {
    products.push(
      await prisma.product.create({
        data: {
          sku: `DM-${String(i + 1).padStart(3, '0')}`,
          name,
          price: D(price),
          costPrice: D(cost),
          stockQty: 0, // доор тооцоолж тавина
          lowStockLimit: low,
          categoryId: cats.get(cat) ?? null,
        },
      }),
    );
  }

  // ── Захиалгууд (сүүлийн 14 хоног) ──
  const now = new Date();
  const sold = new Map<string, number>();
  const moves: Prisma.StockMovementCreateManyInput[] = [];
  const perDay = new Map<string, number>();

  // 40 захиалгын огноо: өдөрт 1–5, ойрын өдрүүдэд арай олон
  const stamps: Date[] = [];
  for (let k = 0; k < 40; k++) {
    const daysAgo = k < 6 ? 0 : k < 11 ? 1 : int(2, 13);
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(int(9, 20), int(0, 59), int(0, 59), 0);
    if (d > now) d.setTime(now.getTime() - int(10, 300) * 60_000);
    stamps.push(d);
  }
  stamps.sort((a, b) => a.getTime() - b.getTime());

  for (const [i, createdAt] of stamps.entries()) {
    const daysAgo = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(createdAt).setHours(0, 0, 0, 0)) / 86_400_000);
    const kind = kindFor(daysAgo, i);
    const day = ymd(createdAt);
    const n = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, n);
    const orderNo = `ORD-${day}-${String(n).padStart(4, '0')}`;

    // 1–3 мөр, давхардалгүй бараа
    const lines = new Map<number, number>();
    const count = pick([1, 1, 2, 2, 3]);
    while (lines.size < count) lines.set(int(0, products.length - 1), pick([1, 1, 1, 2]));
    let total = D(0);
    const items = [...lines.entries()].map(([pi, qty]) => {
      const p = products[pi]!;
      const lineTotal = p.price.mul(qty);
      total = total.add(lineTotal);
      return { productId: p.id, productName: p.name, qty, priceAtOrder: p.price, costAtOrder: p.costPrice, lineTotal };
    });

    const driver = pick(drivers);
    const hasDriver = ['ASSIGNED', 'ON_THE_WAY', 'DELIVERED', 'FAILED'].includes(kind);
    const paid = kind === 'DELIVERED' || kind === 'ON_THE_WAY' || kind === 'ASSIGNED' || (kind !== 'CANCELLED' && rnd() < 0.5);
    const orderStatus = { NEW: 'NEW', CONFIRMED: 'CONFIRMED', ASSIGNED: 'PREPARING', ON_THE_WAY: 'READY', DELIVERED: 'COMPLETED', FAILED: 'READY', CANCELLED: 'CANCELLED' }[kind];
    const deliveryStatus = { NEW: 'PENDING', CONFIRMED: 'PENDING', ASSIGNED: 'ASSIGNED', ON_THE_WAY: 'ON_THE_WAY', DELIVERED: 'DELIVERED', FAILED: 'FAILED', CANCELLED: 'PENDING' }[kind];
    const district = pick(DISTRICTS);

    const order = await prisma.order.create({
      data: {
        orderNo,
        customerName: pick(NAMES),
        phone: `${pick(['88', '99', '95', '80', '89'])}${int(100000, 999999)}`,
        region: 'ULAANBAATAR',
        district,
        khoroo: String(int(1, 25)),
        building: pick(BUILDINGS),
        entrance: String(int(1, 4)),
        floor: String(int(1, 16)),
        door: String(int(1, 120)),
        channel: pick(CHANNELS),
        totalAmount: total,
        orderStatus: orderStatus as never,
        deliveryStatus: deliveryStatus as never,
        paymentStatus: paid ? 'PAID' : 'UNPAID',
        paidAmount: paid ? total : D(0),
        createdById: pick([seller.id, seller.id, demo.id]),
        createdAt,
        assignedDriverId: hasDriver ? driver.id : null,
        assignedAt: hasDriver ? addMin(createdAt, int(20, 90)) : null,
        deliveredAt: kind === 'DELIVERED' ? addMin(createdAt, int(180, 420)) : null,
        deliveryNote: kind === 'FAILED' ? pick(FAIL_NOTES) : kind === 'DELIVERED' && rnd() < 0.3 ? 'Хүлээн авагчид гарт нь өгсөн' : null,
        items: { create: items },
      },
    });

    if (paid) {
      const payAt = addMin(createdAt, int(1, 15));
      const payment = await prisma.payment.create({
        data: { orderId: order.id, amount: total, method: 'TRANSFER', note: 'Дансаар шилжүүлсэн', receivedById: seller.id, createdAt: payAt },
      });
      await prisma.financeEntry.create({
        data: {
          type: 'INCOME',
          category: 'PAYMENT',
          amount: total,
          note: `Төлбөр ${orderNo} (Шилжүүлэг)`,
          refOrderId: order.id,
          refPaymentId: payment.id,
          createdById: seller.id,
          entryDate: payAt,
        },
      });
    }

    if (kind !== 'CANCELLED') {
      for (const it of items) {
        sold.set(it.productId, (sold.get(it.productId) ?? 0) + it.qty);
        moves.push({ productId: it.productId, qtyChange: -it.qty, reason: 'ORDER', refId: order.id, note: orderNo, userId: seller.id, createdAt });
      }
    }
  }

  // ── Үлдэгдэл: эхний үлдэгдэл = эцсийн + зарагдсан ──
  const start = new Date(now);
  start.setDate(start.getDate() - 20);
  for (const [i, p] of products.entries()) {
    const final = PRODUCTS[i]![4];
    const initial = final + (sold.get(p.id) ?? 0);
    await prisma.product.update({ where: { id: p.id }, data: { stockQty: final } });
    if (initial > 0) {
      moves.push({ productId: p.id, qtyChange: initial, reason: 'INITIAL', note: 'Эхний үлдэгдэл', userId: demo.id, createdAt: start });
    }
  }
  await prisma.stockMovement.createMany({ data: moves });

  // ── Зарлагууд ──
  const expense = (daysAgo: number, category: string, amount: number, note: string) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(11, 0, 0, 0);
    return { type: 'EXPENSE' as const, category, amount: D(amount), note, createdById: demo.id, entryDate: d };
  };
  await prisma.financeEntry.createMany({
    data: [
      expense(13, 'RENT', 1_200_000, 'Агуулахын түрээс'),
      expense(10, 'MARKETING', 350_000, 'Instagram сурталчилгаа'),
      expense(7, 'PACKAGING', 120_000, 'Хайрцаг, баглаа боодол'),
      expense(4, 'MARKETING', 280_000, 'Facebook сурталчилгаа'),
      expense(2, 'UTILITIES', 95_000, 'Интернэт, цахилгаан'),
    ],
  });

  const [users, prods, orders, payments] = await Promise.all([prisma.user.count(), prisma.product.count(), prisma.order.count(), prisma.payment.count()]);
  console.log(`seed-demo дууслаа: хэрэглэгч ${users}, бараа ${prods}, захиалга ${orders}, төлбөр ${payments}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

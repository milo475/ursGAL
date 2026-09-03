import 'dotenv/config';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PaymentsService } from '../src/finance/payments.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UPLOADS_DIR } from '../src/uploads.config';

/**
 * ursGAL v2 — иж бүрэн E2E тест.
 * Бодит DB ашиглана: өөрийн тест өгөгдлөө (T суффикстэй) үүсгэж,
 * төгсгөлд бүгдийг цэвэрлэнэ. Seed-ийн 4 хэрэглэгч байх шаардлагатай.
 */

const T = Date.now().toString().slice(-7); // давхардахгүй суффикс
const SKU = `E2E-${T}`;
/** Борлуулагчийн тестийн хүлээн авагч — бусад тесттэй давхцахгүй 8 орон */
const SELLER_PHONE = `1${T}`;

/** УБ горимын жишиг хаяг (fullAddress-ийн хүлээгдэх утгатай хослоно) */
const UB_ADDR = {
  region: 'ULAANBAATAR',
  district: 'ХУД',
  khoroo: '11',
  building: 'Гоёо хотхон 45-р байр',
  entrance: '2',
  floor: '5',
  door: '501',
};
const UB_FULL =
  'ХУД, 11-р хороо, Гоёо хотхон 45-р байр, 2-р орц, 5 давхар, 501 тоот';

/** Хамгийн жижиг хүчинтэй PNG (8×8) — баталгаажуулах зурагт */
function makePng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([t, data]);
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable.push(c >>> 0);
    }
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: 8 }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG = makePng();

describe('ursGAL v2 API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;

  // Токенууд
  const tok: Record<string, string> = {};
  // Тестийн туршид үүсэх зүйлс
  let categoryId: string;
  let productId: string;
  let orderId: string; // үндсэн урсгалын захиалга
  let order2Id: string; // амжилтгүй + цуцлалтын захиалга
  let adminOrderId: string; // операторын 403 тест
  let e2eDriverId: string; // тестийн жолооч
  let e2eDriverToken: string;
  let permUserId: string; // permission panel-ын тестийн оператор
  let permUserToken: string;
  let financeOrderId: string; // гараар COMPLETED болгох санхүүгийн тест
  let raceOrderId: string; // зэрэг төлбөрийн TOCTOU тест
  let raceProductId: string; // тухайн тестийн тусдаа бараа
  let lowStockProductId: string; // бага үлдэгдлийн БОСГЫН тестийн бараа
  let readyOrderId: string; // READY төлөвт хуваарилалтын тест
  let readyProductId: string;
  const financeEntryIds: string[] = []; // гараар бүртгэсэн гүйлгээнүүд
  let payoutId: string; // жолоочийн цалингийн тооцоо
  let roA: string; // маршрутын дарааллын тест захиалгууд
  let roB: string;
  let e2eMgrId: string; // default матрицын шалгалтын менежер
  let noPhotoOrderId: string; // зураггүй баталгаажуулалтын тест
  let costOrderId: string; // өртгийн snapshot-ын тест
  let retOrderId: string; // буцаалтын тест (V4-04)
  let retItemId: string; // буцаалтын тест захиалгын мөр
  const feeOrderIds: string[] = []; // тарифын тест захиалгууд (V4-05)
  /** Тестийн үүсгэсэн хүсэлтүүд — мэдэгдэл нь эдгээрийг заадаг */
  const requestIds: string[] = [];
  /** Засварын тестийн нэмэлт бараанууд */
  const editProductIds: string[] = [];
  /** Уртын хязгаарын тестийн захиалга */
  let lengthOrderId: string;
  /** Хугацаа/цувралын тестийн бараа */
  let batchProductId: string;
  /** Нийлүүлэлтийн тест — компани/нийлүүлэлт/харилцагч */
  let supCompanyId: string;
  let supPartnerId: string;
  const supplyIds: string[] = [];
  let sellerId: string; // борлуулагчийн тест хэрэглэгч (V5)
  let sellerToken: string;
  let keeperId: string; // няравын тест хэрэглэгч (V5)
  let keeperToken: string;
  let handoverId: string;
  const testStartedAt = new Date(); // ActivityLog цэвэрлэгээнд
  const proofFiles: string[] = [];

  const api = () => request(http);
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    for (const u of ['admin', 'manager', 'operator', 'driver', 'seller']) {
      const res = await api()
        .post('/api/auth/login')
        .send({ email: `${u}@ursgal.mn`, password: `${u}123` })
        .expect(200);
      tok[u] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    // Тестийн бүх ул мөрийг цэвэрлэнэ
    const orderIds = [
      orderId,
      order2Id,
      adminOrderId,
      financeOrderId,
      raceOrderId,
      readyOrderId,
      roA,
      roB,
      noPhotoOrderId,
      costOrderId,
      retOrderId,
      ...feeOrderIds,
      lengthOrderId,
    ].filter(Boolean);
    await prisma.financeEntry.deleteMany({
      where: {
        OR: [
          { id: { in: financeEntryIds } },
          { refOrderId: { in: orderIds } },
          ...(payoutId ? [{ refOrderId: payoutId }] : []),
        ],
      },
    });
    // Төлбөрүүд (v4) — захиалгаас өмнө устгана (FK)
    await prisma.payment.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    // Буцаалтууд (v4) — мөрүүд нь cascade-аар устна
    await prisma.orderReturn.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    // Нийлүүлэлт — SupplyItem нь Product руу RESTRICT-ээр заадаг тул
    // барааг устгахаас ӨМНӨ салгана. (Энэ дараалал буруу байхад afterAll
    // унаж, бүх тестийн ул мөр DB-д үлддэг байв.)
    if (supplyIds.length) {
      await prisma.stockMovement.deleteMany({
        where: { refId: { in: supplyIds } },
      });
      await prisma.notification.deleteMany({
        where: { refId: { in: supplyIds } },
      });
      await prisma.supply.deleteMany({ where: { id: { in: supplyIds } } });
    }

    const productIds = [
      productId,
      raceProductId,
      lowStockProductId,
      readyProductId,
      ...editProductIds,
    ].filter(Boolean);
    // Цуврал нь бараа руу RESTRICT-ээр заадаг тул бараанаас ӨМНӨ устна
    await prisma.productBatch.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.stockMovement.deleteMany({
      where: {
        OR: [{ productId: { in: productIds } }, { refId: { in: orderIds } }],
      },
    });
    // Хүлээлгэн өгсөн хуудас — захиалгууд түүн рүү заадаг тул эхлээд салгана
    if (handoverId) {
      await prisma.order.updateMany({
        where: { handoverId },
        data: { handoverId: null },
      });
      await prisma.driverHandover.deleteMany({ where: { id: handoverId } });
    }
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (productIds.length) {
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    if (payoutId) {
      // Захиалгууд дээр устсан тул FK-гүй
      await prisma.driverPayout.deleteMany({ where: { id: payoutId } });
    }
    // Тестийн үеэр үүссэн мэдэгдэл (бодит admin/manager-т очсон) + үйлдлийн түүх
    // Мэдэгдэл — захиалга/бараанаас гадна ХҮСЭЛТИЙГ заасан нь ч бий
    // (ORDER_REQUEST). Цэвэрлэхгүй бол бодит ажилтны хонх дээр тестийн
    // мөр үлдэнэ.
    await prisma.notification.deleteMany({
      where: { refId: { in: [...orderIds, ...productIds, ...requestIds] } },
    });
    await prisma.activityLog.deleteMany({
      where: { createdAt: { gte: testStartedAt } },
    });
    // Тестийн үеэр үүссэн refresh token-ууд (бодит хэрэглэгчдийнх ч)
    await prisma.refreshToken.deleteMany({
      where: { createdAt: { gte: testStartedAt } },
    });
    // Тестийн тохиргоонуудыг цэвэрлэнэ
    await prisma.setting.deleteMany({
      where: {
        key: { in: ['companyName', 'companyPhone', 'allowCustomerCancel'] },
      },
    });
    if (e2eDriverId) {
      await prisma.driverProfile.deleteMany({ where: { userId: e2eDriverId } });
      await prisma.user.deleteMany({ where: { id: e2eDriverId } });
    }
    if (permUserId) {
      // UserPermission-ууд cascade-аар устна
      await prisma.user.deleteMany({ where: { id: permUserId } });
    }
    if (keeperId) {
      await prisma.user.deleteMany({ where: { id: keeperId } });
    }
    if (sellerId) {
      await prisma.user.deleteMany({ where: { id: sellerId } });
    }
    if (supPartnerId) {
      await prisma.user.deleteMany({ where: { id: supPartnerId } });
    }
    if (supCompanyId) {
      await prisma.company.deleteMany({ where: { id: supCompanyId } });
    }
    if (e2eMgrId) {
      await prisma.user.deleteMany({ where: { id: e2eMgrId } });
    }
    for (const f of proofFiles) {
      try {
        unlinkSync(join(UPLOADS_DIR, f));
      } catch {
        /* аль хэдийн байхгүй бол зүгээр */
      }
    }
    await app.close();
  });

  // ────────────────────────────────────────────── AUTH
  describe('Auth', () => {
    it('4 эрх бүгд нэвтэрч, /me зөв role буцаана', async () => {
      for (const [u, role] of [
        ['admin', 'ADMIN'],
        ['manager', 'MANAGER'],
        ['operator', 'OPERATOR'],
        ['driver', 'DRIVER'],
      ] as const) {
        const res = await api().get('/api/auth/me').set(auth(tok[u])).expect(200);
        expect(res.body.role).toBe(role);
        expect(res.body.passwordHash).toBeUndefined();
      }
    });

    it('буруу нууц үг → 401 ялгагдахгүй мессежтэй', async () => {
      const res = await api()
        .post('/api/auth/login')
        .send({ email: 'admin@ursgal.mn', password: 'buruu' })
        .expect(401);
      expect(res.body.message).toBe('Нэвтрэх мэдээлэл буруу');
    });

    it('refresh шинэ хос token өгнө', async () => {
      const login = await api()
        .post('/api/auth/login')
        .send({ email: 'operator@ursgal.mn', password: 'operator123' })
        .expect(200);
      const res = await api()
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.role).toBe('OPERATOR');
    });
  });

  // ────────────────────────────────────────────── ЭРХИЙН МАТРИЦ
  describe('Эрхийн матриц (403)', () => {
    const cases: [string, 'get' | 'post', string, string][] = [
      ['driver бараа харах', 'get', '/api/products', 'driver'],
      ['driver захиалга харах', 'get', '/api/orders', 'driver'],
      ['operator хэрэглэгчид', 'get', '/api/users', 'operator'],
      ['manager admin dashboard', 'get', '/api/dashboard/admin', 'manager'],
      ['admin driver dashboard', 'get', '/api/dashboard/driver', 'admin'],
      ['operator stock summary', 'get', '/api/stock/summary', 'operator'],
      ['driver өөрийн хүргэлт БОЛНО (баталгаа)', 'get', '/api/deliveries/my', 'driver'],
    ];
    for (const [name, method, path, user] of cases) {
      it(name, async () => {
        const expected = name.includes('БОЛНО') ? 200 : 403;
        await api()[method](path).set(auth(tok[user])).expect(expected);
      });
    }

    it('operator бараа үүсгэх → 403, manager захиалга үүсгэх → 403', async () => {
      await api()
        .post('/api/products')
        .set(auth(tok.operator))
        .send({ sku: 'X', name: 'X', price: '1' })
        .expect(403);
      // Permission шалгалт service дотор (V3-13) тул body нь DTO-ийн
      // хувьд хүчинтэй байж гэмээ нь 403-ыг харна.
      // Бодит manager-т Permission Panel-аас orders.create олгогдсон байж
      // болох тул DEFAULT матрицыг шинээр үүсгэсэн MANAGER-ээр шалгана.
      const mgr = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-mgr-${T}@ursgal.mn`,
          name: `Э2Э Менежер ${T}`,
          password: 'e2epass123',
          role: 'MANAGER',
        })
        .expect(201);
      e2eMgrId = mgr.body.id;
      const login = await api()
        .post('/api/auth/login')
        .send({ email: `e2e-mgr-${T}@ursgal.mn`, password: 'e2epass123' })
        .expect(200);
      await api()
        .post('/api/orders')
        .set(auth(login.body.accessToken))
        .send({
          customerName: 'Хориотой',
          customerPhone: '99000000',
          ...UB_ADDR,
          items: [
            { productId: '00000000-0000-4000-8000-000000000000', qty: 1 },
          ],
        })
        .expect(403);
    });
  });

  // ────────────────────────────────────────────── CATEGORY
  describe('Categories', () => {
    it('manager ангилал үүсгэнэ', async () => {
      const res = await api()
        .post('/api/categories')
        .set(auth(tok.manager))
        .send({ name: `Тест-Э2Э-${T}` })
        .expect(201);
      categoryId = res.body.id;
    });

    it('давхардсан нэр → 409', async () => {
      await api()
        .post('/api/categories')
        .set(auth(tok.manager))
        .send({ name: `Тест-Э2Э-${T}` })
        .expect(409);
    });
  });

  // ────────────────────────────────────────────── PRODUCT
  describe('Products', () => {
    it('manager бараа үүсгэнэ (lowStockLimit-тэй)', async () => {
      const res = await api()
        .post('/api/products')
        .set(auth(tok.manager))
        .send({
          sku: SKU,
          name: `Э2Э бараа ${T}`,
          price: '1000.00',
          lowStockLimit: 3,
          categoryId,
        })
        .expect(201);
      productId = res.body.id;
      expect(res.body.stockQty).toBe(0);
      expect(res.body.lowStockLimit).toBe(3);
    });

    it('давхардсан SKU → 409', async () => {
      await api()
        .post('/api/products')
        .set(auth(tok.manager))
        .send({ sku: SKU, name: 'Давхар', price: '1' })
        .expect(409);
    });

    it('бараатай ангилал устгах → 409', async () => {
      await api()
        .delete(`/api/categories/${categoryId}`)
        .set(auth(tok.manager))
        .expect(409);
    });

    it('PATCH дээр stockQty нэвтрэхгүй (whitelist)', async () => {
      const res = await api()
        .patch(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .send({ name: `Э2Э шинэчилсэн ${T}`, stockQty: 999 })
        .expect(200);
      expect(res.body.stockQty).toBe(0);
    });

    it('lowStock=true шүүлтэд орж ирнэ (0 ≤ 3)', async () => {
      const res = await api()
        .get('/api/products?lowStock=true&limit=100')
        .set(auth(tok.seller))
        .expect(200);
      expect(res.body.items.some((p: { id: string }) => p.id === productId)).toBe(true);
    });
  });

  // ────────────────────────────────────────────── STOCK
  describe('Stock', () => {
    it('PURCHASE_IN +10 → үлдэгдэл 10, note хадгалагдана', async () => {
      const res = await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 10, reason: 'PURCHASE_IN', note: 'e2e орлого' })
        .expect(201);
      expect(res.body.product.stockQty).toBe(10);
      expect(res.body.movement.note).toBe('e2e орлого');
    });

    it('MANUAL_OUT эерэг тоотой → 400 (чиглэлийн шалгалт)', async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 5, reason: 'MANUAL_OUT' })
        .expect(400);
    });

    it('хэтэрсэн зарлага → 400 + rollback', async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: -100, reason: 'MANUAL_OUT' })
        .expect(400);
      const p = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(p.body.stockQty).toBe(10);
    });

    it('жагсаалтад байхгүй reason → 400', async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 1, reason: 'MANUAL' })
        .expect(400);
    });

    it('movements reason шүүлт + summary 7 хоног', async () => {
      const mv = await api()
        .get(`/api/stock/movements?productId=${productId}&reason=PURCHASE_IN`)
        .set(auth(tok.seller))
        .expect(200);
      expect(mv.body.total).toBe(1);

      const sum = await api()
        .get('/api/stock/summary?days=7')
        .set(auth(tok.manager))
        .expect(200);
      expect(sum.body).toHaveLength(7);
      expect(sum.body[6]).toHaveProperty('in');
      expect(sum.body[6]).toHaveProperty('out');
      expect(sum.body[6].in).toBeGreaterThanOrEqual(10);
    });
  });

  // ────────────────────────────────────────────── ORDERS
  describe('Orders — transaction ⭐', () => {
    it('УБ горимд дүүрэггүй → 400 «Дүүрэг заавал»', async () => {
      const { district: _d, ...noDistrict } = UB_ADDR;
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerPhone: `9${T}`,
          ...noDistrict,
          items: [{ productId, qty: 1 }],
        })
        .expect(400);
      expect(res.body.message).toContain('Дүүрэг заавал');
    });

    it('Орон нутагт тээвэргүй → 400 «Ачаа явах тээвэр заавал»', async () => {
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerPhone: `9${T}`,
          region: 'ORON_NUTAG',
          province: 'Архангай',
          soum: 'Эрдэнэбулган',
          items: [{ productId, qty: 1 }],
        })
        .expect(400);
      expect(res.body.message).toContain('Ачаа явах тээвэр заавал');
    });

    it('утас 8 оронтой биш → 400', async () => {
      await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerPhone: '123',
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(400);
    });

    it('давхардсан productId → 400', async () => {
      await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-${T}`,
          customerPhone: `9${T}`,
          items: [
            { productId, qty: 1 },
            { productId, qty: 2 },
          ],
        })
        .expect(400);
    });

    it('амжилттай үүсгэлт: дүн, үлдэгдэл, movement', async () => {
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-${T}`,
          customerPhone: `9${T}`,
          extraPhone: `8${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 4 }],
        })
        .expect(201);
      orderId = res.body.id;
      expect(res.body.region).toBe('ULAANBAATAR');
      expect(res.body.district).toBe('ХУД');
      expect(res.body.province).toBeNull(); // эсрэг горимын талбар null

      // GET /:id — fullAddress зөв угсрагдана
      const detail = await api()
        .get(`/api/orders/${orderId}`)
        .set(auth(tok.seller))
        .expect(200);
      expect(detail.body.fullAddress).toBe(UB_FULL);

      // GET / жагсаалт — shortAddress богино хэлбэр (N4)
      const list = await api()
        .get(`/api/orders?search=${res.body.orderNo}`)
        .set(auth(tok.seller))
        .expect(200);
      expect(list.body.items[0].shortAddress).toBe('ХУД, 11-р хороо');
      expect(res.body.orderNo).toMatch(/^ORD-\d{8}-\d{4}$/);
      expect(Number(res.body.totalAmount)).toBe(4000);
      expect(res.body.deliveryStatus).toBe('PENDING');
      expect(res.body.items[0].productName).toBe(`Э2Э шинэчилсэн ${T}`);

      const p = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.seller))
        .expect(200);
      expect(p.body.stockQty).toBe(6);

      const mv = await api()
        .get(`/api/stock/movements?productId=${productId}&reason=ORDER`)
        .set(auth(tok.seller))
        .expect(200);
      expect(mv.body.items[0].qtyChange).toBe(-4);
      expect(mv.body.items[0].refId).toBe(orderId);
    });

    it('хүрэлцэхгүй qty → 400 + ЮУ Ч өөрчлөгдөөгүй', async () => {
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-их-${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 9999 }],
        })
        .expect(400);
      expect(res.body.message).toContain('хүрэлцэхгүй');
      const p = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.seller))
        .expect(200);
      expect(p.body.stockQty).toBe(6);
    });

    it('буруу шилжилт NEW→COMPLETED → 400', async () => {
      await api()
        .patch(`/api/orders/${orderId}/status`)
        .set(auth(tok.seller))
        .send({ status: 'COMPLETED' })
        .expect(400);
    });

    it('operator бусдын захиалгын статус → 403', async () => {
      const admOrd = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э-адм-${T}`,
          customerPhone: `8${T}`,
          region: 'ORON_NUTAG',
          province: 'Архангай',
          soum: 'Эрдэнэбулган',
          transport: 'Од транс',
          addressDetail: 'Захын хойд талд',
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      adminOrderId = admOrd.body.id;
      expect(admOrd.body.district).toBeNull(); // УБ талбарууд null
      const admDetail = await api()
        .get(`/api/orders/${adminOrderId}`)
        .set(auth(tok.admin))
        .expect(200);
      expect(admDetail.body.fullAddress).toBe(
        'Архангай, Эрдэнэбулган сум — Тээвэр: Од транс, Захын хойд талд',
      );
      const admList = await api()
        .get(`/api/orders?search=${admOrd.body.orderNo}`)
        .set(auth(tok.admin))
        .expect(200);
      expect(admList.body.items[0].shortAddress).toBe('Архангай, Эрдэнэбулган');
      await api()
        .patch(`/api/orders/${adminOrderId}/status`)
        .set(auth(tok.operator))
        .send({ status: 'CONFIRMED' })
        .expect(403);
      // цэвэрлэгээ: админ өөрөө цуцалж үлдэгдлээ буцаана
      await api()
        .patch(`/api/orders/${adminOrderId}/status`)
        .set(auth(tok.admin))
        .send({ status: 'CANCELLED' })
        .expect(200);
    });

    it('driver статус солих → 403', async () => {
      await api()
        .patch(`/api/orders/${orderId}/status`)
        .set(auth(tok.driver))
        .send({ status: 'CONFIRMED' })
        .expect(403);
    });

    it('operator өөрийнхөө захиалгыг CONFIRMED болгоно', async () => {
      const res = await api()
        .patch(`/api/orders/${orderId}/status`)
        .set(auth(tok.seller))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      expect(res.body.orderStatus).toBe('CONFIRMED');
    });
  });

  // ────────────────────────────────────────────── DELIVERY
  describe('Delivery — хүргэлтийн мөчлөг ⭐', () => {
    it('тестийн жолооч үүсгэнэ (profile transaction-оор)', async () => {
      const res = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-drv-${T}@ursgal.mn`,
          name: `Э2Э Жолооч ${T}`,
          password: 'e2epass123',
          role: 'DRIVER',
          feePerDelivery: '1500.00',
          vehicleInfo: 'Э2Э тэрэг',
        })
        .expect(201);
      e2eDriverId = res.body.id;
      expect(res.body.driverProfile.feePerDelivery).toBe('1500');

      const login = await api()
        .post('/api/auth/login')
        .send({ email: `e2e-drv-${T}@ursgal.mn`, password: 'e2epass123' })
        .expect(200);
      e2eDriverToken = login.body.accessToken;
    });

    it('feePerDelivery-гүй DRIVER үүсгэх → 400', async () => {
      await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-drv2-${T}@ursgal.mn`,
          name: 'Хөлсгүй',
          password: 'e2epass123',
          role: 'DRIVER',
        })
        .expect(400);
    });

    it('жолооч биш хүнд хуваарилах → 400', async () => {
      const me = await api().get('/api/auth/me').set(auth(tok.operator));
      await api()
        .patch(`/api/orders/${orderId}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: me.body.id })
        .expect(400);
    });

    it('manager хуваарилахад deliveryStatus=ASSIGNED, orderStatus хөндөгдөхгүй', async () => {
      const res = await api()
        .patch(`/api/orders/${orderId}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(200);
      expect(res.body.deliveryStatus).toBe('ASSIGNED');
      expect(res.body.orderStatus).toBe('CONFIRMED');
    });

    it('жолоочийн /my-д харагдана', async () => {
      const res = await api()
        .get('/api/deliveries/my')
        .set(auth(e2eDriverToken))
        .expect(200);
      const mine = res.body.find((d: { id: string }) => d.id === orderId);
      expect(mine).toBeDefined();
      expect(mine.fullAddress).toBe(UB_FULL);
      expect(mine.items[0].qty).toBe(4);
    });

    /**
     * ON_THE_WAY төлөв нь enum, ops самбарын багана, ачааллын тоололд
     * нийт 12 газарт УНШИГДДАГ байсан ч түүнийг БИЧДЭГ код байгаагүй —
     * жолооч ASSIGNED-аас шууд DELIVERED рүү үсэрдэг байв.
     */
    it('«замд гарлаа»: ASSIGNED → ON_THE_WAY, ops самбарт гарна ⭐', async () => {
      // Өөрийн биш хүргэлт → 403
      await api()
        .post(`/api/deliveries/${orderId}/start`)
        .set(auth(tok.driver))
        .expect(403);
      // Жолооч биш → 403 (role guard)
      await api()
        .post(`/api/deliveries/${orderId}/start`)
        .set(auth(tok.manager))
        .expect(403);

      const res = await api()
        .post(`/api/deliveries/${orderId}/start`)
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(res.body.deliveryStatus).toBe('ON_THE_WAY');

      // Идемпотент — офлайн дараалал давхар илгээж болно
      await api()
        .post(`/api/deliveries/${orderId}/start`)
        .set(auth(e2eDriverToken))
        .expect(200);

      // Жолоочийн жагсаалтаас алга болохгүй
      const my = await api()
        .get('/api/deliveries/my')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(my.body.some((d: { id: string }) => d.id === orderId)).toBe(true);

      // Диспетчерийн самбарт ON_THE_WAY баганад орсон
      const board = await api()
        .get('/api/delivery-ops/board')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        board.body.board.ON_THE_WAY.some(
          (o: { id: string }) => o.id === orderId,
        ),
      ).toBe(true);
      expect(
        board.body.board.ASSIGNED.some((o: { id: string }) => o.id === orderId),
      ).toBe(false);
    });

    it('өөр жолооч complete хийх гэвэл → 403', async () => {
      await api()
        .post(`/api/deliveries/${orderId}/complete`)
        .set(auth(tok.driver)) // seed-ийн үндсэн жолооч — хуваарилагдаагүй
        .field('success', 'true')
        .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(403);
    });

    it('зураггүй + тайлбартай амжилттай complete → DELIVERED (зураг заавал биш)', async () => {
      // Тусдаа захиалгаар (бодит жолоочид) — үлдэгдлийг урьдчилан нөхнө
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 1, reason: 'PURCHASE_IN' })
        .expect(201);
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Зураггүй-${T}`,
          customerPhone: `5${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      noPhotoOrderId = ord.body.id;
      await api()
        .patch(`/api/orders/${noPhotoOrderId}/status`)
        .set(auth(tok.seller))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      const realDriver = await api().get('/api/auth/me').set(auth(tok.driver));
      await api()
        .patch(`/api/orders/${noPhotoOrderId}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: realDriver.body.id })
        .expect(200);

      const res = await api()
        .post(`/api/deliveries/${noPhotoOrderId}/complete`)
        .set(auth(tok.driver))
        .field('success', 'true')
        .field('note', 'Гэрт нь байгаагүй — доод талын дэлгүүрт үлдээсэн')
        .expect(201);
      expect(res.body.deliveryStatus).toBe('DELIVERED');
      expect(res.body.deliveryProofUrl).toBeNull();

      // Тайлбар нь admin/manager-т захиалгын дэлгэрэнгүйд харагдана
      const detail = await api()
        .get(`/api/orders/${noPhotoOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(detail.body.deliveryNote).toContain('дэлгүүрт үлдээсэн');
    });

    it('зурагтай complete → DELIVERED, зураг serve хийгдэнэ', async () => {
      const res = await api()
        .post(`/api/deliveries/${orderId}/complete`)
        .set(auth(e2eDriverToken))
        .field('success', 'true')
        .field('note', 'e2e хүргэлт')
        .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(201);
      expect(res.body.orderStatus).toBe('COMPLETED');
      expect(res.body.deliveryStatus).toBe('DELIVERED');
      expect(res.body.deliveryProofUrl).toMatch(/^\/api\/uploads\/[0-9a-f]{32}\.png$/);
      const fname = res.body.deliveryProofUrl.split('/').pop();
      proofFiles.push(fname);
      // Файл диск дээр бодитоор хадгалагдсан (HTTP serve нь production
      // орчинд curl-ээр батлагдсан — Jest-ийн in-process app статикийг үл дэмжинэ)
      expect(existsSync(join(UPLOADS_DIR, fname))).toBe(true);
    });

    it('дахин complete → 400, DELIVERED цуцлагдахгүй → 400', async () => {
      await api()
        .post(`/api/deliveries/${orderId}/complete`)
        .set(auth(e2eDriverToken))
        .field('success', 'true')
        .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(400);
      await api()
        .patch(`/api/orders/${orderId}/status`)
        .set(auth(tok.admin))
        .send({ status: 'CANCELLED' })
        .expect(400);
    });

    it('stats: totalDelivered 1, цалин = 1 × 1500', async () => {
      const res = await api()
        .get('/api/deliveries/my/stats')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(res.body.totalDelivered).toBe(1);
      // Тооцоо хараахан хаагдаагүй — бүгд unpaid-д
      expect(Number(res.body.earnings.unpaid)).toBe(1500);
      expect(Number(res.body.earnings.pendingPayout)).toBe(0);
      expect(Number(res.body.earnings.paidTotal)).toBe(0);
      expect(res.body.last7Days).toHaveLength(7);
    });

    it('амжилтгүй зам: шалтгаангүй → 400, шалтгаантай → FAILED, дахин хуваарилагдана', async () => {
      // 2 дахь захиалга (үлдэгдэл 6-2=4 болно)
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-2-${T}`,
          customerPhone: `7${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 2 }],
        })
        .expect(201);
      order2Id = ord.body.id;
      await api()
        .patch(`/api/orders/${order2Id}/status`)
        .set(auth(tok.seller))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      await api()
        .patch(`/api/orders/${order2Id}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(200);

      await api()
        .post(`/api/deliveries/${order2Id}/complete`)
        .set(auth(e2eDriverToken))
        .field('success', 'false')
        .expect(400); // шалтгаангүй

      const fail = await api()
        .post(`/api/deliveries/${order2Id}/complete`)
        .set(auth(e2eDriverToken))
        .field('success', 'false')
        .field('note', 'Хаалгаа нээсэнгүй')
        .expect(201);
      expect(fail.body.deliveryStatus).toBe('FAILED');
      expect(fail.body.orderStatus).toBe('CONFIRMED'); // өөрчлөгдөөгүй

      // FAILED дараа дахин хуваарилж болно
      const re = await api()
        .patch(`/api/orders/${order2Id}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(200);
      expect(re.body.deliveryStatus).toBe('ASSIGNED');
    });

    /**
     * Мухардмал урсгал: PREPARING үед жолооч хуваарилаад READY болгоод
     * хүргэлт нь FAILED болвол дахин хуваарилах ямар ч арга үлддэггүй
     * байв — assignDriver зөвхөн CONFIRMED/PREPARING зөвшөөрдөг, READY
     * нь COMPLETED-аас өөр рүү шилжихгүй. Одоо READY ч хуваарилагдана.
     */
    it('READY төлөвт жолооч хуваарилагдана (мухардмал урсгал)', async () => {
      const prod = await api()
        .post('/api/products')
        .set(auth(tok.manager))
        .send({
          sku: `${SKU}-READY`,
          name: `Э2Э Бэлэн ${T}`,
          price: '1000.00',
          lowStockLimit: 0,
        })
        .expect(201);
      readyProductId = prod.body.id;
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId: readyProductId, qtyChange: 3, reason: 'PURCHASE_IN' })
        .expect(201);
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Бэлэн-${T}`,
          customerPhone: `7${T}`,
          ...UB_ADDR,
          items: [{ productId: readyProductId, qty: 1 }],
        })
        .expect(201);
      readyOrderId = ord.body.id;

      for (const s of ['CONFIRMED', 'PREPARING', 'READY']) {
        await api()
          .patch(`/api/orders/${readyOrderId}/status`)
          .set(auth(tok.manager))
          .send({ status: s })
          .expect(200);
      }

      const onReady = await api()
        .patch(`/api/orders/${readyOrderId}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(200);
      expect(onReady.body.deliveryStatus).toBe('ASSIGNED');
      expect(onReady.body.orderStatus).toBe('READY');

      // COMPLETED хэвээр хориотой
      await api()
        .patch(`/api/orders/${readyOrderId}/status`)
        .set(auth(tok.manager))
        .send({ status: 'COMPLETED' })
        .expect(200);
      await api()
        .patch(`/api/orders/${readyOrderId}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(400);

      // Энэ захиалга жолоочид ХУВААРИЛАГДСАН хэвээр үлдэх тул дараагийн
      // тестүүдийн ачаалал/цалингийн тоололд нөлөөлнө — шууд устгана
      // (API-аар unassign хийх зам байхгүй)
      await prisma.stockMovement.deleteMany({ where: { refId: readyOrderId } });
      // Хуваарилалт нь ORDER_RELEASED мэдэгдэл үүсгэсэн (V5). readyOrderId-г
      // энд хоослодог тул эцсийн цэвэрлэгээний жагсаалтад орохгүй —
      // мэдэгдлийг ЭНД устгахгүй бол ажилтны хонх дээр тестийн мөр үлдэнэ.
      await prisma.notification.deleteMany({ where: { refId: readyOrderId } });
      await prisma.order.delete({ where: { id: readyOrderId } });
      readyOrderId = '';
    });

    it('цуцлалт: үлдэгдэл буцаж, жолооч unassign болно', async () => {
      const before = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager));
      const res = await api()
        .patch(`/api/orders/${order2Id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect(res.body.assignedDriverId).toBeNull();
      // deliveryStatus нь ASSIGNED хэвээр үлдэж, жолоочийн ачааллын
      // тоолуурт мөнхөд тоологддог байсныг зассан
      expect(res.body.deliveryStatus).toBe('PENDING');
      expect(res.body.routeOrder).toBeNull();

      const after = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager));
      expect(after.body.stockQty).toBe(before.body.stockQty + 2);

      const mv = await api()
        .get(`/api/stock/movements?productId=${productId}&reason=ORDER_CANCEL`)
        .set(auth(tok.manager))
        .expect(200);
      expect(mv.body.items[0].qtyChange).toBe(2);
    });
  });

  // ────────────────────────────────────────────── USERS
  describe('Users — эрх хуваарилалт', () => {
    it('дуусаагүй хүргэлтгүй жолоочийн эрх солигдоно, profile хадгалагдана', async () => {
      const toOp = await api()
        .patch(`/api/users/${e2eDriverId}`)
        .set(auth(tok.admin))
        .send({ role: 'OPERATOR' })
        .expect(200);
      expect(toOp.body.role).toBe('OPERATOR');

      const back = await api()
        .patch(`/api/users/${e2eDriverId}`)
        .set(auth(tok.admin))
        .send({ role: 'DRIVER' })
        .expect(200);
      expect(back.body.driverProfile.feePerDelivery).toBe('1500');
    });

    it('хөлс шинэчлэгдэнэ', async () => {
      const res = await api()
        .patch(`/api/users/${e2eDriverId}`)
        .set(auth(tok.admin))
        .send({ feePerDelivery: '1800.00' })
        .expect(200);
      expect(res.body.driverProfile.feePerDelivery).toBe('1800');
    });

    it('өөрийгөө идэвхгүй болгох / эрхээ солих → 400', async () => {
      const me = await api().get('/api/auth/me').set(auth(tok.admin));
      await api()
        .patch(`/api/users/${me.body.id}`)
        .set(auth(tok.admin))
        .send({ isActive: false })
        .expect(400);
      await api()
        .patch(`/api/users/${me.body.id}`)
        .set(auth(tok.admin))
        .send({ role: 'OPERATOR' })
        .expect(400);
    });
  });

  // ────────────────────────────────────────────── PERMISSION PANEL (V3)
  describe('V3: Permission Panel ⭐', () => {
    it('operator панел харах → 403 (permissions.manage байхгүй)', async () => {
      await api()
        .get(`/api/users/${e2eDriverId}/permissions`)
        .set(auth(tok.operator))
        .expect(403);
    });

    it('тестийн оператор үүсгэж, панелын бүтэц зөв', async () => {
      const res = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-perm-${T}@ursgal.mn`,
          name: `Э2Э Перм ${T}`,
          password: 'e2epass123',
          role: 'SELLER',
        })
        .expect(201);
      permUserId = res.body.id;
      const login = await api()
        .post('/api/auth/login')
        .send({ email: `e2e-perm-${T}@ursgal.mn`, password: 'e2epass123' })
        .expect(200);
      permUserToken = login.body.accessToken;

      const panel = await api()
        .get(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .expect(200);
      expect(panel.body.role).toBe('SELLER');
      expect(panel.body.groups.map((g: { group: string }) => g.group)).toEqual([
        'ORDERS',
        'CUSTOMERS',
        'DRIVERS',
        'SUPPLIES',
        'INVENTORY',
        'FINANCE',
        'REPORTS',
        'SYSTEM',
      ]);
      type Item = {
        key: string;
        label: string;
        roleDefault: boolean;
        override: boolean | null;
        effective: boolean;
      };
      const orders: Item[] = panel.body.groups[0].items;
      expect(orders.find((i) => i.key === 'orders.create')).toMatchObject({
        label: 'Захиалга үүсгэх',
        roleDefault: true,
        override: null,
        effective: true,
      });
      // Хэрэглэгддэггүй түлхүүрүүд (orders.edit/delete гэх мэт) панелаас
      // бүрмөсөн хасагдсан — "юу ч хийхгүй" checkbox үлдээхгүй
      const allKeys: string[] = panel.body.groups.flatMap(
        (g: { items: Item[] }) => g.items.map((i) => i.key),
      );
      for (const dead of [
        'orders.delete',
        'customers.create',
        'customers.delete',
        'inventory.stock_in',
        'inventory.stock_out',
      ]) {
        expect(allKeys).not.toContain(dead);
      }
      // Панелын түлхүүр бүр backend-ийн ямар нэг route-д хэрэглэгддэг
      // (V5-д нярав нэмэгдэхэд +2: orders.assign_warehouse, warehouse.handover)
      expect(allKeys).toHaveLength(33);
      expect(allKeys).toContain('drivers.zones');
      expect(allKeys).toContain('orders.cancel');
      expect(allKeys).toContain('supplies.create');
      expect(allKeys).toContain('orders.assign_warehouse');
      expect(allKeys).toContain('warehouse.handover');
      expect(allKeys).toContain('orders.edit');

      // Хасагдсан түлхүүрийг олгох гэвэл валидацид унана
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'orders.delete', allowed: true }] })
        .expect(400);
    });

    it('override хасах → ШУУД 403 (cache invalidate); null → default буцна', async () => {
      const put = await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'orders.create', allowed: false }] })
        .expect(200);
      const item = put.body.groups[0].items.find(
        (i: { key: string }) => i.key === 'orders.create',
      );
      expect(item).toMatchObject({
        roleDefault: true,
        override: false,
        effective: false,
      });

      // Permission шалгалт service-ийн эхэнд — хүчинтэй body-той ч 403
      const probeBody = {
        customerPhone: '99000001',
        ...UB_ADDR,
        items: [{ productId: '00000000-0000-4000-8000-000000000000', qty: 1 }],
      };
      await api()
        .post('/api/orders')
        .set(auth(permUserToken))
        .send(probeBody)
        .expect(403);

      const restored = await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'orders.create', allowed: null }] })
        .expect(200);
      const r = restored.body.groups[0].items.find(
        (i: { key: string }) => i.key === 'orders.create',
      );
      expect(r).toMatchObject({ override: null, effective: true });
      // Эрх сэргэсэн — одоо validation-д тулна (400, захиалга үүсээгүй)
      await api()
        .post('/api/orders')
        .set(auth(permUserToken))
        .send({})
        .expect(400);
    });

    it('default-д байхгүй эрх олгож болно; өөрийнхөө permissions.manage хасах → 400', async () => {
      await api()
        .get(`/api/users/${permUserId}/permissions`)
        .set(auth(permUserToken))
        .expect(403);

      // ⚠ Эрхийн эскалацийн хамгаалалт: ЗӨВХӨН permissions.manage
      // ХАНГАЛТГҮЙ — /users/* нь users.manage-ыг МӨН шаардана.
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'permissions.manage', allowed: true }] })
        .expect(200);
      await api()
        .get(`/api/users/${permUserId}/permissions`)
        .set(auth(permUserToken))
        .expect(403);

      // Хоёулаа байж гэмээ нь нээгдэнэ
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'users.manage', allowed: true }] })
        .expect(200);
      await api()
        .get(`/api/users/${permUserId}/permissions`)
        .set(auth(permUserToken))
        .expect(200);

      const res = await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(permUserToken))
        .send({ changes: [{ key: 'permissions.manage', allowed: false }] })
        .expect(400);
      expect(res.body.message).toContain('боломжгүй');

      // цэвэрлэгээ: admin override-уудыг буцаана
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({
          changes: [
            { key: 'permissions.manage', allowed: null },
            { key: 'users.manage', allowed: null },
          ],
        })
        .expect(200);
      await api()
        .get(`/api/users/${permUserId}/permissions`)
        .set(auth(permUserToken))
        .expect(403);
    });

    it('manager-аас эрх хасах → 403, буцаах → эрх сэргэнэ (V3-18)', async () => {
      const users = await api()
        .get('/api/users')
        .set(auth(tok.admin))
        .expect(200);
      const managerId = users.body.find(
        (u: { username: string }) => u.username === 'manager@ursgal.mn',
      ).id;

      // Хасахаас ӨМНӨ: guard нь param validation-аас түрүүнд тул
      // санамсаргүй uuid-тэй ч 403 БИШ (404 Захиалга олдсонгүй)
      const FAKE = '00000000-0000-4000-8000-000000000000';
      await api()
        .patch(`/api/orders/${FAKE}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: FAKE })
        .expect(404);

      await api()
        .put(`/api/users/${managerId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'orders.assign_driver', allowed: false }] })
        .expect(200);
      await api()
        .patch(`/api/orders/${FAKE}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: FAKE })
        .expect(403);

      // Default руу буцаахад дахин нэвтэрнэ
      await api()
        .put(`/api/users/${managerId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'orders.assign_driver', allowed: null }] })
        .expect(200);
      await api()
        .patch(`/api/orders/${FAKE}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: FAKE })
        .expect(404);
    });

    it('ADMIN-ий permission өөрчлөх → 400; буруу түлхүүр → 400', async () => {
      const me = await api().get('/api/auth/me').set(auth(tok.admin));
      const res = await api()
        .put(`/api/users/${me.body.id}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'orders.view', allowed: false }] })
        .expect(400);
      expect(res.body.message).toBe('Админы эрхийг хязгаарлах боломжгүй');

      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'huurmag.key', allowed: false }] })
        .expect(400);
    });
  });

  // ──────────────────────────────── V5: ХАМГААЛАЛТГҮЙ ENDPOINT-УУД
  /**
   * Аудитаар илэрсэн: /dashboard/stock-health ба GET /categories дээр
   * ямар ч guard байгаагүй — DRIVER/CUSTOMER бүх барааны SKU, үлдэгдэл,
   * борлуулалтыг уншиж чаддаг байсан. Одоо inventory.view шаардана.
   */
  describe('V5: Guard байхгүй байсан endpoint-ууд ⭐', () => {
    it('stock-health: driver → 403, operator/manager → 200', async () => {
      await api()
        .get('/api/dashboard/stock-health')
        .set(auth(tok.driver))
        .expect(403);
      await api()
        .get('/api/dashboard/stock-health')
        .set(auth(tok.seller))
        .expect(200);
      const res = await api()
        .get('/api/dashboard/stock-health')
        .set(auth(tok.manager))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /categories: driver → 403, operator → 200', async () => {
      await api().get('/api/categories').set(auth(tok.driver)).expect(403);
      const res = await api()
        .get('/api/categories')
        .set(auth(tok.seller))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('inventory.view хасагдсан хэрэглэгч хоёуланд нь 403', async () => {
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'inventory.view', allowed: false }] })
        .expect(200);
      await api()
        .get('/api/dashboard/stock-health')
        .set(auth(permUserToken))
        .expect(403);
      await api().get('/api/categories').set(auth(permUserToken)).expect(403);

      // цэвэрлэгээ: default руу буцаана
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'inventory.view', allowed: null }] })
        .expect(200);
      await api()
        .get('/api/categories')
        .set(auth(permUserToken))
        .expect(200);
    });

    /**
     * AssignDriverModal нь жолоочийн жагсаалтыг @Roles(MANAGER, ADMIN)-тай
     * /dashboard/manager-ээс уншдаг байсан тул orders.assign_driver
     * override авсан OPERATOR-т товч гарч ирээд dropdown хоосон, 403
     * алдаа өгдөг байв. Одоо GET /drivers нь drivers.view ЭСВЭЛ
     * orders.assign_driver-ийн аль нэгийг хүлээж авна.
     */
    it('GET /drivers: assign_driver override-той хүнд нээгдэнэ', async () => {
      // Тестийн хэрэглэгч БОРЛУУЛАГЧ тул default-аар хоёулаа байдаг —
      // урьдчилсан нөхцөлийг override-оор хасаж бэлдэнэ
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({
          changes: [
            { key: 'drivers.view', allowed: false },
            { key: 'orders.assign_driver', allowed: false },
          ],
        })
        .expect(200);
      await api().get('/api/drivers').set(auth(permUserToken)).expect(403);

      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({ changes: [{ key: 'orders.assign_driver', allowed: true }] })
        .expect(200);
      const res = await api()
        .get('/api/drivers')
        .set(auth(permUserToken))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);

      // drivers.view-тэй хүн ч мөн адил (manager)
      await api().get('/api/drivers').set(auth(tok.manager)).expect(200);
      // Аль нь ч байхгүй DRIVER → 403 хэвээр
      await api().get('/api/drivers').set(auth(tok.driver)).expect(403);

      // цэвэрлэгээ — хоёуланг нь default руу буцаана
      await api()
        .put(`/api/users/${permUserId}/permissions`)
        .set(auth(tok.admin))
        .send({
          changes: [
            { key: 'orders.assign_driver', allowed: null },
            { key: 'drivers.view', allowed: null },
          ],
        })
        .expect(200);
      await api().get('/api/drivers').set(auth(permUserToken)).expect(200);
    });

    it('нэвтрэлтгүйгээр хоёулаа 401', async () => {
      await api().get('/api/dashboard/stock-health').expect(401);
      await api().get('/api/categories').expect(401);
    });

    /**
     * Permission cache нь userId-оор түлхүүрлэгддэг ч утга нь role-оос
     * хамаардаг байсан тул role солиход 60 секунд хүртэл ХУУЧИН role-ийн
     * эрх хэвээр үлддэг байв. Одоо шууд үйлчлэх ёстой.
     */
    it('role солиход эрх ШУУД шинэчлэгдэнэ (cache invalidate)', async () => {
      // 1. Жолоочийн эрхгүй role (ХАРИЛЦАГЧ) болгоод cache-ыг халаана.
      // Override ашиглахгүй — энэ тест нь ЗӨВХӨН role солилтын
      // нөлөөг хэмжих ёстой (override нь role-оос дээгүүр тул баруйлна).
      await api()
        .patch(`/api/users/${permUserId}`)
        .set(auth(tok.admin))
        .send({ role: 'OPERATOR' })
        .expect(200);
      await api()
        .get('/api/auth/me')
        .set(auth(permUserToken))
        .expect(200);
      await api().get('/api/drivers').set(auth(permUserToken)).expect(403);

      // 2. MANAGER болгоно (token хэвээр — role нь DB-ээс уншигдана)
      await api()
        .patch(`/api/users/${permUserId}`)
        .set(auth(tok.admin))
        .send({ role: 'MANAGER' })
        .expect(200);

      // 3. ХҮЛЭЭЛГҮЙГЭЭР MANAGER-ийн эрх үйлчилнэ
      await api().get('/api/drivers').set(auth(permUserToken)).expect(200);
      const me = await api()
        .get('/api/auth/me')
        .set(auth(permUserToken))
        .expect(200);
      expect(me.body.role).toBe('MANAGER');
      expect(me.body.permissions).toContain('drivers.view');
      expect(me.body.permissions).not.toContain('orders.create');

      // 4. Буцаахад мөн адил шууд — эрх нэн даруй хумигдана
      await api()
        .patch(`/api/users/${permUserId}`)
        .set(auth(tok.admin))
        .send({ role: 'OPERATOR' })
        .expect(200);
      await api().get('/api/drivers').set(auth(permUserToken)).expect(403);
    });
  });

  // ────────────────────────────────────────────── FINANCE (V3)
  describe('V3: Finance ⭐', () => {
    it('эрхгүй хандалт: driver жагсаалт → 403, operator бүртгэх → 403', async () => {
      await api()
        .get('/api/finance/entries')
        .set(auth(tok.driver))
        .expect(403);
      await api()
        .post('/api/finance/entries')
        .set(auth(tok.operator))
        .send({ type: 'INCOME', category: 'OTHER_INCOME', amount: '100.00' })
        .expect(403);
    });

    it('manager орлого/зарлага бүртгэнэ', async () => {
      const inc = await api()
        .post('/api/finance/entries')
        .set(auth(tok.manager))
        .send({ type: 'INCOME', category: 'OTHER_INCOME', amount: '5000.00' })
        .expect(201);
      financeEntryIds.push(inc.body.id);
      expect(inc.body.amount).toBe('5000');

      const exp = await api()
        .post('/api/finance/entries')
        .set(auth(tok.manager))
        .send({
          type: 'EXPENSE',
          category: 'RENT',
          amount: '3000.50',
          note: 'Э2Э зарлага',
        })
        .expect(201);
      financeEntryIds.push(exp.body.id);
      expect(exp.body.type).toBe('EXPENSE');
      expect(exp.body.createdBy.fullName).toBeTruthy();
    });

    /**
     * Ангилал нь каталогийн код байх ёстой (V5) — эс тэгвэл нэг зардал
     * олон нэрээр хуваагдаж тайлан бүлэглэгдэхгүй болно.
     */
    it('чөлөөт текст ба автомат ангилал хоригдоно', async () => {
      const bad = await api()
        .post('/api/finance/entries')
        .set(auth(tok.manager))
        .send({ type: 'EXPENSE', category: 'Түрээс', amount: '100' })
        .expect(400);
      expect(bad.body.message).toContain('Ангилал буруу');

      // Автомат ангилал — гараар бичвэл тайлангийн тоо давхардана
      await api()
        .post('/api/finance/entries')
        .set(auth(tok.manager))
        .send({ type: 'INCOME', category: 'PAYMENT', amount: '100' })
        .expect(400);
      await api()
        .post('/api/finance/entries')
        .set(auth(tok.manager))
        .send({ type: 'EXPENSE', category: 'SUPPLY', amount: '100' })
        .expect(400);

      const cats = await api()
        .get('/api/finance/categories')
        .set(auth(tok.manager))
        .expect(200);
      expect(cats.body.EXPENSE.map((c: { code: string }) => c.code)).toContain(
        'RENT',
      );
      // Автомат ангиллууд сонголтод ГАРАХГҮЙ
      expect(cats.body.EXPENSE.map((c: { code: string }) => c.code)).not.toContain(
        'SUPPLY',
      );
    });

    it('жагсаалт type шүүлтүүртэй', async () => {
      const res = await api()
        .get('/api/finance/entries?type=EXPENSE&limit=50')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        res.body.items.some(
          (e: { id: string }) => e.id === financeEntryIds[1],
        ),
      ).toBe(true);
      expect(
        res.body.items.every((e: { type: string }) => e.type === 'EXPENSE'),
      ).toBe(true);
    });

    it('V4: DELIVERED-д орлого ҮҮСЭХГҮЙ — авлагад гарна (operator 403)', async () => {
      // orderId хүргэгдсэн ч төлөгдөөгүй — INCOME байхгүй
      const res = await api()
        .get('/api/finance/entries?type=INCOME&limit=100')
        .set(auth(tok.admin))
        .expect(200);
      expect(
        res.body.items.filter(
          (e: { refOrderId: string | null }) => e.refOrderId === orderId,
        ),
      ).toHaveLength(0);

      await api()
        .get('/api/finance/receivables')
        .set(auth(tok.operator))
        .expect(403);
      const rec = await api()
        .get('/api/finance/receivables')
        .set(auth(tok.manager))
        .expect(200);
      const row = rec.body.items.find(
        (r: { id: string }) => r.id === orderId,
      );
      expect(row).toBeDefined();
      expect(row.remaining).toBe('4000');
      expect(row.paymentStatus).toBe('UNPAID');
      expect(row.daysOutstanding).toBe(0);
      expect(Number(rec.body.totalRemaining)).toBeGreaterThanOrEqual(4000);
    });

    it('V4: төлбөр — PARTIAL→PAID, илүү 400, устгал буцаана', async () => {
      // Хэсэгчилсэн төлбөр → PARTIAL + тэр дүнгээр INCOME (PAYMENT)
      const p1 = await api()
        .post(`/api/orders/${orderId}/payments`)
        .set(auth(tok.manager))
        .send({ amount: '1500.00', method: 'TRANSFER' })
        .expect(201);
      expect(p1.body.order.paymentStatus).toBe('PARTIAL');
      expect(p1.body.order.paidAmount).toBe('1500');

      const inc = await api()
        .get('/api/finance/entries?type=INCOME&limit=100')
        .set(auth(tok.admin))
        .expect(200);
      const pe = inc.body.items.find(
        (e: { refPaymentId: string | null }) => e.refPaymentId === p1.body.id,
      );
      expect(pe.category).toBe('PAYMENT');
      expect(pe.amount).toBe('1500');

      // Үлдэгдлээс их → 400
      await api()
        .post(`/api/orders/${orderId}/payments`)
        .set(auth(tok.manager))
        .send({ amount: '3000.00', method: 'TRANSFER' })
        .expect(400);

      // Бүрэн төлөлт → PAID, авлагаас алга болно
      const p2 = await api()
        .post(`/api/orders/${orderId}/payments`)
        .set(auth(tok.manager))
        .send({ amount: '2500.00', method: 'TRANSFER' })
        .expect(201);
      expect(p2.body.order.paymentStatus).toBe('PAID');
      const rec = await api()
        .get('/api/finance/receivables')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        rec.body.items.some((r: { id: string }) => r.id === orderId),
      ).toBe(false);

      // PAID дээр дахин төлөх → 400
      await api()
        .post(`/api/orders/${orderId}/payments`)
        .set(auth(tok.manager))
        .send({ amount: '1.00', method: 'TRANSFER' })
        .expect(400);

      // Устгахад буцаж PARTIAL + INCOME нь устна
      await api()
        .delete(`/api/payments/${p2.body.id}`)
        .set(auth(tok.manager))
        .expect(200);
      const detail = await api()
        .get(`/api/orders/${orderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(detail.body.paymentStatus).toBe('PARTIAL');
      expect(detail.body.paidAmount).toBe('1500');
      expect(detail.body.payments).toHaveLength(1);
      const inc2 = await api()
        .get('/api/finance/entries?type=INCOME&limit=100')
        .set(auth(tok.admin))
        .expect(200);
      expect(
        inc2.body.items.some(
          (e: { refPaymentId: string | null }) =>
            e.refPaymentId === p2.body.id,
        ),
      ).toBe(false);

      // Дахин бүрэн төлье (дараагийн тестүүдэд PAID байх нь зүйтэй)
      await api()
        .post(`/api/orders/${orderId}/payments`)
        .set(auth(tok.manager))
        .send({ amount: '2500.00', method: 'TRANSFER' })
        .expect(201);

      // operator төлбөр бүртгэх эрхгүй
      await api()
        .post(`/api/orders/${orderId}/payments`)
        .set(auth(tok.operator))
        .send({ amount: '1.00', method: 'TRANSFER' })
        .expect(403);
    });

    /**
     * TOCTOU: addPayment захиалгыг транзакцийн ГАДНА уншиж, дотор нь тэр
     * хуучин `paidAmount`-аар тооцдог байсан. Зэрэг ирсэн N төлбөр
     * бүгд шалгалтыг давж, сүүлийнх нь бусдыг дарж бичдэг байв →
     * Payment мөрүүд бүгд үлдээд захиалгын paidAmount ганцыг л тусгана.
     * Одоо мөр `FOR UPDATE`-ээр түгжигдэж, дараалалд орно.
     */
    it('V4: зэрэг ирсэн төлбөр — мөнгө алдагдахгүй (TOCTOU) ⭐', async () => {
      // Хуваалцсан барааны үлдэгдэл/LOW_STOCK тестүүдэд нөлөөлөхгүйн тулд
      // энэ тест өөрийн бараатай
      const prod = await api()
        .post('/api/products')
        .set(auth(tok.manager))
        .send({
          sku: `${SKU}-RACE`,
          name: `Э2Э Раце ${T}`,
          price: '2000.00',
          lowStockLimit: 0,
        })
        .expect(201);
      raceProductId = prod.body.id;
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId: raceProductId, qtyChange: 5, reason: 'PURCHASE_IN' })
        .expect(201);
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Раце-${T}`,
          customerPhone: `7${T}`,
          ...UB_ADDR,
          items: [{ productId: raceProductId, qty: 1 }],
        })
        .expect(201);
      raceOrderId = ord.body.id;
      const total: string = ord.body.totalAmount;

      // БҮТЭН дүнгийн 4 төлбөрийг ЗЭРЭГ илгээнэ — ердөө нэг нь л багтана.
      // Supertest-ийн хүсэлтүүд энэ орчинд практикт дараалдаг тул уралдааныг
      // service давхаргад ШУУД дуудаж үүсгэнэ (бүх уншилт нэг tick-д эхэлнэ).
      const payments = app.get(PaymentsService);
      const mgr = await api()
        .get('/api/auth/me')
        .set(auth(tok.manager))
        .expect(200);
      const results = await Promise.allSettled(
        [0, 1, 2, 3].map(() =>
          payments.addPayment(
            raceOrderId,
            { amount: total, method: 'TRANSFER' },
            mgr.body,
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected).toHaveLength(3);
      for (const r of rejected) {
        expect(String(r.reason.message)).toContain('Үлдэгдлээс их дүн');
      }

      const detail = await api()
        .get(`/api/orders/${raceOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(detail.body.paymentStatus).toBe('PAID');
      expect(detail.body.paidAmount).toBe(total);
      // ⭐ Гол инвариант: Payment мөрүүдийн нийлбэр = paidAmount
      expect(detail.body.payments).toHaveLength(1);
      const sum = detail.body.payments.reduce(
        (a: number, p: { amount: string }) => a + Number(p.amount),
        0,
      );
      expect(sum).toBe(Number(detail.body.paidAmount));

      // INCOME бичилт ч ганцхан — санхүүгийн дэвтэр хоёр дахин бичихгүй
      const inc = await api()
        .get('/api/finance/entries?type=INCOME&limit=100')
        .set(auth(tok.admin))
        .expect(200);
      const mine = inc.body.items.filter(
        (e: { refOrderId: string | null }) => e.refOrderId === raceOrderId,
      );
      expect(mine).toHaveLength(1);
      expect(Number(mine[0].amount)).toBe(Number(total));
    });

    it('V4: гараар COMPLETED болгоход орлого үүсэхгүй, авлагад орно', async () => {
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Санхүү-${T}`,
          customerPhone: `7${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      financeOrderId = ord.body.id;
      for (const s of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
        await api()
          .patch(`/api/orders/${financeOrderId}/status`)
          .set(auth(tok.seller))
          .send({ status: s })
          .expect(200);
      }
      // V4: гараар COMPLETED болгоход ч орлого үүсэхгүй — авлагад орно
      const res = await api()
        .get('/api/finance/entries?type=INCOME&limit=100')
        .set(auth(tok.admin))
        .expect(200);
      expect(
        res.body.items.filter(
          (e: { refOrderId: string | null }) =>
            e.refOrderId === financeOrderId,
        ),
      ).toHaveLength(0);
      const rec = await api()
        .get('/api/finance/receivables')
        .set(auth(tok.manager))
        .expect(200);
      const row = rec.body.items.find(
        (r: { id: string }) => r.id === financeOrderId,
      );
      expect(row.remaining).toBe('1000');
    });

    it('summary: өдөр тутмын мөрүүд + нийлбэрүүд', async () => {
      const res = await api()
        .get('/api/finance/summary?days=1')
        .set(auth(tok.manager))
        .expect(200);
      expect(res.body.byDay).toHaveLength(1);
      // Өнөөдрийнх: гар орлого 5000 + orderId-ийн төлбөрүүд 4000 = 9000
      expect(Number(res.body.income)).toBeGreaterThanOrEqual(9000);
      expect(Number(res.body.expense)).toBeGreaterThanOrEqual(3000.5);
      expect(Number(res.body.net)).toBe(
        Number(res.body.income) - Number(res.body.expense),
      );
      // operator-т summary хаалттай
      await api()
        .get('/api/finance/summary')
        .set(auth(tok.operator))
        .expect(403);
    });
  });

  // ────────────────────────────────────────────── PAYROLL (V3)
  describe('V3: Payroll ⭐', () => {
    it('operator pending харах → 403', async () => {
      await api()
        .get('/api/finance/payroll/pending')
        .set(auth(tok.operator))
        .expect(403);
    });

    it('pending: e2e жолооч 1 хүргэлт × 1800 дүнтэй гарна', async () => {
      const res = await api()
        .get('/api/finance/payroll/pending')
        .set(auth(tok.manager))
        .expect(200);
      const row = res.body.find(
        (r: { driverId: string }) => r.driverId === e2eDriverId,
      );
      expect(row).toBeDefined();
      expect(row.deliveredCount).toBe(1);
      // Users тестэд хөлс 1800 болж шинэчлэгдсэн
      expect(row.feePerDelivery).toBe('1800');
      expect(row.amount).toBe('1800');
    });

    it('close: payout + EXPENSE entry үүсч, дахин тооцогдохгүй', async () => {
      const res = await api()
        .post('/api/finance/payroll/close')
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(201);
      payoutId = res.body.id;
      expect(res.body.status).toBe('PENDING');
      expect(res.body.deliveredCount).toBe(1);
      expect(res.body.totalAmount).toBe('1800');
      expect(res.body.paidAt).toBeNull();

      // pending-ээс алга болно
      const pending = await api()
        .get('/api/finance/payroll/pending')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        pending.body.some(
          (r: { driverId: string }) => r.driverId === e2eDriverId,
        ),
      ).toBe(false);

      // EXPENSE entry автоматаар (refOrderId = payout.id)
      const entries = await api()
        .get('/api/finance/entries?type=EXPENSE&limit=100')
        .set(auth(tok.manager))
        .expect(200);
      const payrollEntry = entries.body.items.find(
        (e: { refOrderId: string | null }) => e.refOrderId === payoutId,
      );
      expect(payrollEntry.category).toBe('DRIVER_PAYROLL');
      expect(payrollEntry.amount).toBe('1800');

      // дахин close → тооцоо хийх хүргэлт алга
      await api()
        .post('/api/finance/payroll/close')
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(400);
    });

    it('stats: unpaid 0 болж pendingPayout руу шилжсэн', async () => {
      const res = await api()
        .get('/api/deliveries/my/stats')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(Number(res.body.earnings.unpaid)).toBe(0);
      expect(res.body.earnings.pendingPayout).toBe('1800');
      expect(Number(res.body.earnings.paidTotal)).toBe(0);
    });

    it('pay: PAID + paidAt; driver-ийн paidTotal өссөн; түүхэнд гарна', async () => {
      const res = await api()
        .patch(`/api/finance/payroll/${payoutId}/pay`)
        .set(auth(tok.admin))
        .expect(200);
      expect(res.body.status).toBe('PAID');
      expect(res.body.paidAt).toBeTruthy();

      // дахин pay → 400
      await api()
        .patch(`/api/finance/payroll/${payoutId}/pay`)
        .set(auth(tok.admin))
        .expect(400);

      const stats = await api()
        .get('/api/deliveries/my/stats')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(stats.body.earnings.paidTotal).toBe('1800');
      expect(Number(stats.body.earnings.pendingPayout)).toBe(0);

      const hist = await api()
        .get(`/api/finance/payroll?driverId=${e2eDriverId}&status=PAID`)
        .set(auth(tok.manager))
        .expect(200);
      expect(hist.body.some((p: { id: string }) => p.id === payoutId)).toBe(
        true,
      );
    });
  });

  // ────────────────────────────────────────────── DASHBOARDS
  describe('Dashboards — 4 эрх', () => {
    it('admin: бүтэц + тоо уялдаатай', async () => {
      const res = await api()
        .get('/api/dashboard/admin')
        .set(auth(tok.admin))
        .expect(200);
      for (const k of [
        'totalCustomers',
        'totalDrivers',
        'deliveriesInProgress',
        'deliveredTotal',
        'totalIncome',
        'totalProfit',
        'last7Days',
        'topDrivers',
      ]) {
        expect(res.body).toHaveProperty(k);
      }
      expect(res.body.last7Days).toHaveLength(7);
      // topDrivers: топ-3 бүтэц зөв, dr = delivered/assigned уялдаатай.
      // (Бодит DB-ийн жолооч нартай tie болбол Э2Э жолооч top-3-д
      // орохгүй байж болох тул заавал шаардахгүй — бүтцээ шалгана.)
      expect(res.body.topDrivers.length).toBeGreaterThanOrEqual(1);
      expect(res.body.topDrivers.length).toBeLessThanOrEqual(3);
      for (const d of res.body.topDrivers) {
        expect(d).toHaveProperty('name');
        expect(d.assigned).toBeGreaterThanOrEqual(d.delivered);
        expect(d.dr).toBeCloseTo(
          Math.round((d.delivered / d.assigned) * 100) / 100,
          5,
        );
      }
    });

    it('operator: lowStock-д тест бараа орж ирнэ', async () => {
      // Үлдэгдлийг лимитээс доош болгоно (6 → 2, limit 3)
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: -4, reason: 'MANUAL_OUT' })
        .expect(201);

      // Харилцагчийн самбар нь НИЙЛҮҮЛЭГЧИЙНХ (V5): зөвхөн өөрийн
      // компанийн нийлүүлэлт, тооцоо, өөрийн барааны үлдэгдэл.
      // Захиалга, бусдын бараа энд гарахгүй.
      const res = await api()
        .get('/api/dashboard/operator')
        .set(auth(tok.operator))
        .expect(200);
      expect(res.body).not.toHaveProperty('myOrdersTotal');
      expect(res.body).toHaveProperty('dueAmount');
      expect(Array.isArray(res.body.recentSupplies)).toBe(true);
      // Компанид холбогдоогүй харилцагчид хоосон бүтэц ирнэ
      expect(res.body.company).toBeNull();
      expect(res.body.lowStockProducts).toEqual([]);
    });

    it('харилцагч дотоод мэдээлэлд хүрэхгүй ⭐', async () => {
      // Гаднын нийлүүлэгч тул захиалга/бараа/хэрэглэгч харах эрхгүй.
      // Өмнө нь orders.view-тэй байсан тул БҮХ үйлчлүүлэгчийн нэр,
      // утас, хаяг, төлбөрийг хардаг байв.
      const me = await api()
        .get('/api/auth/me')
        .set(auth(tok.operator))
        .expect(200);
      expect(me.body.permissions).toEqual(['supplies.view']);

      for (const path of [
        '/api/orders',
        `/api/orders/${orderId}`,
        '/api/products',
        '/api/customers/by-phone',
        '/api/drivers',
        '/api/stock/movements',
      ]) {
        await api().get(path).set(auth(tok.operator)).expect(403);
      }
    });

    it('manager: stockLast7Days 7 өдөр + driverLoad', async () => {
      const res = await api()
        .get('/api/dashboard/manager')
        .set(auth(tok.manager))
        .expect(200);
      expect(res.body.stockLast7Days).toHaveLength(7);
      expect(Array.isArray(res.body.awaitingAssignment)).toBe(true);
      expect(Array.isArray(res.body.driverLoad)).toBe(true);
    });

    it('driver: dashboard = myStats (нэг метод хоёр route)', async () => {
      const a = await api()
        .get('/api/dashboard/driver')
        .set(auth(e2eDriverToken))
        .expect(200);
      const b = await api()
        .get('/api/deliveries/my/stats')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(a.body.totalDelivered).toBe(b.body.totalDelivered);
      expect(Number(a.body.earnings.unpaid)).toBe(
        Number(b.body.earnings.unpaid),
      );
      expect(Number(a.body.earnings.paidTotal)).toBe(
        Number(b.body.earnings.paidTotal),
      );
    });
  });

  // ────────────────────────────────────────────── NOTIFICATIONS + ACTIVITY LOG (V3)
  describe('V3: Notifications + ActivityLog ⭐', () => {
    it('жолоочид DELIVERY_ASSIGNED очсон; унших урсгал', async () => {
      const res = await api()
        .get('/api/notifications?limit=50')
        .set(auth(e2eDriverToken))
        .expect(200);
      const assigned = res.body.items.filter(
        (n: { type: string }) => n.type === 'DELIVERY_ASSIGNED',
      );
      expect(assigned.length).toBeGreaterThanOrEqual(1);
      expect(assigned[0].title).toContain('Шинэ хүргэлт');
      expect(assigned[0].refType).toBe('order');

      const before = await api()
        .get('/api/notifications/unread-count')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(before.body.count).toBeGreaterThanOrEqual(1);

      const read = await api()
        .patch(`/api/notifications/${assigned[0].id}/read`)
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(read.body.isRead).toBe(true);

      await api()
        .post('/api/notifications/read-all')
        .set(auth(e2eDriverToken))
        .expect(201);
      const after = await api()
        .get('/api/notifications/unread-count')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(after.body.count).toBe(0);

      // Бусдын мэдэгдэл унших → 404
      await api()
        .patch(`/api/notifications/${assigned[0].id}/read`)
        .set(auth(tok.admin))
        .expect(404);
    });

    it('LOW_STOCK: лимит давах МӨЧИД нэг л удаа, өдөрт давхардахгүй', async () => {
      const mine = async () => {
        const res = await api()
          .get('/api/notifications?limit=100')
          .set(auth(tok.admin))
          .expect(200);
        return res.body.items.filter(
          (n: { type: string; refId: string | null }) =>
            n.type === 'LOW_STOCK' && n.refId === productId,
        );
      };
      // Dashboards тестийн −4 зарлага лимит давсан мөчид 1 мэдэгдэл үүсгэсэн
      expect(await mine()).toHaveLength(1);

      // Лимитээс доош байхад дахин хасах → шинэ мэдэгдэл ҮГҮЙ
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: -1, reason: 'MANUAL_OUT' })
        .expect(201);
      expect(await mine()).toHaveLength(1);

      // Дээш гаргаад дахин доош — өдөрт 1 дүрмээр мөн л нэмэгдэхгүй
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 10, reason: 'PURCHASE_IN' })
        .expect(201);
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: -9, reason: 'MANUAL_OUT' })
        .expect(201);
      expect(await mine()).toHaveLength(1);
    });

    /**
     * Босгын зөрүү: Products хуудасны "бага үлдэгдэл" шүүлт нь
     * `stockQty <= lowStockLimit`, харин мэдэгдэл нь `<` байсан. Үүнээс
     * болж ЯГ лимит дээр зогссон бараа жагсаалтад орж ирдэг мөртөө
     * мэдэгдэл нь хэзээ ч ирдэггүй байв. Одоо хоёулаа `<=`.
     */
    it('LOW_STOCK: ЯГ лимит дээр зогсоход мэдэгдэнэ (босго = жагсаалттай ижил)', async () => {
      const prod = await api()
        .post('/api/products')
        .set(auth(tok.manager))
        .send({
          sku: `${SKU}-LIMIT`,
          name: `Э2Э Босго ${T}`,
          price: '1000.00',
          lowStockLimit: 3,
        })
        .expect(201);
      lowStockProductId = prod.body.id;
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({
          productId: lowStockProductId,
          qtyChange: 5,
          reason: 'PURCHASE_IN',
        })
        .expect(201);

      const notifs = async () => {
        const res = await api()
          .get('/api/notifications?limit=100')
          .set(auth(tok.admin))
          .expect(200);
        return res.body.items.filter(
          (n: { type: string; refId: string | null }) =>
            n.type === 'LOW_STOCK' && n.refId === lowStockProductId,
        );
      };
      expect(await notifs()).toHaveLength(0);

      // 5 → 3: ЯГ лимит дээр зогслоо
      const adj = await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({
          productId: lowStockProductId,
          qtyChange: -2,
          reason: 'MANUAL_OUT',
        })
        .expect(201);
      expect(adj.body.product.stockQty).toBe(3);
      expect(await notifs()).toHaveLength(1);

      // Тэрхүү бараа lowStock жагсаалтад ч байна (босго ижил гэдгийн баталгаа)
      const list = await api()
        .get(`/api/products?lowStock=true&search=${T}&limit=50`)
        .set(auth(tok.manager))
        .expect(200);
      expect(
        list.body.items.some(
          (p: { id: string }) => p.id === lowStockProductId,
        ),
      ).toBe(true);
    });

    it('DELIVERY_FAILED: ADMIN/MANAGER-үүдэд очсон', async () => {
      const res = await api()
        .get('/api/notifications?limit=100')
        .set(auth(tok.manager))
        .expect(200);
      const failed = res.body.items.find(
        (n: { type: string; refId: string | null }) =>
          n.type === 'DELIVERY_FAILED' && n.refId === order2Id,
      );
      expect(failed).toBeDefined();
      // V5: биед нь хэн болох + шалтгаан хамт (борлуулагч руу ч очдог тул
      // хэрэглэгчийг таних мэдээлэл хэрэгтэй)
      expect(failed.body).toContain('Хаалгаа нээсэнгүй');
      expect(failed.body).toContain(`7${T}`);
    });

    it('activity-log: бичилтүүд + permission_change + эрхийн шалгалт', async () => {
      // operator-т эрх байхгүй
      await api()
        .get('/api/activity-log')
        .set(auth(tok.operator))
        .expect(403);

      const orders = await api()
        .get('/api/activity-log?entity=orders&limit=100')
        .set(auth(tok.admin))
        .expect(200);
      expect(
        orders.body.items.some((i: { action: string }) =>
          i.action.startsWith('POST'),
        ),
      ).toBe(true);
      expect(orders.body.items[0].userName).toBeTruthy();

      const perms = await api()
        .get('/api/activity-log?entity=permissions&limit=100')
        .set(auth(tok.admin))
        .expect(200);
      const change = perms.body.items.find(
        (i: { action: string; meta: { permKey?: string } | null }) =>
          i.action === 'permission_change' &&
          i.meta?.permKey === 'orders.create',
      );
      expect(change).toBeDefined();
      expect(change.entityId).toBe(permUserId);

      // auth хүсэлтүүд бичигдээгүй
      const auth0 = await api()
        .get('/api/activity-log?entity=auth')
        .set(auth(tok.admin))
        .expect(200);
      expect(auth0.body.total).toBe(0);
    });
  });

  // ────────────────────────────────────────────── DELIVERY OPS + ROUTE (V3)
  describe('V3: Delivery Ops + маршрут ⭐', () => {
    it('operator board харах → 403 (drivers.view байхгүй)', async () => {
      await api()
        .get('/api/delivery-ops/board')
        .set(auth(tok.operator))
        .expect(403);
    });

    it('GET /drivers: manager харна, operator 403 (V3 Жолооч нар хуудас)', async () => {
      await api().get('/api/drivers').set(auth(tok.operator)).expect(403);
      const res = await api()
        .get('/api/drivers')
        .set(auth(tok.manager))
        .expect(200);
      const drv = res.body.find(
        (d: { id: string }) => d.id === e2eDriverId,
      );
      expect(drv).toBeDefined();
      expect(drv.totalDelivered).toBeGreaterThanOrEqual(1);
      expect(drv.feePerDelivery).toBe('1800');
      expect(drv).toHaveProperty('active');
      expect(drv).toHaveProperty('deliveredToday');
    });

    it('2 хүргэлт бэлдэж board дээр бүлэглэгдэнэ', async () => {
      // Үлдэгдэл нэмээд 2 захиалга үүсгэж e2e жолоочид хуваарилна
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 5, reason: 'PURCHASE_IN' })
        .expect(201);
      for (const which of ['A', 'B']) {
        const ord = await api()
          .post('/api/orders')
          .set(auth(tok.seller))
          .send({
            customerName: `Э2Э-Маршрут-${which}-${T}`,
            customerPhone: `6${T}`,
            ...UB_ADDR,
            items: [{ productId, qty: 1 }],
          })
          .expect(201);
        if (which === 'A') roA = ord.body.id;
        else roB = ord.body.id;
        await api()
          .patch(`/api/orders/${ord.body.id}/status`)
          .set(auth(tok.seller))
          .send({ status: 'CONFIRMED' })
          .expect(200);
        await api()
          .patch(`/api/orders/${ord.body.id}/assign-driver`)
          .set(auth(tok.manager))
          .send({ driverId: e2eDriverId })
          .expect(200);
      }

      const res = await api()
        .get('/api/delivery-ops/board')
        .set(auth(tok.manager))
        .expect(200);
      const assignedIds = res.body.board.ASSIGNED.map(
        (o: { id: string }) => o.id,
      );
      expect(assignedIds).toEqual(expect.arrayContaining([roA, roB]));
      const rowA = res.body.board.ASSIGNED.find(
        (o: { id: string }) => o.id === roA,
      );
      expect(rowA.shortAddress).toBe('ХУД, 11-р хороо');
      expect(rowA.assignedDriver.id).toBe(e2eDriverId);

      const drv = res.body.drivers.find(
        (d: { id: string }) => d.id === e2eDriverId,
      );
      expect(drv.active).toBe(2);
      expect(drv).toHaveProperty('deliveredToday');
    });

    it('route-order: дараалал тавьж my/deliveries эрэмбэлэгдэнэ + mapUrl', async () => {
      // B-г эхэнд тавина
      await api()
        .patch('/api/deliveries/route-order')
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId, orderIds: [roB, roA] })
        .expect(200);

      const res = await api()
        .get('/api/deliveries/my')
        .set(auth(e2eDriverToken))
        .expect(200);
      expect(res.body[0].id).toBe(roB);
      expect(res.body[0].routeOrder).toBe(1);
      expect(res.body[1].id).toBe(roA);
      expect(res.body[1].routeOrder).toBe(2);
      expect(res.body[0].mapUrl).toBe(
        'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(res.body[0].fullAddress),
      );
    });

    it('идэвхтэй биш захиалга оруулбал → 400; цэвэрлэгээ', async () => {
      await api()
        .patch('/api/deliveries/route-order')
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId, orderIds: [roB, orderId] })
        .expect(400);
      // operator drivers.assign байхгүй → 403
      await api()
        .patch('/api/deliveries/route-order')
        .set(auth(tok.operator))
        .send({ driverId: e2eDriverId, orderIds: [roB] })
        .expect(403);
      // цуцалж үлдэгдэл буцаана
      for (const id of [roA, roB]) {
        await api()
          .patch(`/api/orders/${id}/status`)
          .set(auth(tok.manager))
          .send({ status: 'CANCELLED' })
          .expect(200);
      }
    });
  });

  // ────────────────────────────────────────────── SETTINGS + ANALYTICS + REPORTS (V3)
  describe('V3: Settings + Analytics + Reports ⭐', () => {
    it('settings: public унших, edit эрхтэйд л, буруу утга 400', async () => {
      const pub = await api()
        .get('/api/settings')
        .set(auth(tok.operator))
        .expect(200);
      expect(pub.body).toHaveProperty('companyName');

      await api()
        .put('/api/settings')
        .set(auth(tok.manager))
        .send({ companyName: 'X' })
        .expect(403);

      const upd = await api()
        .put('/api/settings')
        .set(auth(tok.admin))
        .send({ companyName: 'Э2Э Компани', companyPhone: '70001111' })
        .expect(200);
      expect(upd.body.companyName).toBe('Э2Э Компани');

      const pub2 = await api()
        .get('/api/settings')
        .set(auth(tok.driver))
        .expect(200);
      expect(pub2.body.companyName).toBe('Э2Э Компани');

      await api()
        .put('/api/settings')
        .set(auth(tok.admin))
        .send({ huurmagKey: 'x' })
        .expect(400);
    });

    /**
     * DM-ийн хариу, банкны данс, хугацааны анхааруулга (V5).
     * Frontend эдгээр түлхүүрүүд байхыг НАЙДДАГ — устгавал мессеж
     * үүсэхгүй болно. Тиймээс гэрээг тестээр барина.
     */
    it('settings: V5-ийн шинэ түлхүүрүүд байх ба хадгалагдана', async () => {
      const pub = await api()
        .get('/api/settings')
        .set(auth(tok.seller))
        .expect(200);
      for (const k of [
        'dmTemplate',
        'bankName',
        'bankAccount',
        'bankHolder',
        'expiryWarnDays',
      ]) {
        expect(pub.body).toHaveProperty(k);
      }
      // Анхны загварт орлуулгууд байх ёстой — эс тэгвэл мессеж хоосон
      for (const token of ['{нэр}', '{дугаар}', '{бараа}', '{нийт}', '{данс}']) {
        expect(pub.body.dmTemplate).toContain(token);
      }
      expect(pub.body.expiryWarnDays).toBe('30');
      /** Тестийн дараа ЯГ буцаах анхны загвар (кодод давхардуулахгүй) */
      const originalTemplate: string = pub.body.dmTemplate;

      const upd = await api()
        .put('/api/settings')
        .set(auth(tok.admin))
        .send({
          dmTemplate: 'Сайн уу {нэр}, {дугаар} бэлэн.',
          bankName: 'Э2Э банк',
          bankAccount: '5000000001',
          bankHolder: 'Э2Э ХХК',
          expiryWarnDays: '45',
        })
        .expect(200);
      expect(upd.body.dmTemplate).toContain('{нэр}');
      expect(upd.body.bankAccount).toBe('5000000001');
      expect(upd.body.expiryWarnDays).toBe('45');

      // Хугацааны хураангуй тохиргоог дагана
      const sum = await api()
        .get('/api/batches/summary')
        .set(auth(tok.admin))
        .expect(200);
      expect(sum.body.warnDays).toBe(45);

      // Анхны утгуудад нь бүрэн буцаана — эс тэгвэл dev DB-д тестийн
      // загвар үлдэж, бодит үйлчлүүлэгч рүү эвдэрсэн мессеж явна
      const back = await api()
        .put('/api/settings')
        .set(auth(tok.admin))
        .send({
          dmTemplate: originalTemplate,
          bankName: '',
          bankAccount: '',
          bankHolder: '',
          expiryWarnDays: '30',
        })
        .expect(200);
      expect(back.body.dmTemplate).toBe(originalTemplate);
    });

    it('analytics: manager нэвтэрнэ, operator 403, тоонууд зөв', async () => {
      await api()
        .get('/api/analytics/sales')
        .set(auth(tok.operator))
        .expect(403);

      const sales = await api()
        .get('/api/analytics/sales?groupBy=day')
        .set(auth(tok.manager))
        .expect(200);
      expect(sales.body.totals.count).toBeGreaterThanOrEqual(1);
      expect(sales.body.rows.length).toBeGreaterThanOrEqual(1);
      const week = await api()
        .get('/api/analytics/sales?groupBy=week')
        .set(auth(tok.manager))
        .expect(200);
      expect(week.body.groupBy).toBe('week');

      const top = await api()
        .get('/api/analytics/top-products?limit=50')
        .set(auth(tok.manager))
        .expect(200);
      const mine = top.body.find(
        (p: { productId: string }) => p.productId === productId,
      );
      expect(mine.qty).toBeGreaterThanOrEqual(1);

      const drivers = await api()
        .get('/api/analytics/drivers')
        .set(auth(tok.manager))
        .expect(200);
      const d = drivers.body.find(
        (x: { id: string }) => x.id === e2eDriverId,
      );
      expect(d.delivered).toBeGreaterThanOrEqual(1);
      expect(Number(d.earnings)).toBe(d.delivered * 1800);

      const cust = await api()
        .get('/api/analytics/customers')
        .set(auth(tok.manager))
        .expect(200);
      expect(cust.body.topCustomers.length).toBeGreaterThanOrEqual(1);
      expect(
        cust.body.newCustomers + cust.body.repeatCustomers,
      ).toBeGreaterThanOrEqual(1);
    });

    it('reports: BOM-той CSV, монгол багана, permission ялгаа', async () => {
      const res = await api()
        .get('/api/reports/delivery.csv')
        .set(auth(tok.manager))
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
      expect(res.text).toContain('Захиалгын дугаар');
      expect(res.text).toContain('ХУД, 11-р хороо');

      await api()
        .get('/api/reports/inventory.csv')
        .set(auth(tok.manager))
        .expect(200);

      // manager-т reports.finance байхгүй
      await api()
        .get('/api/reports/finance.csv')
        .set(auth(tok.manager))
        .expect(403);
      const fin = await api()
        .get('/api/reports/finance.csv')
        .set(auth(tok.admin))
        .expect(200);
      expect(fin.text).toContain('Ангилал');

      await api()
        .get('/api/reports/delivery.csv')
        .set(auth(tok.operator))
        .expect(403);
    });

    /**
     * `to=YYYY-MM-DD` нь `new Date()`-ээр UTC шөнө дунд болж хөрвөдөг тул
     * тухайн өдрийн бичлэгүүд БҮГД мужаас хасагддаг байсан
     * (`from` нь мөн орон нутгийн өглөөний цагуудыг алддаг).
     */
    it('from/to зөвхөн огноотой үед тухайн ӨДӨР бүхэлдээ багтана', async () => {
      const today = new Date();
      const ymd = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('-');

      const csv = await api()
        .get(`/api/reports/delivery.csv?from=${ymd}&to=${ymd}`)
        .set(auth(tok.manager))
        .expect(200);
      // Өнөөдөр үүсгэсэн тестийн захиалгууд мужид байх ёстой
      expect(csv.text).toContain('ХУД, 11-р хороо');

      const sales = await api()
        .get(`/api/analytics/sales?from=${ymd}&to=${ymd}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(sales.body.totals.count).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────── ӨРТӨГ + АШИГ (V4)
  describe('V4: Өртөг + ашиг ⭐', () => {
    it('costPrice: manager засна, operator-т API хариунаас нуугдана', async () => {
      const upd = await api()
        .patch(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .send({ costPrice: '1200.00' })
        .expect(200);
      expect(upd.body.costPrice).toBe('1200');

      const asManager = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(asManager.body.costPrice).toBe('1200');

      // operator (inventory.view л эрхтэй) — өртөг нуугдана
      const asOperator = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.seller))
        .expect(200);
      expect(asOperator.body).not.toHaveProperty('costPrice');
      const list = await api()
        .get(`/api/products?search=${T}&limit=50`)
        .set(auth(tok.seller))
        .expect(200);
      for (const p of list.body.items) {
        expect(p).not.toHaveProperty('costPrice');
      }
    });

    it('PURCHASE_IN + unitCost → costPrice "сүүлийн өртөг"-өөр шинэчлэгдэнэ', async () => {
      const res = await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({
          productId,
          qtyChange: 1,
          reason: 'PURCHASE_IN',
          unitCost: '1300.00',
        })
        .expect(201);
      expect(res.body.product.costPrice).toBe('1300');
    });

    it('захиалгад costAtOrder snapshot — дараа өртөг өөрчлөгдөхөд хөндөгдөхгүй', async () => {
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Өртөг-${T}`,
          customerPhone: `4${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      costOrderId = ord.body.id;
      expect(ord.body.items[0].costAtOrder).toBe('1300');

      // Өртгийг өөрчилье — хуучин захиалгын snapshot хэвээр
      await api()
        .patch(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .send({ costPrice: '999.00' })
        .expect(200);
      const detail = await api()
        .get(`/api/orders/${costOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(detail.body.items[0].costAtOrder).toBe('1300');
    });

    it('analytics: profit = amount − cost; top-products ашигтай', async () => {
      const sales = await api()
        .get('/api/analytics/sales?groupBy=day')
        .set(auth(tok.manager))
        .expect(200);
      expect(Number(sales.body.totals.profit)).toBeCloseTo(
        Number(sales.body.totals.amount) - Number(sales.body.totals.cost),
        2,
      );
      expect(Number(sales.body.totals.cost)).toBeGreaterThan(0);

      const top = await api()
        .get('/api/analytics/top-products?limit=50')
        .set(auth(tok.manager))
        .expect(200);
      const mine = top.body.find(
        (p: { productId: string }) => p.productId === productId,
      );
      expect(Number(mine.cost)).toBeGreaterThan(0);
      expect(Number(mine.profit)).toBeCloseTo(
        Number(mine.amount) - Number(mine.cost),
        2,
      );

      // Admin dashboard-д Нийт ашиг
      const dash = await api()
        .get('/api/dashboard/admin')
        .set(auth(tok.admin))
        .expect(200);
      expect(dash.body).toHaveProperty('totalProfit');
    });
  });

  // ────────────────────────────────────────────── V4: БУЦААЛТ
  describe('V4: Буцаалтын урсгал ⭐', () => {
    let unitPrice: number; // мөрийн нэгж үнэ (refund тооцоонд)

    it('бэлтгэл: DELIVERED + бүрэн төлсөн 2ш-тэй захиалга', async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 2, reason: 'PURCHASE_IN' })
        .expect(201);
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Буцаалт-${T}`,
          customerPhone: `6${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 2 }],
        })
        .expect(201);
      retOrderId = ord.body.id;
      retItemId = ord.body.items[0].id;
      unitPrice = Number(ord.body.items[0].priceAtOrder);

      await api()
        .patch(`/api/orders/${retOrderId}/status`)
        .set(auth(tok.seller))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      const realDriver = await api().get('/api/auth/me').set(auth(tok.driver));
      await api()
        .patch(`/api/orders/${retOrderId}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: realDriver.body.id })
        .expect(200);
      await api()
        .post(`/api/deliveries/${retOrderId}/complete`)
        .set(auth(tok.driver))
        .field('success', 'true')
        .field('note', 'e2e буцаалтын бэлтгэл')
        .expect(201);

      const pay = await api()
        .post(`/api/orders/${retOrderId}/payments`)
        .set(auth(tok.manager))
        .send({ amount: ord.body.totalAmount, method: 'TRANSFER' })
        .expect(201);
      expect(pay.body.order.paymentStatus).toBe('PAID');
    });

    it('operator буцаалт бүртгэхгүй (403); дуусаагүй захиалгад 400', async () => {
      const body = {
        items: [{ orderItemId: retItemId, qty: 1 }],
        reason: 'e2e-403',
      };
      await api()
        .post(`/api/orders/${retOrderId}/return`)
        .set(auth(tok.operator))
        .send(body)
        .expect(403);
      // adminOrderId — CANCELLED (хүргэгдээгүй) тул буцаалт хориглоно
      await api()
        .post(`/api/orders/${adminOrderId}/return`)
        .set(auth(tok.manager))
        .send(body)
        .expect(400);
    });

    it('1ш буцаалт: үлдэгдэл+1, RETURN хөдөлгөөн, EXPENSE REFUND, PARTIAL, payroll-оос хасагдана ⭐', async () => {
      const before = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      const realDriver = await api().get('/api/auth/me').set(auth(tok.driver));
      const pendBefore = await api()
        .get('/api/finance/payroll/pending')
        .set(auth(tok.admin))
        .expect(200);
      const rowBefore = pendBefore.body.find(
        (r: { driverId: string }) => r.driverId === realDriver.body.id,
      );
      expect(rowBefore.deliveredCount).toBeGreaterThanOrEqual(1);

      const res = await api()
        .post(`/api/orders/${retOrderId}/return`)
        .set(auth(tok.manager))
        .send({
          items: [{ orderItemId: retItemId, qty: 1 }],
          reason: 'Гэмтэлтэй ирсэн',
          restock: true,
          refundPayment: true,
          excludeFromPayroll: true,
        })
        .expect(201);
      expect(Number(res.body.refundAmount)).toBe(unitPrice);
      expect(res.body.order.returnState).toBe('PARTIAL');
      expect(res.body.order.paymentStatus).toBe('PARTIAL');
      expect(Number(res.body.order.paidAmount)).toBe(unitPrice); // 2ш − 1ш

      // Үлдэгдэл +1, RETURN шалтгаантай хөдөлгөөн
      const after = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(after.body.stockQty).toBe(before.body.stockQty + 1);
      const move = await prisma.stockMovement.findFirst({
        where: { refId: retOrderId, reason: 'RETURN' },
      });
      expect(move?.qtyChange).toBe(1);

      // EXPENSE "REFUND" entry
      const refundEntry = await prisma.financeEntry.findFirst({
        where: { refOrderId: retOrderId, category: 'REFUND' },
      });
      expect(refundEntry?.type).toBe('EXPENSE');
      expect(Number(refundEntry?.amount)).toBe(unitPrice);

      // Payroll pending-ээс хасагдсан (тоо 1-ээр буурна)
      const pendAfter = await api()
        .get('/api/finance/payroll/pending')
        .set(auth(tok.admin))
        .expect(200);
      const rowAfter = pendAfter.body.find(
        (r: { driverId: string }) => r.driverId === realDriver.body.id,
      );
      const countAfter = rowAfter?.deliveredCount ?? 0;
      expect(countAfter).toBe(rowBefore.deliveredCount - 1);
    });

    it('давхар буцаалт: үлдсэнээс их → 400; үлдсэн 1ш → FULL + төлбөр бүрэн буцна', async () => {
      await api()
        .post(`/api/orders/${retOrderId}/return`)
        .set(auth(tok.manager))
        .send({
          items: [{ orderItemId: retItemId, qty: 2 }],
          reason: 'e2e-хэтрүүлэг',
        })
        .expect(400);

      const res = await api()
        .post(`/api/orders/${retOrderId}/return`)
        .set(auth(tok.manager))
        .send({
          items: [{ orderItemId: retItemId, qty: 1 }],
          reason: 'Бүрэн буцаалт',
          restock: true,
          refundPayment: true,
        })
        .expect(201);
      expect(res.body.order.returnState).toBe('FULL');
      expect(res.body.order.paymentStatus).toBe('UNPAID');
      expect(Number(res.body.order.paidAmount)).toBe(0);

      // Бүх мөр буцаагдсан — цаашид буцаалт авахгүй
      await api()
        .post(`/api/orders/${retOrderId}/return`)
        .set(auth(tok.manager))
        .send({
          items: [{ orderItemId: retItemId, qty: 1 }],
          reason: 'e2e-дахин',
        })
        .expect(400);

      // Дэлгэрэнгүйд буцаалтын түүх (2 бичлэг) ирнэ
      const detail = await api()
        .get(`/api/orders/${retOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(detail.body.returns).toHaveLength(2);
      expect(detail.body.returnState).toBe('FULL');
    });

    /**
     * Буцаалт `totalAmount`-ыг хөнддөггүй тул бүрэн буцаалт + мөнгө
     * буцаалт хийхэд paidAmount 0 / UNPAID болж, бараа нь бүрэн буцаж
     * ирсэн атлаа авлагын жагсаалтад «өр» болж гардаг байсан.
     */
    it('бүрэн буцаагдсан захиалга АВЛАГА-д гарахгүй', async () => {
      const detail = await api()
        .get(`/api/orders/${retOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      // Урьдчилсан нөхцөл: UNPAID + DELIVERED/COMPLETED + FULL
      expect(detail.body.paymentStatus).toBe('UNPAID');
      expect(detail.body.returnState).toBe('FULL');

      const rec = await api()
        .get('/api/finance/receivables')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        rec.body.items.some((r: { id: string }) => r.id === retOrderId),
      ).toBe(false);
    });
  });

  // ────────────────────────────────────────────── V4: ХҮРГЭЛТИЙН ТАРИФ

  // ────────────────────────────────────────────── V4: НУУЦ ҮГ СЭРГЭЭХ
  describe('V4: Нууц үг сэргээх ⭐', () => {
    const pwEmail = `e2e-pw-${T}@ursgal.mn`;
    let pwUserId: string;
    let pwToken: string;
    let tempPassword: string;

    afterAll(async () => {
      if (pwUserId) {
        await prisma.user.deleteMany({ where: { id: pwUserId } });
      }
    });

    it('operator reset 403; admin → 8 тэмдэгт түр нууц үг, лог-д нууц үг ОРОХГҮЙ', async () => {
      const created = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          name: 'Э2Э Нууцүг Тест',
          email: pwEmail,
          password: 'firstpass1',
          role: 'SELLER',
        })
        .expect(201);
      pwUserId = created.body.id;

      await api()
        .post(`/api/users/${pwUserId}/reset-password`)
        .set(auth(tok.operator))
        .expect(403);

      const res = await api()
        .post(`/api/users/${pwUserId}/reset-password`)
        .set(auth(tok.admin))
        .expect(201);
      tempPassword = res.body.tempPassword;
      expect(tempPassword).toHaveLength(8);

      // Хуучин нууц үг шууд хүчингүй
      await api()
        .post('/api/auth/login')
        .send({ email: pwEmail, password: 'firstpass1' })
        .expect(401);

      // ActivityLog-д үйлдэл бичигдсэн, түр нууц үг лог-д БАЙХГҮЙ
      const log = await prisma.activityLog.findFirst({
        where: { entityId: pwUserId, action: { contains: 'reset-password' } },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).toBeTruthy();
      expect(JSON.stringify(log)).not.toContain(tempPassword);
    });

    it('түр нууц үгээр нэвтрэхэд mustChangePassword — бусад API 403, me нээлттэй', async () => {
      const login = await api()
        .post('/api/auth/login')
        .send({ email: pwEmail, password: tempPassword })
        .expect(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      pwToken = login.body.accessToken;

      await api().get('/api/products').set(auth(pwToken)).expect(403);
      await api().get('/api/orders').set(auth(pwToken)).expect(403);
      await api().get('/api/auth/me').set(auth(pwToken)).expect(200);
    });

    it('солиход нээгдэнэ: буруу хуучин 400; түр нууц үг 401 болно', async () => {
      await api()
        .post('/api/auth/change-password')
        .set(auth(pwToken))
        .send({ oldPassword: 'wrong-wrong', newPassword: 'newpass22' })
        .expect(400);

      const res = await api()
        .post('/api/auth/change-password')
        .set(auth(pwToken))
        .send({ oldPassword: tempPassword, newPassword: 'newpass22' })
        .expect(200);
      expect(res.body.user.mustChangePassword).toBe(false);

      // Шинэ token-оор хэвийн ажиллана (operator default: inventory.view)
      await api()
        .get('/api/products')
        .set(auth(res.body.accessToken))
        .expect(200);

      // Түр нууц үг ажиллахгүй, шинэ нууц үгээр хэвийн нэвтэрнэ
      await api()
        .post('/api/auth/login')
        .send({ email: pwEmail, password: tempPassword })
        .expect(401);
      const relog = await api()
        .post('/api/auth/login')
        .send({ email: pwEmail, password: 'newpass22' })
        .expect(200);
      expect(relog.body.user.mustChangePassword).toBe(false);
    });
  });

  // ────────────────────────────────────────────── V4: НЭВТРЭЛТИЙН ТҮГЖЭЭ
  describe('V4: Нэвтрэлтийн хамгаалалт ⭐', () => {
    const lockEmail = `e2e-lock-${T}@ursgal.mn`;
    let lockUserId: string;

    afterAll(async () => {
      if (lockUserId) {
        await prisma.user.deleteMany({ where: { id: lockUserId } });
      }
    });

    it('5 буруу оролдлогод 423 — зөв нууц үг ч нэвтрэхгүй', async () => {
      const created = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          name: 'Э2Э Түгжээ Тест',
          email: lockEmail,
          password: 'lockpass1',
          role: 'OPERATOR',
        })
        .expect(201);
      lockUserId = created.body.id;

      // 4 буруу → 401, 5 дахь нь түгжинэ (423)
      for (let i = 0; i < 4; i++) {
        await api()
          .post('/api/auth/login')
          .send({ email: lockEmail, password: 'wrong-pass' })
          .expect(401);
      }
      const locked = await api()
        .post('/api/auth/login')
        .send({ email: lockEmail, password: 'wrong-pass' })
        .expect(423);
      expect(locked.body.message).toContain('түгжигдлээ');

      // Түгжээтэй үед ЗӨВ нууц үг ч 423
      await api()
        .post('/api/auth/login')
        .send({ email: lockEmail, password: 'lockpass1' })
        .expect(423);

      // Жагсаалтад lockedUntil ирнэ (users.manage)
      const list = await api()
        .get('/api/users?role=OPERATOR')
        .set(auth(tok.admin))
        .expect(200);
      const row = list.body.find((u: { id: string }) => u.id === lockUserId);
      expect(row.lockedUntil).toBeTruthy();
    });

    it('админ түгжээ тайлбал нэвтэрч, lastLoginAt тавигдана; operator unlock 403', async () => {
      await api()
        .patch(`/api/users/${lockUserId}/unlock`)
        .set(auth(tok.operator))
        .expect(403);

      const res = await api()
        .patch(`/api/users/${lockUserId}/unlock`)
        .set(auth(tok.admin))
        .expect(200);
      expect(res.body.lockedUntil).toBeNull();

      const login = await api()
        .post('/api/auth/login')
        .send({ email: lockEmail, password: 'lockpass1' })
        .expect(200);
      expect(login.body.user.lastLoginAt).toBeTruthy();

      const dbUser = await prisma.user.findUnique({
        where: { id: lockUserId },
      });
      expect(dbUser?.failedLoginCount).toBe(0);
      expect(dbUser?.lastLoginAt).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────── V4: REFRESH ROTATION
  describe('V4: Refresh rotation + logout ⭐', () => {
    const rtEmail = `e2e-rt-${T}@ursgal.mn`;
    let rtUserId: string;

    afterAll(async () => {
      if (rtUserId) {
        await prisma.user.deleteMany({ where: { id: rtUserId } });
      }
    });

    const rtLogin = () =>
      api()
        .post('/api/auth/login')
        .send({ email: rtEmail, password: 'rtpass11' })
        .expect(200);
    const rtRefresh = (token: string) =>
      api().post('/api/auth/refresh').send({ refreshToken: token });

    it('rotation: хуучин token хүчингүй, дахин хэрэглэвэл гэр бүлээрээ унтарна', async () => {
      const created = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          name: 'Э2Э Rotation Тест',
          email: rtEmail,
          password: 'rtpass11',
          role: 'OPERATOR',
        })
        .expect(201);
      rtUserId = created.body.id;

      const login = await rtLogin();
      const rt1 = login.body.refreshToken;

      const rotated = await rtRefresh(rt1).expect(200);
      const rt2 = rotated.body.refreshToken;
      expect(rt2).not.toBe(rt1);

      // rt1 ДАХИН ирвэл — хулгайн шинж: 401 + rt2 ч унтарна
      await rtRefresh(rt1).expect(401);
      await rtRefresh(rt2).expect(401);
    });

    it('logout: refresh token revoke хийгдэж дахин ажиллахгүй', async () => {
      const login = await rtLogin();
      const rt = login.body.refreshToken;

      await api()
        .post('/api/auth/logout')
        .set(auth(login.body.accessToken))
        .send({ refreshToken: rt })
        .expect(200);
      await rtRefresh(rt).expect(401);
    });

    it('идэвхгүй болгосон хэрэглэгчийн session шууд тасарна', async () => {
      const login = await rtLogin();

      await api()
        .patch(`/api/users/${rtUserId}`)
        .set(auth(tok.admin))
        .send({ isActive: false })
        .expect(200);

      // Access token ч (DB-ээс шалгадаг) ажиллахгүй, refresh ч 401
      await api()
        .get('/api/auth/me')
        .set(auth(login.body.accessToken))
        .expect(401);
      await rtRefresh(login.body.refreshToken).expect(401);
    });
  });

  // ────────────────────────────────────────────── V4: SSE МЭДЭГДЭЛ
  describe('V4: SSE real-time мэдэгдэл ⭐', () => {
    it('stream нээгдэж, notify() дуудагдмагц unreadCount push ирнэ', async () => {
      // Supertest сервер сонсдоггүй тул raw http-ээр өөрсдөө нээнэ
      await new Promise<void>((res) => http.listen(0, res));
      const port = (http.address() as AddressInfo).port;

      const me = await api().get('/api/auth/me').set(auth(tok.driver));
      const driverId: string = me.body.id;

      let resolveOpen!: () => void;
      const opened = new Promise<void>((r) => (resolveOpen = r));
      let resolveData!: (chunk: string) => void;
      let rejectData!: (e: Error) => void;
      const pushed = new Promise<string>((r, j) => {
        resolveData = r;
        rejectData = j;
      });

      const req = httpGet(
        `http://127.0.0.1:${port}/api/notifications/stream?token=${encodeURIComponent(tok.driver)}`,
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/event-stream');
          resolveOpen();
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (chunk.includes('unreadCount')) resolveData(chunk);
          });
        },
      );
      req.on('error', () => undefined); // destroy() үед гарна
      const timer = setTimeout(
        () => rejectData(new Error('SSE push 5с дотор ирсэнгүй')),
        5000,
      );

      // Холболт нээгдсэний ДАРАА мэдэгдэл үүсгэнэ
      await opened;
      const notifications = app.get(NotificationsService);
      await notifications.notify([driverId], {
        type: 'DELIVERY_ASSIGNED',
        title: `Э2Э SSE тест ${T}`,
      });

      const chunk = await pushed;
      clearTimeout(timer);
      req.destroy();
      expect(chunk).toContain('"type":"notification"');

      // Буруу token → stream нээгдэлгүй алдаа буцна
      await new Promise<void>((resolve) => {
        const bad = httpGet(
          `http://127.0.0.1:${port}/api/notifications/stream?token=bad-token`,
          (res) => {
            expect(res.statusCode).toBeGreaterThanOrEqual(400);
            bad.destroy();
            resolve();
          },
        );
        bad.on('error', () => resolve());
      });

      // Цэвэрлэгээ: тестийн мэдэгдэл + сонссон портыг хаана
      await prisma.notification.deleteMany({
        where: { title: `Э2Э SSE тест ${T}` },
      });
      await new Promise<void>((res) => http.close(() => res()));
    });
  });

  // ────────────────────────────────────────────── V4: CSV ИМПОРТ + BARCODE
  describe('V4: CSV импорт + barcode ⭐', () => {
    const impSku1 = `E2EIMP1-${T}`;
    const impSku2 = `E2EIMP2-${T}`;
    const impBarcode = `869${T}0001`;
    const impCat = `Э2Э-Импорт-${T}`;

    afterAll(async () => {
      const prods = await prisma.product.findMany({
        where: { sku: { in: [impSku1, impSku2] } },
        select: { id: true },
      });
      const ids = prods.map((p) => p.id);
      await prisma.stockMovement.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
      await prisma.category.deleteMany({ where: { name: impCat } });
    });

    it('загвар CSV: adjustment эрхтэйд татагдана, operator 403', async () => {
      await api()
        .get('/api/products/import-template.csv')
        .set(auth(tok.operator))
        .expect(403);
      const res = await api()
        .get('/api/products/import-template.csv')
        .set(auth(tok.manager))
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('SKU');
    });

    it('5 мөр: 2 шинэ + 2 шинэчлэл + 1 алдаа — тайлан зөв, INITIAL орсон ⭐', async () => {
      const csv = [
        'SKU,Нэр,Ангилал,Үнэ,Өртөг,Barcode,Доод хязгаар,Эхний үлдэгдэл',
        `${impSku1},Импорт бараа 1,${impCat},4500,3000,${impBarcode},3,12`,
        `${impSku2},Импорт бараа 2,,2500,,,5,`,
        `${SKU},,,1500,,,,`,
        `${impSku1},Импорт бараа 1 v2,,4800,,,,`,
        `BADROW-${T},Буруу мөр,,abc,,,,`,
      ].join('\n');

      const res = await api()
        .post('/api/products/import')
        .set(auth(tok.manager))
        .attach('file', Buffer.from('﻿' + csv, 'utf8'), {
          filename: 'imp.csv',
          contentType: 'text/csv',
        })
        .expect(201);
      expect(res.body.created).toBe(2);
      expect(res.body.updated).toBe(2);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].row).toBe(6);
      expect(res.body.errors[0].reason).toContain('Үнэ');

      // Шинэ бараа: эхний үлдэгдэл + INITIAL movement, 2 дахь мөрөөр шинэчлэгдсэн
      const p1 = await prisma.product.findUnique({ where: { sku: impSku1 } });
      expect(p1?.stockQty).toBe(12);
      expect(Number(p1?.price)).toBe(4800);
      expect(p1?.name).toBe('Импорт бараа 1 v2');
      expect(p1?.barcode).toBe(impBarcode);
      const mv = await prisma.stockMovement.findFirst({
        where: { productId: p1!.id, reason: 'INITIAL' },
      });
      expect(mv?.qtyChange).toBe(12);

      // Ангилал нэрээр үүссэн; суурь барааны үнэ шинэчлэгдсэн
      const cat = await prisma.category.findUnique({
        where: { name: impCat },
      });
      expect(cat).toBeTruthy();
      const base = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(Number(base.body.price)).toBe(1500);
    });

    it('barcode бүрэн таарвал шууд олдоно (staff хайлт)', async () => {
      const res = await api()
        .get(`/api/products?search=${impBarcode}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].sku).toBe(impSku1);
    });
  });

  // ────────────────────────────────────────────── V4: АЛДААНЫ ЛОГ
  describe('V4: Алдааны төвлөрсөн лог ⭐', () => {
    afterAll(async () => {
      // Тестийн "Тест алдаа" мөрүүдийг өнөөдрийн лог файлаас арилгана
      const d = new Date();
      const today = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);
      const file = join(process.cwd(), 'logs', `error-${today}.log`);
      try {
        const text = readFileSync(file, 'utf8');
        const kept = text
          .split('\n')
          .filter((l) => l.trim() && !l.includes('Тест алдаа'))
          .join('\n');
        if (kept) writeFileSync(file, kept + '\n');
        else unlinkSync(file);
      } catch {
        /* файл байхгүй бол зүгээр */
      }
    });

    it('зориуд 500 → файлд бичигдэж admin API-гаас харагдана; 400/403 бичигдэхгүй ⭐', async () => {
      const before = await api()
        .get('/api/admin/errors')
        .set(auth(tok.admin))
        .expect(200);

      // Зориуд 500
      await api()
        .post('/api/admin/errors/test')
        .set(auth(tok.admin))
        .expect(500);

      // Энгийн 400 + 403 — лог руу ОРОХГҮЙ
      await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({ region: 'ULAANBAATAR' })
        .expect(400);
      await api().get('/api/users').set(auth(tok.operator)).expect(403);

      const after = await api()
        .get('/api/admin/errors')
        .set(auth(tok.admin))
        .expect(200);
      expect(after.body.count).toBe(before.body.count + 1);
      const entry = after.body.items[0];
      expect(entry.message).toContain('Тест алдаа');
      expect(entry.path).toContain('/api/admin/errors/test');
      expect(entry.method).toBe('POST');
      expect(entry.stack).toBeTruthy();
      expect(entry.userId).toBeTruthy();
    });

    it('operator алдааны лог харахгүй (403); буруу огноо 400', async () => {
      await api()
        .get('/api/admin/errors')
        .set(auth(tok.operator))
        .expect(403);
      await api()
        .get('/api/admin/errors?date=27-08-2026')
        .set(auth(tok.admin))
        .expect(400);
    });
  });

  // ────────────────────────────────────────────── V5: СУВАГ
  describe('V5: Захиалгын суваг ⭐', () => {
    it('суваг хадгалагдаж, шүүлт ба аналитикт тусна; орхивол OTHER', async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 2, reason: 'PURCHASE_IN' })
        .expect(201);

      const ig = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-IG-${T}`,
          customerPhone: `3${T}`,
          ...UB_ADDR,
          channel: 'INSTAGRAM',
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      feeOrderIds.push(ig.body.id);
      expect(ig.body.channel).toBe('INSTAGRAM');

      // Суваг заагаагүй бол OTHER
      const other = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Суваггүй-${T}`,
          customerPhone: `3${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      feeOrderIds.push(other.body.id);
      expect(other.body.channel).toBe('OTHER');

      // Шүүлт: зөвхөн INSTAGRAM
      const list = await api()
        .get('/api/orders?channel=INSTAGRAM&limit=100')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        list.body.items.every(
          (o: { channel: string }) => o.channel === 'INSTAGRAM',
        ),
      ).toBe(true);
      expect(
        list.body.items.some((o: { id: string }) => o.id === ig.body.id),
      ).toBe(true);

      // Буруу суваг → 400
      await api()
        .get('/api/orders?channel=TIKTOK')
        .set(auth(tok.manager))
        .expect(400);

      // Аналитик: суваг тус бүрийн задаргаа, хувь нийлбэр 100 орчим
      const ch = await api()
        .get('/api/analytics/channels')
        .set(auth(tok.manager))
        .expect(200);
      const insta = ch.body.find(
        (c: { channel: string }) => c.channel === 'INSTAGRAM',
      );
      expect(insta.orders).toBeGreaterThanOrEqual(1);
      expect(Number(insta.amount)).toBeGreaterThan(0);
      expect(
        ch.body.reduce((a: number, c: { share: number }) => a + c.share, 0),
      ).toBeGreaterThanOrEqual(98);
    });
  });

  // ────────────────────────────────────────────── V5: НИЙТИЙН ЗАХИАЛГЫН ЛИНК
  describe('V5: Нийтийн захиалгын хүсэлт ⭐', () => {
    let publicToken: string;
    let requestId: string;
    let convertedOrderId: string;

    afterAll(async () => {
      if (requestId) {
        await prisma.orderRequestItem.deleteMany({ where: { requestId } });
        await prisma.orderRequest.deleteMany({ where: { id: requestId } });
      }
    });

    it('линк: ажилтанд нууц өгөгдөнө, буруу token → 404', async () => {
      const res = await api()
        .get('/api/order-requests/link')
        .set(auth(tok.manager))
        .expect(200);
      publicToken = res.body.token;
      expect(publicToken).toBeTruthy();

      await api().get('/api/public/order-form?token=buruu').expect(404);
    });

    it('маягт: нэвтрэлтгүй нээгдэнэ, ҮЛДЭГДЭЛ/SKU/ӨРТӨГ гадагш гарахгүй', async () => {
      const res = await api()
        .get(`/api/public/order-form?token=${publicToken}`)
        .expect(200);
      expect(res.body.products.length).toBeGreaterThan(0);
      const p = res.body.products[0];
      expect(p).toHaveProperty('inStock'); // зөвхөн байгаа эсэх
      expect(p).not.toHaveProperty('stockQty');
      expect(p).not.toHaveProperty('sku');
      expect(p).not.toHaveProperty('costPrice');
    });

    it('хүсэлт: үлдэгдэл ХӨДЛӨХГҮЙ, ажилтанд мэдэгдэл очно ⭐', async () => {
      const before = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);

      const res = await api()
        .post(`/api/public/order-requests?token=${publicToken}`)
        .field('customerName', `Э2Э Хүсэлт ${T}`)
        .field('phone', `2${T}`)
        .field('socialName', '@e2e_test')
        .field('channel', 'INSTAGRAM')
        .field('region', 'ULAANBAATAR')
        .field('district', 'ХУД')
        .field('khoroo', '11')
        .field('building', 'Э2Э байр')
        .attach('proof', PNG, { filename: 'proof.png', contentType: 'image/png' })
        .field('items', JSON.stringify([{ productId, qty: 1 }]))
        .expect(201);
      requestId = res.body.id;
      requestIds.push(requestId);

      // ⭐ Хамгийн чухал: хүсэлт үлдэгдэлд хүрэхгүй
      const after = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(after.body.stockQty).toBe(before.body.stockQty);

      // Мэдэгдэл БОРЛУУЛАГЧ руу явна (V5); борлуулагч байхгүй бол
      // ADMIN/MANAGER руу УНАНА — хүсэлт хаясан газраа үлдэхгүй.
      // Хүлээн авагчдыг DB-ээс шалгана: тестийн орчинд борлуулагч
      // байгаа эсэх нь тодорхойгүй тул нэрлэсэн хэрэглэгчээр шалгахгүй.
      const notes = await prisma.notification.findMany({
        where: { type: 'ORDER_REQUEST', refId: requestId },
        select: { user: { select: { role: true, isActive: true } } },
      });
      expect(notes.length).toBeGreaterThan(0);
      const sellers = await prisma.user.count({
        where: { role: 'SELLER', isActive: true },
      });
      const expected = sellers > 0 ? ['SELLER'] : ['ADMIN', 'MANAGER'];
      for (const n of notes) {
        expect(expected).toContain(n.user.role);
        expect(n.user.isActive).toBe(true);
      }
      // Хүлээн авагч бүрд яг нэг мөр — давхардахгүй
      expect(notes.length).toBe(
        sellers > 0
          ? sellers
          : await prisma.user.count({
              where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
            }),
      );
    });

    it('захиалга болгох: үлдэгдэл ЭНД хасагдаж, суваг/төлбөр шилжинэ ⭐', async () => {
      const before = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);

      const order = await api()
        .post(`/api/order-requests/${requestId}/convert`)
        .set(auth(tok.manager))
        .send({ paymentConfirmed: true }) // ажилтан данс дээрээ харсан (V5)
        .expect(201);
      convertedOrderId = order.body.id;
      feeOrderIds.push(convertedOrderId);

      expect(order.body.channel).toBe('INSTAGRAM');
      expect(order.body.paymentStatus).toBe('PAID');
      expect(order.body.district).toBe('ХУД');
      // «Захиалга болгох» нь өөрөө баталгаажуулалт (V5)
      expect(order.body.orderStatus).toBe('CONFIRMED');

      const after = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(after.body.stockQty).toBe(before.body.stockQty - 1);

      // Давхар хөрвүүлэлт → 400
      await api()
        .post(`/api/order-requests/${requestId}/convert`)
        .set(auth(tok.manager))
        .send({ paymentConfirmed: true })
        .expect(400);
    });
  });

  // ─────────────────────────────────────── V5: ДҮҮРГЭЭР АВТОМАТ ХУВААРИЛАЛТ
  describe('V5: Бүсээр автомат хуваарилалт ⭐', () => {
    let zoneDriverId: string;
    let pickedDriverId: string; // автомат сонгосон жолооч
    let ubOrderId: string;
    let farOrderId: string;

    afterAll(async () => {
      if (zoneDriverId) {
        await prisma.driverProfile.deleteMany({
          where: { userId: zoneDriverId },
        });
        await prisma.user.deleteMany({ where: { id: zoneDriverId } });
      }
    });

    it('бүстэй жолооч үүсгэнэ — zones хадгалагдана', async () => {
      const res = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-zone-${T}@ursgal.mn`,
          name: `Э2Э Бүс ${T}`,
          password: 'e2epass123',
          role: 'DRIVER',
          feePerDelivery: '2000.00',
          zones: ['ХУД'],
        })
        .expect(201);
      zoneDriverId = res.body.id;
      expect(res.body.driverProfile.zones).toEqual(['ХУД']);

      const list = await api()
        .get('/api/drivers')
        .set(auth(tok.manager))
        .expect(200);
      const row = list.body.find((d: { id: string }) => d.id === zoneDriverId);
      expect(row.zones).toEqual(['ХУД']);
    });

    it('ХУД захиалга бүсээ хамардаг жолоочид автоматаар очно ⭐', async () => {
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.manager))
        .send({
          customerName: `Э2Э Бүс-УБ-${T}`,
          customerPhone: `7${T}`,
          ...UB_ADDR, // district: ХУД
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      ubOrderId = res.body.id;
      feeOrderIds.push(ubOrderId);
      await api()
        .patch(`/api/orders/${ubOrderId}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CONFIRMED' })
        .expect(200);

      const auto = await api()
        .patch('/api/orders/assign-driver/auto')
        .set(auth(tok.manager))
        .send({ orderIds: [ubOrderId] })
        .expect(200);

      expect(auto.body.skipped).toHaveLength(0);
      expect(auto.body.assigned).toHaveLength(1);
      expect(auto.body.assigned[0].district).toBe('ХУД');

      const order = await api()
        .get(`/api/orders/${ubOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(order.body.deliveryStatus).toBe('ASSIGNED');
      pickedDriverId = order.body.assignedDriver.id;

      // ⭐ Сонгогдсон жолооч ХУД-ыг ЗААВАЛ хамарна. Тухайн нэрээр нь
      // шалгахгүй — DB-д ХУД бүстэй өөр жолооч байвал ачааллаас нь
      // хамаараад тэр нь сонгогдож болно (энэ нь ЗӨВ ажиллагаа).
      const drivers = await api()
        .get('/api/drivers')
        .set(auth(tok.manager))
        .expect(200);
      const picked = drivers.body.find(
        (d: { id: string }) => d.id === pickedDriverId,
      );
      expect(picked.zones).toContain('ХУД');
      // Бүсгүй жолооч хэзээ ч сонгогдохгүй
      expect(pickedDriverId).not.toBe(e2eDriverId);
    });

    it('аль хэдийн жолоочтойг ХӨНДӨХГҮЙ ⭐', async () => {
      const auto = await api()
        .patch('/api/orders/assign-driver/auto')
        .set(auth(tok.manager))
        .send({ orderIds: [ubOrderId] })
        .expect(200);
      expect(auto.body.assigned).toHaveLength(0);
      expect(auto.body.skipped[0].reason).toBe('Аль хэдийн жолоочтой');

      // Жолооч нь солигдоогүй
      const order = await api()
        .get(`/api/orders/${ubOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(order.body.assignedDriver.id).toBe(pickedDriverId);
    });

    it('хэн ч хамаардаггүй дүүрэг / орон нутаг → шалтгаантай алгасна', async () => {
      // Аль дүүргийг ХЭН Ч хамраагүйг АЖИЛЛАХ ҮЕДЭЭ олно. Тухайн
      // дүүргийг нэрлээд бичвэл бодит DB-д тэр бүс хэн нэгэнд
      // оноогдмогц тест унадаг (өгөгдлөөс хараат байх ёсгүй).
      const drv = await api()
        .get('/api/drivers')
        .set(auth(tok.manager))
        .expect(200);
      const covered = new Set<string>(
        drv.body
          .filter((d: { isActive: boolean }) => d.isActive)
          .flatMap((d: { zones?: string[] }) => d.zones ?? []),
      );
      const freeDistrict = [
        'БХД',
        'БНД',
        'НД',
        'БГД',
        'СБД',
        'ЧД',
        'СХД',
        'БЗД',
        'ХУД',
      ].find((d) => !covered.has(d));

      const uncoveredIds: string[] = [];
      if (freeDistrict) {
        const res = await api()
          .post('/api/orders')
          .set(auth(tok.manager))
          .send({
            customerName: `Э2Э Бүс-${freeDistrict}-${T}`,
            customerPhone: `8${T}`,
            region: 'ULAANBAATAR',
            district: freeDistrict,
            khoroo: '2',
            building: 'Э2Э байр',
            entrance: '1',
            floor: '1',
            door: '1',
            items: [{ productId, qty: 1 }],
          })
          .expect(201);
        feeOrderIds.push(res.body.id);
        uncoveredIds.push(res.body.id);
        await api()
          .patch(`/api/orders/${res.body.id}/status`)
          .set(auth(tok.manager))
          .send({ status: 'CONFIRMED' })
          .expect(200);
      }

      // Орон нутаг — дүүрэггүй тул бүсээр хуваарилахгүй
      const far = await api()
        .post('/api/orders')
        .set(auth(tok.manager))
        .send({
          customerName: `Э2Э Бүс-ОН-${T}`,
          customerPhone: `6${T}`,
          region: 'ORON_NUTAG',
          province: 'Дархан-Уул',
          soum: 'Дархан',
          transport: 'Тээвэр ХХК',
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      farOrderId = far.body.id;
      feeOrderIds.push(farOrderId);
      await api()
        .patch(`/api/orders/${farOrderId}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CONFIRMED' })
        .expect(200);

      const auto = await api()
        .patch('/api/orders/assign-driver/auto')
        .set(auth(tok.manager))
        .send({ orderIds: [...uncoveredIds, farOrderId] })
        .expect(200);
      expect(auto.body.assigned).toHaveLength(0);
      expect(auto.body.skipped).toHaveLength(1 + uncoveredIds.length);
      const reasons = auto.body.skipped.map(
        (x: { reason: string }) => x.reason,
      );
      expect(reasons).toContain(
        'Орон нутгийн захиалга — бүсээр хуваарилахгүй',
      );

      if (freeDistrict) {
        expect(reasons).toContain(
          `${freeDistrict}-ыг хамардаг сул жолооч алга`,
        );
        // Хуваарилагдаагүй хэвээр
        const still = await api()
          .get(`/api/orders/${uncoveredIds[0]}`)
          .set(auth(tok.manager))
          .expect(200);
        expect(still.body.assignedDriver).toBeNull();
      }
    });

    it('эрхгүй хүн автомат хуваарилалт хийхгүй → 403', async () => {
      await api()
        .patch('/api/orders/assign-driver/auto')
        .set(auth(tok.driver))
        .send({ orderIds: [farOrderId] })
        .expect(403);
    });
  });

  // ────────────────────────────────────────────── V5: НЯРАВ + ХҮЛЭЭЛГЭН ӨГӨХ
  describe('V5: Нярав — бэлтгэл ба хүлээлгэн өгөх ⭐', () => {
    let whOrderA: string;
    let whOrderB: string;

    it('нярав хэрэглэгч үүсч, өөрийн default эрхээ авна', async () => {
      const created = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-keeper-${T}@ursgal.mn`,
          password: 'keeper123',
          name: `Э2Э Нярав ${T}`,
          role: 'WAREHOUSE',
        })
        .expect(201);
      keeperId = created.body.id;

      const login = await api()
        .post('/api/auth/login')
        .send({ email: `e2e-keeper-${T}@ursgal.mn`, password: 'keeper123' })
        .expect(200);
      keeperToken = login.body.accessToken;

      const me = await api()
        .get('/api/auth/me')
        .set(auth(keeperToken))
        .expect(200);
      expect(me.body.role).toBe('WAREHOUSE');
      expect(me.body.permissions).toContain('warehouse.handover');
      expect(me.body.permissions).toContain('inventory.adjustment');
      // Менежер оноогоогүй үед бэлтгэл зогсохгүйн тулд (V5)
      expect(me.body.permissions).toContain('orders.assign_driver');
      // Санхүү/хэрэглэгч рүү хүрэхгүй
      expect(me.body.permissions).not.toContain('finance.view_income');
      expect(me.body.permissions).not.toContain('users.manage');
    });

    it('жолооч няравын самбарт хүрэхгүй → 403 ⭐', async () => {
      await api().get('/api/warehouse/board').set(auth(tok.driver)).expect(403);
      await api()
        .post('/api/warehouse/assign')
        .set(auth(tok.operator))
        .send({ warehouseId: keeperId, orderIds: [orderId] })
        .expect(403);
    });

    it('менежер захиалгуудыг няравт хуваарилна', async () => {
      for (const n of ['A', 'B']) {
        const res = await api()
          .post('/api/orders')
          .set(auth(tok.manager))
          .send({
            customerName: `Э2Э Нярав-${n}-${T}`,
            customerPhone: `9${T}`,
            ...UB_ADDR,
            items: [{ productId, qty: 1 }],
          })
          .expect(201);
        feeOrderIds.push(res.body.id);
        if (n === 'A') whOrderA = res.body.id;
        else whOrderB = res.body.id;

        // Няравт очихын тулд CONFIRMED байх ёстой
        await api()
          .patch(`/api/orders/${res.body.id}/status`)
          .set(auth(tok.manager))
          .send({ status: 'CONFIRMED' })
          .expect(200);
        // Жолооч нь хуваарилагдана
        await api()
          .patch(`/api/orders/${res.body.id}/assign-driver`)
          .set(auth(tok.manager))
          .send({ driverId: e2eDriverId })
          .expect(200);
      }

      const res = await api()
        .post('/api/warehouse/assign')
        .set(auth(tok.manager))
        .send({ warehouseId: keeperId, orderIds: [whOrderA, whOrderB] })
        .expect(201);
      expect(res.body.assigned).toBe(2);

      // Идэвхгүй/буруу нярав → 400
      await api()
        .post('/api/warehouse/assign')
        .set(auth(tok.manager))
        .send({ warehouseId: e2eDriverId, orderIds: [whOrderA] })
        .expect(400);
    });

    it('самбар: жолоочоор бүлэглээд бараа НЭГТГЭЖ харуулна ⭐', async () => {
      const res = await api()
        .get('/api/warehouse/board')
        .set(auth(keeperToken))
        .expect(200);
      const g = res.body.find(
        (x: { driverId: string }) => x.driverId === e2eDriverId,
      );
      expect(g).toBeTruthy();
      expect(g.orderCount).toBeGreaterThanOrEqual(2);
      // 2 захиалга × 1ш = нэгтгэсэн 2ш
      const item = g.items.find(
        (i: { productId: string }) => i.productId === productId,
      );
      expect(item.qty).toBeGreaterThanOrEqual(2);
    });

    it('нярав төлөв солино: CONFIRMED → PREPARING → READY', async () => {
      for (const id of [whOrderA, whOrderB]) {
        await api()
          .patch(`/api/orders/${id}/status`)
          .set(auth(keeperToken))
          .send({ status: 'PREPARING' })
          .expect(200);
        await api()
          .patch(`/api/orders/${id}/status`)
          .set(auth(keeperToken))
          .send({ status: 'READY' })
          .expect(200);
      }
      const board = await api()
        .get('/api/warehouse/board')
        .set(auth(keeperToken))
        .expect(200);
      const g = board.body.find(
        (x: { driverId: string }) => x.driverId === e2eDriverId,
      );
      expect(g.readyCount).toBeGreaterThanOrEqual(2);
    });

    it('хүлээлгэн өгөх: дугаар, нэгтгэл, ASSIGNED ⭐', async () => {
      const res = await api()
        .post('/api/warehouse/handovers')
        .set(auth(keeperToken))
        .send({
          driverId: e2eDriverId,
          orderIds: [whOrderA, whOrderB],
          note: 'Э2Э хүлээлгэлт',
        })
        .expect(201);
      handoverId = res.body.id;

      expect(res.body.number).toMatch(/^ХҮЛ-\d{8}-\d{3}$/);
      expect(res.body.keeper.id).toBe(keeperId);
      expect(res.body.driver.id).toBe(e2eDriverId);
      expect(res.body.handedAt).toBeTruthy();
      expect(res.body.orders).toHaveLength(2);
      // Хэвлэх хуудсанд нэгтгэсэн бараа
      const total = res.body.totals.find(
        (x: { qty: number; name: string }) => x.qty >= 2,
      );
      expect(total).toBeTruthy();

      // Захиалгууд жолоочид гарсан
      const order = await api()
        .get(`/api/orders/${whOrderA}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(order.body.orderStatus).toBe('READY');
      expect(order.body.deliveryStatus).toBe('ASSIGNED');

      // Самбараас хасагдсан (handoverId тавигдсан)
      const board = await api()
        .get('/api/warehouse/board')
        .set(auth(keeperToken))
        .expect(200);
      const g = board.body.find(
        (x: { driverId: string }) => x.driverId === e2eDriverId,
      );
      expect(
        (g?.orders ?? []).some((o: { id: string }) => o.id === whOrderA),
      ).toBe(false);
    });

    it('давхар хүлээлгэлт → 400, түүх/хэвлэх хуудас нээгдэнэ', async () => {
      await api()
        .post('/api/warehouse/handovers')
        .set(auth(keeperToken))
        .send({ driverId: e2eDriverId, orderIds: [whOrderA] })
        .expect(400);

      const list = await api()
        .get('/api/warehouse/handovers')
        .set(auth(keeperToken))
        .expect(200);
      const row = list.body.find((h: { id: string }) => h.id === handoverId);
      expect(row._count.orders).toBe(2);

      const one = await api()
        .get(`/api/warehouse/handovers/${handoverId}`)
        .set(auth(keeperToken))
        .expect(200);
      expect(one.body.totals.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────── V5: БОРЛУУЛАГЧ
  describe('V5: Борлуулагч — хүсэлтээс хүргэлт хүртэл ⭐', () => {
    let reqId: string;
    let sellerOrderId: string;

    afterAll(async () => {
      if (reqId) {
        await prisma.orderRequestItem.deleteMany({ where: { requestId: reqId } });
        await prisma.orderRequest.deleteMany({ where: { id: reqId } });
      }
    });

    it('борлуулагч үүсч, өөрийн ажлын эрхээ авна', async () => {
      const created = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-seller-${T}@ursgal.mn`,
          password: 'seller123',
          name: `Э2Э Борлуулагч ${T}`,
          role: 'SELLER',
        })
        .expect(201);
      sellerId = created.body.id;

      const login = await api()
        .post('/api/auth/login')
        .send({ email: `e2e-seller-${T}@ursgal.mn`, password: 'seller123' })
        .expect(200);
      sellerToken = login.body.accessToken;

      const me = await api()
        .get('/api/auth/me')
        .set(auth(sellerToken))
        .expect(200);
      expect(me.body.role).toBe('SELLER');
      // Ажлын гурван алхам
      expect(me.body.permissions).toContain('orders.view');
      expect(me.body.permissions).toContain('orders.assign_driver');
      expect(me.body.permissions).toContain('customers.view');
      // Санхүү/эрх/тайланд хүрэхгүй
      expect(me.body.permissions).not.toContain('finance.view_income');
      expect(me.body.permissions).not.toContain('users.manage');
      expect(me.body.permissions).not.toContain('permissions.manage');
    });

    it('линкийн хүсэлт МЕНЕЖЕР дээр биш, БОРЛУУЛАГЧ дээр очно ⭐', async () => {
      const link = await api()
        .get('/api/order-requests/link')
        .set(auth(tok.manager))
        .expect(200);

      const res = await api()
        .post(`/api/public/order-requests?token=${link.body.token}`)
        .field('customerName', `Э2Э Борл-Хүсэлт ${T}`)
        .field('phone', SELLER_PHONE)
        .field('channel', 'FACEBOOK')
        .field('region', 'ULAANBAATAR')
        .field('district', 'ХУД')
        .field('khoroo', '11')
        .field('building', 'Э2Э байр')
        .attach('proof', PNG, { filename: 'proof.png', contentType: 'image/png' })
        .field('items', JSON.stringify([{ productId, qty: 1 }]))
        .expect(201);
      reqId = res.body.id;
      requestIds.push(reqId);

      // ⭐ Борлуулагч дээр ирсэн
      const mine = await api()
        .get('/api/notifications?limit=20')
        .set(auth(sellerToken))
        .expect(200);
      expect(
        mine.body.items.some(
          (n: { type: string; refId: string }) =>
            n.type === 'ORDER_REQUEST' && n.refId === reqId,
        ),
      ).toBe(true);

      // ⭐ Менежер дээр ИРЭХГҮЙ — борлуулагч байгаа тул
      const mgr = await api()
        .get('/api/notifications?limit=20')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        mgr.body.items.some(
          (n: { type: string; refId: string }) =>
            n.type === 'ORDER_REQUEST' && n.refId === reqId,
        ),
      ).toBe(false);
    });

    it('борлуулагч хүсэлтийг батлаад захиалга болгоно', async () => {
      const order = await api()
        .post(`/api/order-requests/${reqId}/convert`)
        .set(auth(sellerToken))
        .send({ paymentConfirmed: true }) // борлуулагч данс дээрээ харсан (V5)
        .expect(201);
      sellerOrderId = order.body.id;
      feeOrderIds.push(sellerOrderId);
      expect(order.body.channel).toBe('FACEBOOK');
      expect(order.body.orderStatus).toBe('CONFIRMED');
    });

    it('худалдан авалтын түүхийг утсаар нь шалгана ⭐', async () => {
      const h = await api()
        .get(`/api/customers/history?phone=${SELLER_PHONE}`)
        .set(auth(sellerToken))
        .expect(200);
      expect(h.body.summary.orders).toBe(1);
      expect(h.body.orders[0].orderNo).toBe(
        (
          await api()
            .get(`/api/orders/${sellerOrderId}`)
            .set(auth(sellerToken))
            .expect(200)
        ).body.orderNo,
      );
      expect(h.body.summary.topProducts.length).toBeGreaterThan(0);

      // phone-гүй бол 400
      await api()
        .get('/api/customers/history')
        .set(auth(sellerToken))
        .expect(400);
      // Жолооч хэрэглэгчийн түүх харахгүй
      await api()
        .get(`/api/customers/history?phone=${SELLER_PHONE}`)
        .set(auth(tok.driver))
        .expect(403);
    });

    it('жолооч хуваарилахад НЯРАВ+МЕНЕЖЕР мэдэгдэл авна ⭐', async () => {
      await api()
        .patch(`/api/orders/${sellerOrderId}/assign-driver`)
        .set(auth(sellerToken))
        .send({ driverId: e2eDriverId })
        .expect(200);

      // Нярав — тооцоо гаргахад
      const keeper = await api()
        .get('/api/notifications?limit=20')
        .set(auth(keeperToken))
        .expect(200);
      const note = keeper.body.items.find(
        (n: { type: string; refId: string }) =>
          n.type === 'ORDER_RELEASED' && n.refId === sellerOrderId,
      );
      expect(note).toBeTruthy();
      // Хэрэглэгчийн мэдээлэл + түүх мэдэгдлийн биед шууд байна
      expect(note.body).toContain(SELLER_PHONE);
      expect(note.body).toContain('ХУД');
      expect(note.body).toContain('Анхны худалдан авалт');

      // Менежер — хяналт
      const mgr = await api()
        .get('/api/notifications?limit=20')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        mgr.body.items.some(
          (n: { type: string; refId: string }) =>
            n.type === 'ORDER_RELEASED' && n.refId === sellerOrderId,
        ),
      ).toBe(true);
    });

    it('дахин хуваарилахад мэдэгдэл ДАВХАРДАХГҮЙ ⭐', async () => {
      const before = await api()
        .get('/api/notifications?limit=50')
        .set(auth(keeperToken))
        .expect(200);
      const count = (items: { type: string; refId: string }[]) =>
        items.filter(
          (n) => n.type === 'ORDER_RELEASED' && n.refId === sellerOrderId,
        ).length;

      await api()
        .patch(`/api/orders/${sellerOrderId}/assign-driver`)
        .set(auth(sellerToken))
        .send({ driverId: e2eDriverId })
        .expect(200);

      const after = await api()
        .get('/api/notifications?limit=50')
        .set(auth(keeperToken))
        .expect(200);
      expect(count(after.body.items)).toBe(count(before.body.items));
    });

    it('хүргэлт амжилтгүй болоход БОРЛУУЛАГЧ мэдэгдэл авна ⭐', async () => {
      // Захиалга үүсгээд жолоочид өгч, жолооч нь амжилтгүй гэж бүртгэнэ
      const res = await api()
        .post('/api/orders')
        .set(auth(sellerToken))
        .send({
          customerName: `Э2Э-Амжилтгүй-${T}`,
          customerPhone: SELLER_PHONE,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      const failId = res.body.id;
      feeOrderIds.push(failId);
      await api()
        .patch(`/api/orders/${failId}/status`)
        .set(auth(sellerToken))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      await api()
        .patch(`/api/orders/${failId}/assign-driver`)
        .set(auth(sellerToken))
        .send({ driverId: e2eDriverId })
        .expect(200);

      await api()
        .post(`/api/deliveries/${failId}/complete`)
        .set(auth(e2eDriverToken))
        .field('success', 'false')
        .field('note', 'Хаяг олдсонгүй, утас авахгүй')
        .expect(201);

      // ⭐ Борлуулагч мэдэгдэл авсан — хэрэглэгчтэй ярьдаг нь тэр
      const mine = await api()
        .get('/api/notifications?limit=20')
        .set(auth(sellerToken))
        .expect(200);
      const note = mine.body.items.find(
        (n: { type: string; refId: string }) =>
          n.type === 'DELIVERY_FAILED' && n.refId === failId,
      );
      expect(note).toBeTruthy();
      expect(note.body).toContain('Хаяг олдсонгүй');
      expect(note.body).toContain(SELLER_PHONE);

      // Менежер ч хэвээр авна
      const mgr = await api()
        .get('/api/notifications?limit=20')
        .set(auth(tok.manager))
        .expect(200);
      expect(
        mgr.body.items.filter(
          (n: { type: string; refId: string }) =>
            n.type === 'DELIVERY_FAILED' && n.refId === failId,
        ),
      ).toHaveLength(1); // давхардахгүй

      // Самбарын «дахин хуваарилах» ээлжид гарсан
      const board = await api()
        .get('/api/dashboard/seller')
        .set(auth(sellerToken))
        .expect(200);
      const row = board.body.failedDeliveries.find(
        (o: { id: string }) => o.id === failId,
      );
      expect(row).toBeTruthy();
      expect(row.deliveryNote).toBe('Хаяг олдсонгүй, утас авахгүй');
      expect(row.driverName).toBeTruthy();

      // Борлуулагч дахин жолооч хуваарилж чадна
      await api()
        .patch(`/api/orders/${failId}/assign-driver`)
        .set(auth(sellerToken))
        .send({ driverId: e2eDriverId })
        .expect(200);
    });

    it('борлуулагчийн самбар — гурван алхмын дараалал', async () => {
      const res = await api()
        .get('/api/dashboard/seller')
        .set(auth(sellerToken))
        .expect(200);
      expect(typeof res.body.newRequests).toBe('number');
      expect(res.body.convertedToday).toBeGreaterThanOrEqual(1);
      expect(res.body.releasedToday).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.pendingRequests)).toBe(true);
      expect(Array.isArray(res.body.awaitingDriver)).toBe(true);
      expect(Array.isArray(res.body.failedDeliveries)).toBe(true);

      // Бусад эрх энэ самбарт хүрэхгүй
      await api()
        .get('/api/dashboard/seller')
        .set(auth(tok.driver))
        .expect(403);
    });

    it('борлуулагч санхүү/хэрэглэгчид рүү орохгүй → 403', async () => {
      await api()
        .get('/api/finance/summary')
        .set(auth(sellerToken))
        .expect(403);
      await api().get('/api/users').set(auth(sellerToken)).expect(403);
    });
  });

  // ────────────────────────────────────── V5: ЗАХИАЛГА ЗАСАХ
  describe('V5: Захиалга засах ⭐', () => {
    let editOrderId: string;
    let secondProductId: string;

    beforeAll(async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 10, reason: 'PURCHASE_IN' })
        .expect(201);

      // Хоёр дахь бараа — засварт шинээр нэмэхэд
      const p2 = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({
          sku: `${SKU}-EDIT`,
          name: `Э2Э Засвар бараа ${T}`,
          price: '1000.00',
          costPrice: '600.00',
        })
        .expect(201);
      secondProductId = p2.body.id;
      editProductIds.push(secondProductId);
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.admin))
        .send({ productId: secondProductId, qtyChange: 10, reason: 'PURCHASE_IN' })
        .expect(201);

      const res = await api()
        .post('/api/orders')
        .set(auth(tok.manager))
        .send({
          customerName: `Э2Э-Засвар-${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 2 }],
        })
        .expect(201);
      editOrderId = res.body.id;
      feeOrderIds.push(editOrderId);
      await api()
        .patch(`/api/orders/${editOrderId}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CONFIRMED' })
        .expect(200);
    });

    it('баталгаажсаны дараа ХАЯГ засагдана ⭐', async () => {
      const res = await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.manager))
        .send({
          customerName: `Э2Э-Засвар-ЗАССАН-${T}`,
          region: 'ULAANBAATAR',
          district: 'БЗД',
          khoroo: '5',
          building: 'Шинэ байр',
          entrance: '3',
          floor: '7',
          door: '705',
          note: 'Хаяг зассан',
        })
        .expect(200);
      expect(res.body.district).toBe('БЗД');
      expect(res.body.fullAddress).toBe(
        'БЗД, 5-р хороо, Шинэ байр, 3-р орц, 7 давхар, 705 тоот',
      );
      expect(res.body.note).toBe('Хаяг зассан');
      // Орон нутгийн талбарууд цэвэрлэгдсэн хэвээр
      expect(res.body.province).toBeNull();
    });

    it('бараа солиход ҮЛДЭГДЭЛ ЗӨРҮҮГЭЭР нь хөдөлнө ⭐', async () => {
      const before = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      const before2 = await api()
        .get(`/api/products/${secondProductId}`)
        .set(auth(tok.manager))
        .expect(200);

      // 2 ш байсныг 1 болгож, шинэ бараанаас 3 нэмнэ
      const res = await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.manager))
        .send({
          items: [
            { productId, qty: 1 },
            { productId: secondProductId, qty: 3 },
          ],
        })
        .expect(200);
      expect(res.body.items).toHaveLength(2);

      const after = await api()
        .get(`/api/products/${productId}`)
        .set(auth(tok.manager))
        .expect(200);
      const after2 = await api()
        .get(`/api/products/${secondProductId}`)
        .set(auth(tok.manager))
        .expect(200);
      // ⭐ Хассан нь БУЦАЖ орсон, нэмсэн нь хасагдсан
      expect(after.body.stockQty).toBe(before.body.stockQty + 1);
      expect(after2.body.stockQty).toBe(before2.body.stockQty - 3);

      // Нийт дүн дахин бодогдсон
      const unit = Number(
        res.body.items.find(
          (i: { productId: string }) => i.productId === secondProductId,
        ).priceAtOrder,
      );
      expect(unit).toBe(1000);
      expect(Number(res.body.totalAmount)).toBe(
        Number(before.body.price) * 1 + 1000 * 3,
      );

      // Хөдөлгөөн ORDER_EDIT шалтгаантай бүртгэгдсэн
      const moves = await api()
        .get(`/api/stock/movements?productId=${secondProductId}&reason=ORDER_EDIT`)
        .set(auth(tok.manager))
        .expect(200);
      expect(moves.body.items.length).toBeGreaterThan(0);
      expect(moves.body.items[0].qtyChange).toBe(-3);
    });

    it('бараа хасахад мөр устаж, дүн буурна', async () => {
      const res = await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.manager))
        .send({ items: [{ productId: secondProductId, qty: 3 }] })
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(Number(res.body.totalAmount)).toBe(3000);
    });

    it('хоосон бараа / хүрэлцэхгүй үлдэгдэл → 400, үлдэгдэл хөдлөхгүй', async () => {
      const before = await api()
        .get(`/api/products/${secondProductId}`)
        .set(auth(tok.manager))
        .expect(200);

      await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.manager))
        .send({ items: [] })
        .expect(400);

      await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.manager))
        .send({ items: [{ productId: secondProductId, qty: 99999 }] })
        .expect(400);

      const after = await api()
        .get(`/api/products/${secondProductId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(after.body.stockQty).toBe(before.body.stockQty);
    });

    it('дууссан захиалга ХӨШИНӨ ⭐', async () => {
      await api()
        .patch(`/api/orders/${editOrderId}/status`)
        .set(auth(tok.manager))
        .send({ status: 'COMPLETED' })
        .expect(200);

      const res = await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.manager))
        .send({ note: 'оройтсон засвар' })
        .expect(400);
      expect(res.body.message).toContain('засах боломжгүй');
    });

    it('эрхгүй хүн засахгүй → 403', async () => {
      await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.driver))
        .send({ note: 'хакер' })
        .expect(403);
      await api()
        .patch(`/api/orders/${editOrderId}`)
        .set(auth(tok.operator))
        .send({ note: 'хакер' })
        .expect(403);
    });
  });

  // ─────────────────────────────── V5: ХАРИЛЦАГЧИЙН НИЙЛҮҮЛЭЛТ
  describe('V5: Харилцагчийн нийлүүлэлт ⭐', () => {
    let supplyId: string;
    let partnerToken: string;
    let supProductId: string;
    let otherCompanyId: string;
    let quickCompanyId: string;

    afterAll(async () => {
      // Нийлүүлэлт нь эдгээр компанийг заадаг тул түүнээс ХОЙШ устна —
      // үндсэн afterAll supplyIds-ыг эхлээд цэвэрлэдэг
      for (const id of [otherCompanyId, quickCompanyId].filter(Boolean)) {
        await prisma.supply.deleteMany({ where: { companyId: id } });
        await prisma.company.deleteMany({ where: { id } });
      }
    });

    it('харилцагч компани + нийлүүлэгч хүн бүртгэгдэнэ', async () => {
      const co = await api()
        .post('/api/companies')
        .set(auth(tok.admin))
        .send({ name: `Э2Э Нийлүүлэгч ${T}`, phone: '77001122' })
        .expect(201);
      supCompanyId = co.body.id;

      const other = await api()
        .post('/api/companies')
        .set(auth(tok.admin))
        .send({ name: `Э2Э Өөр компани ${T}` })
        .expect(201);
      otherCompanyId = other.body.id;

      const user = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-partner-${T}@ursgal.mn`,
          password: 'partner123',
          name: `Э2Э Харилцагч ${T}`,
          role: 'OPERATOR',
          companyId: supCompanyId,
        })
        .expect(201);
      supPartnerId = user.body.id;

      const login = await api()
        .post('/api/auth/login')
        .send({ email: `e2e-partner-${T}@ursgal.mn`, password: 'partner123' })
        .expect(200);
      partnerToken = login.body.accessToken;

      const p = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({
          sku: `${SKU}-SUP`,
          name: `Э2Э Нийлүүлэх бараа ${T}`,
          price: '9000.00',
          costPrice: '1000.00',
          lowStockLimit: 5,
        })
        .expect(201);
      supProductId = p.body.id;
      editProductIds.push(supProductId);
    });

    it('нийлүүлэлт: ҮЛДЭГДЭЛ НЭМЭГДЭЖ, өртөг шинэчлэгдэнэ ⭐', async () => {
      const before = await api()
        .get(`/api/products/${supProductId}`)
        .set(auth(tok.manager))
        .expect(200);

      const res = await api()
        .post('/api/supplies')
        .set(auth(tok.manager))
        .send({
          companyId: supCompanyId,
          supplierId: supPartnerId,
          note: 'Эхний ачаа',
          items: [{ productId: supProductId, qty: 20, unitCost: '5000' }],
        })
        .expect(201);
      supplyId = res.body.id;
      supplyIds.push(supplyId);

      expect(res.body.number).toMatch(/^НИЙ-\d{8}-\d{3}$/);
      expect(Number(res.body.totalCost)).toBe(100000);
      expect(Number(res.body.paidAmount)).toBe(0);
      expect(res.body.supplier.id).toBe(supPartnerId);

      const after = await api()
        .get(`/api/products/${supProductId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(after.body.stockQty).toBe(before.body.stockQty + 20);
      expect(Number(after.body.costPrice)).toBe(5000);
      expect(after.body.companyId).toBe(supCompanyId);

      const moves = await api()
        .get(`/api/stock/movements?productId=${supProductId}&reason=SUPPLY`)
        .set(auth(tok.manager))
        .expect(200);
      expect(moves.body.items[0].qtyChange).toBe(20);
    });

    it('тооцоо: нийт өртөг, төлсөн, ӨР ⭐', async () => {
      const res = await api()
        .get('/api/supplies/balances')
        .set(auth(tok.manager))
        .expect(200);
      const row = res.body.find(
        (c: { companyId: string }) => c.companyId === supCompanyId,
      );
      expect(row.supplies).toBe(1);
      expect(Number(row.totalCost)).toBe(100000);
      expect(Number(row.dueAmount)).toBe(100000);
    });

    it('хэсэгчилсэн төлбөр — ЗАРЛАГА болж бүртгэгдэнэ ⭐', async () => {
      const res = await api()
        .post(`/api/supplies/${supplyId}/pay`)
        .set(auth(tok.manager))
        .send({ amount: '60000' })
        .expect(201);
      expect(Number(res.body.paidAmount)).toBe(60000);
      expect(Number(res.body.dueAmount)).toBe(40000);

      await api()
        .post(`/api/supplies/${supplyId}/pay`)
        .set(auth(tok.manager))
        .send({ amount: '999999' })
        .expect(400);

      const fin = await api()
        .get('/api/finance/entries?type=EXPENSE&limit=50')
        .set(auth(tok.manager))
        .expect(200);
      const entry = (fin.body.items ?? fin.body).find(
        (e: { category: string; note: string | null }) =>
          e.category === 'SUPPLY' && e.note?.includes('НИЙ-'),
      );
      expect(entry).toBeTruthy();
      expect(Number(entry.amount)).toBe(60000);
      financeEntryIds.push(entry.id);
    });

    it('үлдэгдэл дуусахад НИЙЛҮҮЛЭГЧид мэдэгдэнэ ⭐', async () => {
      const cur = await api()
        .get(`/api/products/${supProductId}`)
        .set(auth(tok.manager))
        .expect(200);
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({
          productId: supProductId,
          qtyChange: -(cur.body.stockQty - 2),
          reason: 'MANUAL_OUT',
        })
        .expect(201);

      const mine = await api()
        .get('/api/notifications?limit=20')
        .set(auth(partnerToken))
        .expect(200);
      expect(
        mine.body.items.some(
          (n: { type: string; refId: string }) =>
            n.type === 'LOW_STOCK' && n.refId === supProductId,
        ),
      ).toBe(true);
    });

    it('харилцагч ЗӨВХӨН өөрийн компанийн тооцоог харна ⭐', async () => {
      const list = await api()
        .get('/api/supplies')
        .set(auth(partnerToken))
        .expect(200);
      expect(list.body.length).toBeGreaterThan(0);
      expect(
        list.body.every(
          (s: { companyId: string }) => s.companyId === supCompanyId,
        ),
      ).toBe(true);

      const bal = await api()
        .get('/api/supplies/balances')
        .set(auth(partnerToken))
        .expect(200);
      expect(bal.body).toHaveLength(1);
      expect(bal.body[0].companyId).toBe(supCompanyId);

      const filtered = await api()
        .get(`/api/supplies?companyId=${otherCompanyId}`)
        .set(auth(partnerToken))
        .expect(200);
      expect(
        filtered.body.every(
          (s: { companyId: string }) => s.companyId === supCompanyId,
        ),
      ).toBe(true);

      await api()
        .post('/api/supplies')
        .set(auth(partnerToken))
        .send({
          companyId: supCompanyId,
          items: [{ productId: supProductId, qty: 1, unitCost: '100' }],
        })
        .expect(403);
      await api()
        .post(`/api/supplies/${supplyId}/pay`)
        .set(auth(partnerToken))
        .send({ amount: '100' })
        .expect(403);
    });

    it('supplies.create-тэй хүн компаниа ӨӨРӨӨ үүсгэнэ ⭐', async () => {
      // Урсгалыг эзэмшдэг эрх урсгалынхаа заавал алхмыг хийж чадах ёстой:
      // нийлүүлэлт бүртгэхэд компани заавал хэрэгтэй атал компани үүсгэх
      // нь зөвхөн админд байсан тул нярав/менежер дундуур гацдаг байв.
      const quick = await api()
        .post('/api/companies/quick')
        .set(auth(keeperToken))
        .send({ name: `Э2Э Хурдан ${T}`, phone: '77445566' })
        .expect(201);
      quickCompanyId = quick.body.id;
      expect(quick.body.name).toBe(`Э2Э Хурдан ${T}`);

      // Харилцагчид хуудсанд бусадтай адил харагдана
      const list = await api()
        .get('/api/companies')
        .set(auth(tok.admin))
        .expect(200);
      expect(
        list.body.some((c: { id: string }) => c.id === quickCompanyId),
      ).toBe(true);

      // Нэр давхардвал 409 + байгаа компанийг санал болгоно
      const dup = await api()
        .post('/api/companies/quick')
        .set(auth(keeperToken))
        .send({ name: `Э2Э Хурдан ${T}` })
        .expect(409);
      expect(dup.body.existing.id).toBe(quickCompanyId);

      // Тэр компанид шууд нийлүүлэлт бүртгэж чадна — урсгал тасрахгүй
      const sup = await api()
        .post('/api/supplies')
        .set(auth(keeperToken))
        .send({
          companyId: quickCompanyId,
          items: [{ productId: supProductId, qty: 1, unitCost: '100' }],
        })
        .expect(201);
      supplyIds.push(sup.body.id);
    });

    it('үүсгэх нээгдсэн ч ЗАСАХ нь хэвээр хаалттай ⭐', async () => {
      // customers.edit өргөсөөгүй — Харилцагчид хуудасны бүрэн
      // удирдлага админд үлдэнэ
      await api()
        .patch(`/api/companies/${quickCompanyId}`)
        .set(auth(keeperToken))
        .send({ name: 'Өөрчилсөн нэр' })
        .expect(403);
      await api()
        .post('/api/companies')
        .set(auth(keeperToken))
        .send({ name: `Э2Э Бүрэн ${T}` })
        .expect(403);

      // supplies.create-гүй хүн хурдан үүсгэлт ч хийхгүй
      await api()
        .post('/api/companies/quick')
        .set(auth(partnerToken))
        .send({ name: `Э2Э Хориотой ${T}` })
        .expect(403);
      await api()
        .post('/api/companies/quick')
        .set(auth(tok.driver))
        .send({ name: `Э2Э Хориотой2 ${T}` })
        .expect(403);
    });

    it('компанигүй харилцагч 403 БИШ, хоосон жагсаалт авна ⭐', async () => {
      // «Цэс харагдана гэдэг нь орж болно гэсэн амлалт» — өмнө нь
      // компанид холбогдоогүй харилцагчид цэс нь харагдаад дарахад
      // 403 өгдөг байв. companyId нь ХАНДАЛТЫН биш ШҮҮЛТИЙН нөхцөл.
      const seed = await api()
        .post('/api/auth/login')
        .send({ email: 'operator@ursgal.mn', password: 'operator123' })
        .expect(200);
      const lone = seed.body.accessToken;
      expect(seed.body.user.companyId).toBeNull();

      const list = await api()
        .get('/api/supplies')
        .set(auth(lone))
        .expect(200);
      expect(list.body).toEqual([]);

      const bal = await api()
        .get('/api/supplies/balances')
        .set(auth(lone))
        .expect(200);
      expect(bal.body).toEqual([]);

      // Бусдын нийлүүлэлтийг id-гаар ч нээхгүй
      await api().get(`/api/supplies/${supplyId}`).set(auth(lone)).expect(404);
    });

    it('дотоод ажилтан бүгдийг, харилцагч ЗӨВХӨН өөрийнхөө хардаг ⭐', async () => {
      // Дотоод ажилтан (companyId=null) — хязгааргүй
      const staff = await api()
        .get('/api/supplies')
        .set(auth(tok.manager))
        .expect(200);
      const companies = new Set(
        staff.body.map((x: { companyId: string }) => x.companyId),
      );
      expect(companies.has(supCompanyId)).toBe(true);

      // companyId шүүлтүүр дотоод ажилтанд ажиллана
      const filtered = await api()
        .get(`/api/supplies?companyId=${supCompanyId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(
        filtered.body.every(
          (x: { companyId: string }) => x.companyId === supCompanyId,
        ),
      ).toBe(true);

      // Компанитай харилцагч — зөвхөн өөрийнх, шүүлтүүр ч түүнийг
      // тойрч гарахгүй (өмнөх тестүүд үүнийг мөн шалгадаг)
      const mine = await api()
        .get(`/api/supplies?companyId=${otherCompanyId}`)
        .set(auth(partnerToken))
        .expect(200);
      expect(
        mine.body.every(
          (x: { companyId: string }) => x.companyId === supCompanyId,
        ),
      ).toBe(true);
    });

    it('өөр компанийн хүнийг нийлүүлэгч болгож болохгүй → 400', async () => {
      await api()
        .post('/api/supplies')
        .set(auth(tok.manager))
        .send({
          companyId: otherCompanyId,
          supplierId: supPartnerId,
          items: [{ productId: supProductId, qty: 1, unitCost: '100' }],
        })
        .expect(400);

      await api().get('/api/supplies').set(auth(tok.driver)).expect(403);
    });
  });

  // ──────────────────────────────────── V5: ЖОЛООЧИЙН БҮС
  describe('V5: Жолоочийн бүс — дүүргээр хуваарилалт ⭐', () => {
    it('нярав бүс нэмж, хасаж чадна ⭐', async () => {
      // Нэмэх
      const set = await api()
        .patch(`/api/drivers/${e2eDriverId}/zones`)
        .set(auth(keeperToken))
        .send({ zones: ['ХУД', 'БЗД'] })
        .expect(200);
      expect(set.body.zones.sort()).toEqual(['БЗД', 'ХУД']);

      // Жагсаалтад тусгагдсан
      const list = await api()
        .get('/api/drivers')
        .set(auth(keeperToken))
        .expect(200);
      const row = list.body.find((d: { id: string }) => d.id === e2eDriverId);
      expect(row.zones.sort()).toEqual(['БЗД', 'ХУД']);

      // Хасах — бүтэн жагсаалтыг дахин илгээнэ
      const less = await api()
        .patch(`/api/drivers/${e2eDriverId}/zones`)
        .set(auth(keeperToken))
        .send({ zones: ['ХУД'] })
        .expect(200);
      expect(less.body.zones).toEqual(['ХУД']);

      // Бүгдийг цэвэрлэх нь хүчинтэй төлөв
      const none = await api()
        .patch(`/api/drivers/${e2eDriverId}/zones`)
        .set(auth(keeperToken))
        .send({ zones: [] })
        .expect(200);
      expect(none.body.zones).toEqual([]);
    });

    it('давхардал цэвэрлэгдэж, буруу дүүрэг → 400', async () => {
      const dup = await api()
        .patch(`/api/drivers/${e2eDriverId}/zones`)
        .set(auth(keeperToken))
        .send({ zones: ['ХУД', 'ХУД', 'БЗД'] })
        .expect(200);
      expect(dup.body.zones).toHaveLength(2);

      await api()
        .patch(`/api/drivers/${e2eDriverId}/zones`)
        .set(auth(keeperToken))
        .send({ zones: ['БАЙХГҮЙ'] })
        .expect(400);
    });

    it('жолооч биш хүнд бүс тохируулах → 404', async () => {
      await api()
        .patch(`/api/drivers/${keeperId}/zones`)
        .set(auth(tok.manager))
        .send({ zones: ['ХУД'] })
        .expect(404);
    });

    it('эрхгүй хүн бүс өөрчлөхгүй → 403', async () => {
      await api()
        .patch(`/api/drivers/${e2eDriverId}/zones`)
        .set(auth(tok.driver))
        .send({ zones: ['ХУД'] })
        .expect(403);
      await api()
        .patch(`/api/drivers/${e2eDriverId}/zones`)
        .set(auth(tok.operator))
        .send({ zones: ['ХУД'] })
        .expect(403);
    });
  });

  // ──────────────── V5: МӨНГӨ vs БАРАА — тооллын зөв байдал
  describe('V5: Цуцлалт ба буцаалтын тооцоо ⭐', () => {
    it('төлбөртэй захиалгыг ШУУД цуцлахыг хориглоно ⭐', async () => {
      // Өмнө нь цуцлалт үлдэгдлийг буцаадаг ч мөнгийг хөнддөггүй тул
      // бараа агуулахад ирчихээд төлбөр нь ОРЛОГО болж номд үлддэг байв
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Цуцлалт-${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          paid: true,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      const id = res.body.id;
      feeOrderIds.push(id);
      expect(Number(res.body.paidAmount)).toBeGreaterThan(0);

      const denied = await api()
        .patch(`/api/orders/${id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CANCELLED' })
        .expect(400);
      expect(denied.body.message).toContain('Төлбөртэй захиалгыг цуцлах');

      // Захиалга хөндөгдөөгүй
      const still = await api()
        .get(`/api/orders/${id}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(still.body.orderStatus).not.toBe('CANCELLED');

      // Зөв зам: төлбөрийг нь буцаагаад дараа нь цуцална
      await api()
        .delete(`/api/payments/${still.body.payments[0].id}`)
        .set(auth(tok.manager))
        .expect(200);
      const done = await api()
        .patch(`/api/orders/${id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect(done.body.orderStatus).toBe('CANCELLED');
      expect(Number(done.body.paidAmount)).toBe(0);
    });

    it('буцаагдсан бараа БОРЛУУЛАЛТААС хасагдана ⭐', async () => {
      const before = await api()
        .get('/api/finance/summary')
        .set(auth(tok.manager))
        .expect(200);

      // Захиалга → хүргэлт → бүтэн буцаалт
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Буцаалт-${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      const id = res.body.id;
      feeOrderIds.push(id);
      const line = Number(res.body.items[0].lineTotal);

      const mid = await api()
        .get('/api/finance/summary')
        .set(auth(tok.manager))
        .expect(200);
      expect(Number(mid.body.salesRevenue)).toBe(
        Number(before.body.salesRevenue) + line,
      );

      await api()
        .patch(`/api/orders/${id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      await api()
        .patch(`/api/orders/${id}/assign-driver`)
        .set(auth(tok.manager))
        .send({ driverId: e2eDriverId })
        .expect(200);
      await api()
        .post(`/api/deliveries/${id}/complete`)
        .set(auth(e2eDriverToken))
        .field('success', 'true')
        .field('note', 'хүргэсэн')
        .expect(201);

      await api()
        .post(`/api/orders/${id}/return`)
        .set(auth(tok.manager))
        .send({
          reason: 'Э2Э буцаалт',
          restock: true,
          items: [{ orderItemId: res.body.items[0].id, qty: 1 }],
        })
        .expect(201);

      // ⭐ Бараа агуулахад буцаж ирсэн тул борлуулалт анхны түвшинд
      const after = await api()
        .get('/api/finance/summary')
        .set(auth(tok.manager))
        .expect(200);
      expect(Number(after.body.salesRevenue)).toBe(
        Number(before.body.salesRevenue),
      );

      // Аналитик мөн адил
      const an = await api()
        .get('/api/analytics/sales')
        .set(auth(tok.manager))
        .expect(200);
      expect(Number(an.body.totals.amount)).toBeGreaterThanOrEqual(0);
    });
  });

  // ───────────────────── V5: ҮҮРГИЙН ХИЛ (эрхийн аудитын 5–8)
  describe('V5: Үүргийн хил — цуцлалт, төлбөр, хүлээлгэлт ⭐', () => {
    let boundaryOrderId: string;

    beforeAll(async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 5, reason: 'PURCHASE_IN' })
        .expect(201);
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Хил-${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      boundaryOrderId = res.body.id;
      feeOrderIds.push(boundaryOrderId);
      await api()
        .patch(`/api/orders/${boundaryOrderId}/status`)
        .set(auth(tok.seller))
        .send({ status: 'CONFIRMED' })
        .expect(200);
    });

    it('НЯРАВ төлөв ахиулна ч ЦУЦЛАХГҮЙ ⭐', async () => {
      // Бэлтгэлийн алхам нь түүний ажил
      await api()
        .patch(`/api/orders/${boundaryOrderId}/status`)
        .set(auth(keeperToken))
        .send({ status: 'PREPARING' })
        .expect(200);

      // Цуцлах нь үлдэгдэл/мөнгө буцаах арилжааны шийдвэр — эрхгүй
      const denied = await api()
        .patch(`/api/orders/${boundaryOrderId}/status`)
        .set(auth(keeperToken))
        .send({ status: 'CANCELLED' })
        .expect(403);
      expect(denied.body.message).toContain('цуцлах');

      // Захиалга хөндөгдөөгүй
      const still = await api()
        .get(`/api/orders/${boundaryOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      expect(still.body.orderStatus).toBe('PREPARING');
    });

    it('БОРЛУУЛАГЧ төлбөр бүртгэнэ ⭐', async () => {
      // Гүйлгээний баримтыг шалгадаг нь тэр — менежер рүү явахгүй
      const pay = await api()
        .post(`/api/orders/${boundaryOrderId}/payments`)
        .set(auth(tok.seller))
        .send({ amount: '1000.00', method: 'TRANSFER' })
        .expect(201);
      expect(Number(pay.body.order?.paidAmount ?? pay.body.paidAmount)).toBe(
        1000,
      );

      // Гэхдээ санхүүгийн модуль нээгдэхгүй хэвээр
      await api()
        .get('/api/finance/summary')
        .set(auth(tok.seller))
        .expect(403);
      await api()
        .get('/api/finance/receivables')
        .set(auth(tok.seller))
        .expect(403);
    });

    it('МЕНЕЖЕР няравын самбарт орж хүлээлгэн өгч чадна ⭐', async () => {
      // Нярав ирээгүй өдөр хүргэлт зогсохгүй
      const board = await api()
        .get('/api/warehouse/board')
        .set(auth(tok.manager))
        .expect(200);
      expect(Array.isArray(board.body)).toBe(true);
      // mineOnly нь няравт л үйлчилнэ — менежерт бүх бэлтгэл харагдана
      expect(
        board.body.some((g: { orders: { id: string }[] }) =>
          g.orders.some((o) => o.id === boundaryOrderId),
        ),
      ).toBe(true);

      await api()
        .get('/api/warehouse/handovers')
        .set(auth(tok.manager))
        .expect(200);
    });

    it('БОРЛУУЛАГЧ цуцална, ХАРИЛЦАГЧ цуцлахгүй ⭐', async () => {
      await api()
        .patch(`/api/orders/${boundaryOrderId}/status`)
        .set(auth(tok.operator))
        .send({ status: 'CANCELLED' })
        .expect(403);

      // Өмнөх тест 1000₮ төлбөр бүртгэсэн — төлбөртэй захиалга шууд
      // цуцлагдахгүй тул эхлээд мөнгийг нь буцаана (V5-ийн шинэ дүрэм)
      const cur = await api()
        .get(`/api/orders/${boundaryOrderId}`)
        .set(auth(tok.manager))
        .expect(200);
      for (const pay of cur.body.payments) {
        await api()
          .delete(`/api/payments/${pay.id}`)
          .set(auth(tok.manager))
          .expect(200);
      }

      const done = await api()
        .patch(`/api/orders/${boundaryOrderId}/status`)
        .set(auth(tok.seller))
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect(done.body.orderStatus).toBe('CANCELLED');
    });
  });

  // ────────────────────── V5: БЭЛТГЭЛГҮЙ ШУУД ДУУСГАХ
  describe('V5: Бэлтгэлийн алхмыг алгасаж дуусгах ⭐', () => {
    beforeAll(async () => {
      // Өмнөх тестүүд үлдэгдлийг барсан байж болно — нөөцөө нэмнэ
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 5, reason: 'PURCHASE_IN' })
        .expect(201);
    });

    it('CONFIRMED-ээс шууд COMPLETED болно ⭐', async () => {
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.manager))
        .send({
          customerName: `Э2Э-Шууд-Дуусгах-${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      feeOrderIds.push(res.body.id);

      await api()
        .patch(`/api/orders/${res.body.id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      // ⭐ PREPARING/READY-г алгасана
      const done = await api()
        .patch(`/api/orders/${res.body.id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(done.body.orderStatus).toBe('COMPLETED');

      // COMPLETED-ээс цааш явахгүй хэвээр
      await api()
        .patch(`/api/orders/${res.body.id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'CANCELLED' })
        .expect(400);
    });

    it('PREPARING-ээс ч шууд дуусгана, буцаж NEW руу явахгүй', async () => {
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.manager))
        .send({
          customerName: `Э2Э-Бэлтгэл-Дуусгах-${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      feeOrderIds.push(res.body.id);

      for (const status of ['CONFIRMED', 'PREPARING']) {
        await api()
          .patch(`/api/orders/${res.body.id}/status`)
          .set(auth(tok.manager))
          .send({ status })
          .expect(200);
      }
      // Ухрах хориотой хэвээр
      await api()
        .patch(`/api/orders/${res.body.id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'NEW' })
        .expect(400);

      const done = await api()
        .patch(`/api/orders/${res.body.id}/status`)
        .set(auth(tok.manager))
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(done.body.orderStatus).toBe('COMPLETED');
    });
  });

  // ────────────────────────────────────────────── V4-16: EDGE ГҮЙЦЭЭЛТ
  describe('V4-16: Edge гүйцээлт ⭐', () => {

    it('4 буруу оролдлого түгжихгүй — амжилттай нэвтрэлт counter-ийг 0 болгоно', async () => {
      const email = `e2e-cnt-${T}@ursgal.mn`;
      const created = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({ name: 'Э2Э Counter', email, password: 'cntpass1', role: 'OPERATOR' })
        .expect(201);
      for (let i = 0; i < 4; i++) {
        await api()
          .post('/api/auth/login')
          .send({ email, password: 'wrong' + i })
          .expect(401);
      }
      // 5 дахь нь ЗӨВ — түгжилгүй нэвтэрч counter 0 болно
      await api()
        .post('/api/auth/login')
        .send({ email, password: 'cntpass1' })
        .expect(200);
      const dbUser = await prisma.user.findUnique({
        where: { id: created.body.id },
      });
      expect(dbUser?.failedLoginCount).toBe(0);
      expect(dbUser?.lockedUntil).toBeNull();
      await prisma.user.deleteMany({ where: { id: created.body.id } });
    });

    it('paid:true-гээр үүсгэхэд PAID болж, Payment + INCOME нэг дор бүртгэгдэнэ', async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.manager))
        .send({ productId, qtyChange: 1, reason: 'PURCHASE_IN' })
        .expect(201);
      const ord = await api()
        .post('/api/orders')
        .set(auth(tok.seller))
        .send({
          customerName: `Э2Э-Төлсөн-${T}`,
          customerPhone: `5${T}`,
          ...UB_ADDR,
          paid: true,
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      feeOrderIds.push(ord.body.id);
      expect(ord.body.paymentStatus).toBe('PAID');
      expect(Number(ord.body.paidAmount)).toBe(Number(ord.body.totalAmount));

      const payment = await prisma.payment.findFirst({
        where: { orderId: ord.body.id },
      });
      expect(payment?.method).toBe('TRANSFER');
      expect(Number(payment?.amount)).toBe(Number(ord.body.totalAmount));
      const income = await prisma.financeEntry.findFirst({
        where: { refOrderId: ord.body.id, category: 'PAYMENT' },
      });
      expect(income?.type).toBe('INCOME');
    });


    it('Харилцагчид (түнш = OPERATOR эрхтэй): жагсаалт статистиктай, operator 403', async () => {
      await api()
        .get('/api/customers/partners')
        .set(auth(tok.operator))
        .expect(403);

      const res = await api()
        .get('/api/customers/partners')
        .set(auth(tok.manager))
        .expect(200);
      // seed-ийн operator@ursgal.mn — OPERATOR эрхтэй тул жагсаалтад байна
      const seedOp = res.body.find(
        (c: { email: string }) => c.email === 'operator@ursgal.mn',
      );
      expect(seedOp).toBeTruthy();
      expect(seedOp).toHaveProperty('orders');
      expect(seedOp).toHaveProperty('totalAmount');
      expect(seedOp.orders).toBeGreaterThanOrEqual(1); // тестүүд нь шивсэн
      // Зөвхөн OPERATOR — жолооч/менежер орохгүй
      expect(
        res.body.some((c: { email: string }) => c.email === 'driver@ursgal.mn'),
      ).toBe(false);
    });

    it('төлөөгүй захиалгын буцаалт: refundPayment=true ч EXPENSE үүсэхгүй, UNPAID хэвээр', async () => {
      // noPhotoOrderId — DELIVERED, төлбөргүй, буцаалтгүй
      const res = await api()
        .post(`/api/orders/${noPhotoOrderId}/return`)
        .set(auth(tok.manager))
        .send({
          items: [
            {
              orderItemId: (
                await prisma.orderItem.findFirst({
                  where: { orderId: noPhotoOrderId },
                })
              )!.id,
              qty: 1,
            },
          ],
          reason: 'e2e-төлөөгүй буцаалт',
          restock: false,
          refundPayment: true,
        })
        .expect(201);
      expect(res.body.order.paymentStatus).toBe('UNPAID');
      expect(Number(res.body.order.paidAmount)).toBe(0);
      const refundEntry = await prisma.financeEntry.findFirst({
        where: { refOrderId: noPhotoOrderId, category: 'REFUND' },
      });
      expect(refundEntry).toBeNull();
    });
  });

  describe('V5: Хугацаа ба цуврал — FEFO ⭐', () => {
    let nearId: string; // ойрхон дуусах цуврал
    let farId: string; // хол дуусах цуврал
    let batchOrderId: string;
    let batchCompanyId: string;
    const batchSupplyIds: string[] = [];

    /** YYYY-MM-DD — өнөөдрөөс N хоногийн дараа/өмнө */
    const day = (n: number) =>
      new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

    const batchesOf = async (token: string) =>
      (
        await api()
          .get(`/api/batches?productId=${batchProductId}`)
          .set(auth(token))
          .expect(200)
      ).body as Array<{
        id: string;
        batchNo: string | null;
        remaining: number;
        qty: number;
        daysLeft: number;
        state: string;
      }>;

    /**
     * Цувралын тест нь бараа/нийлүүлэлт/захиалгаа өөрөө үүсгэдэг тул
     * өөрөө БҮРЭН цэвэрлэнэ. Дараалал нь FK-гаар тогтоно:
     * цуврал → захиалга(+мөр) → хөдөлгөөн/мэдэгдэл → нийлүүлэлт →
     * бараа → компани. Буруу дараалалд afterAll унаж бүх тестийн
     * ул мөр DB-д үлддэг.
     */
    afterAll(async () => {
      if (batchProductId) {
        await prisma.productBatch.deleteMany({
          where: { productId: batchProductId },
        });
      }
      if (batchOrderId) {
        await prisma.notification.deleteMany({
          where: { refId: batchOrderId },
        });
        // OrderItem нь захиалгатайгаа cascade-аар устана
        await prisma.order.deleteMany({ where: { id: batchOrderId } });
      }
      if (batchProductId) {
        await prisma.stockMovement.deleteMany({
          where: { productId: batchProductId },
        });
      }
      if (batchSupplyIds.length) {
        await prisma.notification.deleteMany({
          where: { refId: { in: batchSupplyIds } },
        });
        await prisma.supply.deleteMany({
          where: { id: { in: batchSupplyIds } },
        });
      }
      if (batchProductId) {
        await prisma.product.deleteMany({ where: { id: batchProductId } });
      }
      if (batchCompanyId) {
        await prisma.company.deleteMany({ where: { id: batchCompanyId } });
      }
    });

    it('бэлтгэл — бараа ба нийлүүлэгч компани', async () => {
      const prod = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({
          sku: `${SKU}-BATCH`,
          name: `Э2Э Хугацаатай ${T}`,
          price: '10000',
          costPrice: '4000',
          stockQty: 0,
        })
        .expect(201);
      batchProductId = prod.body.id;

      const co = await api()
        .post('/api/companies')
        .set(auth(tok.admin))
        .send({ name: `Э2Э Хугацаа компани ${T}` })
        .expect(201);
      batchCompanyId = co.body.id;
    });

    it('хугацаатай нийлүүлэлт → цуврал автоматаар үүснэ', async () => {
      for (const [days, no] of [
        [20, 'ОЙРХОН'],
        [300, 'ХОЛ'],
      ] as Array<[number, string]>) {
        const sup = await api()
          .post('/api/supplies')
          .set(auth(tok.admin))
          .send({
            companyId: batchCompanyId,
            items: [
              {
                productId: batchProductId,
                qty: 10,
                unitCost: '4000',
                expiryDate: day(days),
                batchNo: no,
              },
            ],
          })
          .expect(201);
        batchSupplyIds.push(sup.body.id);
      }

      const rows = await batchesOf(tok.admin);
      expect(rows).toHaveLength(2);
      // Хугацаагаар өсөхөөр эрэмбэлэгдэнэ — FEFO-гийн үндэс
      expect(rows[0].batchNo).toBe('ОЙРХОН');
      expect(rows[1].batchNo).toBe('ХОЛ');
      expect(rows[0].state).toBe('CRITICAL'); // 20 ≤ 30 хоног
      expect(rows[1].state).toBe('OK');
      expect(rows[0].remaining).toBe(10);
    });

    it('хугацаагүй мөр цуврал үүсгэхгүй', async () => {
      const sup = await api()
        .post('/api/supplies')
        .set(auth(tok.admin))
        .send({
          companyId: batchCompanyId,
          items: [
            { productId: batchProductId, qty: 5, unitCost: '4000' },
          ],
        })
        .expect(201);
      batchSupplyIds.push(sup.body.id);
      // Цуврал нэмэгдээгүй — үлдэгдэл л өссөн
      expect(await batchesOf(tok.admin)).toHaveLength(2);
    });

    it('захиалга ЭХЭЛЖ ДУУСАХ цувралаас хасна (FEFO)', async () => {
      const order = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э FEFO ${T}`,
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId: batchProductId, qty: 12 }],
        })
        .expect(201);
      batchOrderId = order.body.id;

      const rows = await batchesOf(tok.admin);
      // ОЙРХОН бүрэн дуусч жагсаалтаас гарна, үлдсэн 2 нь ХОЛ-оос
      expect(rows).toHaveLength(1);
      expect(rows[0].batchNo).toBe('ХОЛ');
      expect(rows[0].remaining).toBe(8);
      nearId = (
        await prisma.productBatch.findFirstOrThrow({
          where: { productId: batchProductId, batchNo: 'ОЙРХОН' },
        })
      ).id;
      farId = rows[0].id;
      expect(
        (await prisma.productBatch.findUniqueOrThrow({ where: { id: nearId } }))
          .remaining,
      ).toBe(0);
    });

    it('цуцлалт цувралыг УРВУУ дарааллаар нөхнө', async () => {
      await api()
        .patch(`/api/orders/${batchOrderId}/status`)
        .set(auth(tok.admin))
        .send({ status: 'CANCELLED' })
        .expect(200);

      const near = await prisma.productBatch.findUniqueOrThrow({
        where: { id: nearId },
      });
      const far = await prisma.productBatch.findUniqueOrThrow({
        where: { id: farId },
      });
      // Эхэлж дуусахаас нь хассан тул эхэлж дуусах руу нь буцна
      expect(near.remaining).toBe(10);
      expect(far.remaining).toBe(10);
    });

    it('гараар хугацаа зүүхэд үлдэгдэл НЭМЭГДЭХГҮЙ', async () => {
      const before = (
        await prisma.product.findUniqueOrThrow({
          where: { id: batchProductId },
        })
      ).stockQty;

      await api()
        .post('/api/batches')
        .set(auth(tok.admin))
        .send({
          productId: batchProductId,
          expiryDate: day(-5), // хугацаа нь ДУУССАН
          qty: 3,
          batchNo: 'ХУУЧИН',
        })
        .expect(201);

      const after = (
        await prisma.product.findUniqueOrThrow({
          where: { id: batchProductId },
        })
      ).stockQty;
      expect(after).toBe(before);

      const rows = await batchesOf(tok.admin);
      const old = rows.find((b) => b.batchNo === 'ХУУЧИН')!;
      expect(old.state).toBe('EXPIRED');
      expect(old.daysLeft).toBeLessThan(0);
    });

    it('хугацаа зүүгээгүй үлдэгдлээс хэтрүүлж болохгүй', async () => {
      const res = await api()
        .post('/api/batches')
        .set(auth(tok.admin))
        .send({
          productId: batchProductId,
          expiryDate: day(90),
          qty: 99999,
        })
        .expect(400);
      expect(res.body.message).toContain('Хугацаа зүүгээгүй үлдэгдэл');
    });

    it('устгалд гаргахад үлдэгдэл хасагдаж хөдөлгөөн бичигдэнэ', async () => {
      const rows = await batchesOf(tok.admin);
      const expired = rows.find((b) => b.state === 'EXPIRED')!;
      const before = (
        await prisma.product.findUniqueOrThrow({
          where: { id: batchProductId },
        })
      ).stockQty;

      await api()
        .post(`/api/batches/${expired.id}/write-off`)
        .set(auth(tok.admin))
        .send({ note: 'e2e устгал' })
        .expect(201);

      const after = (
        await prisma.product.findUniqueOrThrow({
          where: { id: batchProductId },
        })
      ).stockQty;
      expect(after).toBe(before - expired.remaining);

      const mv = await prisma.stockMovement.findFirst({
        where: { productId: batchProductId, reason: 'EXPIRED' },
      });
      expect(mv).not.toBeNull();
      expect(mv!.qtyChange).toBe(-expired.remaining);

      // Устгасан цуврал жагсаалтаас гарна
      expect(
        (await batchesOf(tok.admin)).some((b) => b.id === expired.id),
      ).toBe(false);

      // Дахин устгах боломжгүй
      const again = await api()
        .post(`/api/batches/${expired.id}/write-off`)
        .set(auth(tok.admin))
        .send({})
        .expect(400);
      expect(again.body.message).toContain('устгалд гарсан');
    });

    it('хураангуй нь төлөв бүрээр бүлэглэнэ', async () => {
      const res = await api()
        .get('/api/batches/summary')
        .set(auth(tok.admin))
        .expect(200);
      expect(res.body.warnDays).toBe(30);
      for (const k of ['EXPIRED', 'CRITICAL', 'WARNING', 'OK']) {
        expect(res.body[k]).toHaveProperty('batches');
        expect(res.body[k]).toHaveProperty('qty');
        expect(res.body[k]).toHaveProperty('value');
      }
      expect(Array.isArray(res.body.soonest)).toBe(true);
    });

    it('нярав цувралыг хардаг (агуулах бол түүний ажил)', async () => {
      await api().get('/api/batches').set(auth(keeperToken)).expect(200);
      await api()
        .get('/api/batches/summary')
        .set(auth(keeperToken))
        .expect(200);
    });

    it('жолоочид цувралын эрх байхгүй', async () => {
      await api().get('/api/batches').set(auth(tok.driver)).expect(403);
      await api()
        .post('/api/batches')
        .set(auth(tok.driver))
        .send({ productId: batchProductId, expiryDate: day(30), qty: 1 })
        .expect(403);
    });
  });


  describe('V5: Давтан захиалгын сануулга ⭐', () => {
    let roProductId: string; // 10 хоног хүрдэг бараа
    let skipProductId: string; // daysSupply = 0 — сануулгад ОРОХГҮЙ
    const roOrderIds: string[] = [];
    /**
     * ⚠ УТАСНЫ ОРОН ЗАЙ — САНАМЖ.
     *
     * Сануулгын логик нь хүний ХАМГИЙН СҮҮЛИЙН захиалгыг хардаг тул
     * өөр тест ижил утсаар шинэ захиалга үүсгэвэл миний хойш татсан
     * захиалга дарагдаж, тест «шалтгаангүй» унана.
     *
     * Бусад тестүүд `<орон>${T}` хэлбэрээр 1..9 бүх угтварыг эзэлсэн.
     * Тиймээс энд T-ийн СҮҮЛИЙН ОРНЫГ өөрчилж, аль ч `D${T}`-тэй
     * тэнцэхээргүй дугаар үүсгэнэ: угтвар нь `2` тул D≠2 үед эхний
     * орноороо, D=2 үед сүүлийн орноороо заавал ялгаатай.
     * (Өмнө нь `2${T.slice(0,6)}1` гэж байсан нь T «1»-ээр төгсөх
     * бүрд `2${T}`-тэй давхцаж, 10 ажиллагааны 1-д унадаг байв.)
     */
    const alt = (n: number) => `2${T.slice(0, 6)}${(Number(T[6]) + n) % 10}`;
    const RO_PHONE = alt(1);
    const SKIP_PHONE = alt(2);
    const CANCEL_PHONE = alt(3);

    afterAll(async () => {
      if (roOrderIds.length) {
        await prisma.notification.deleteMany({
          where: { refId: { in: roOrderIds } },
        });
        await prisma.orderItem.deleteMany({
          where: { orderId: { in: roOrderIds } },
        });
        await prisma.order.deleteMany({ where: { id: { in: roOrderIds } } });
      }
      const ids = [roProductId, skipProductId].filter(Boolean);
      if (ids.length) {
        await prisma.stockMovement.deleteMany({
          where: { productId: { in: ids } },
        });
        await prisma.product.deleteMany({ where: { id: { in: ids } } });
      }
    });

    /** Захиалгыг N хоногийн өмнө өгсөн болгож хойш нь татна */
    const backdate = async (orderId: string, days: number) => {
      await prisma.order.update({
        where: { id: orderId },
        data: { createdAt: new Date(Date.now() - days * 86_400_000) },
      });
    };

    const rowFor = async (phone: string) => {
      const res = await api()
        .get('/api/reorders')
        .set(auth(tok.seller))
        .expect(200);
      return (
        res.body.rows as Array<{
          phone: string;
          state: string;
          daysLeft: number;
          qty: number;
        }>
      ).find((r) => r.phone === phone);
    };

    it('бэлтгэл — хэрэглээний хугацаатай бараанууд', async () => {
      const a = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({
          sku: `${SKU}-RO`,
          name: `Э2Э Сануулга ${T}`,
          price: '10000',
          daysSupply: 10,
        })
        .expect(201);
      roProductId = a.body.id;
      expect(a.body.daysSupply).toBe(10);

      const b = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({
          sku: `${SKU}-RO0`,
          name: `Э2Э Сануулгагүй ${T}`,
          price: '5000',
          daysSupply: 0, // хэрэглээний бус — сав, багаж гэх мэт
        })
        .expect(201);
      skipProductId = b.body.id;

      for (const id of [roProductId, skipProductId]) {
        await api()
          .post('/api/stock/adjust')
          .set(auth(tok.admin))
          .send({ productId: id, qtyChange: 50, reason: 'PURCHASE_IN' })
          .expect(201);
      }
    });

    it('дуусаагүй бол жагсаалтад ГАРАХГҮЙ', async () => {
      const o = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э Давтан ${T}`,
          customerPhone: RO_PHONE,
          ...UB_ADDR,
          items: [{ productId: roProductId, qty: 1 }],
        })
        .expect(201);
      roOrderIds.push(o.body.id);

      // Дөнгөж авсан — 10 хоног хүрнэ, 7 хоногийн хязгаараас хол
      expect(await rowFor(RO_PHONE)).toBeUndefined();
    });

    it('дуусах дөхөхөд гарч ирнэ', async () => {
      // 5 хоногийн өмнө авсан → 5 хоног үлдсэн → 7-гийн хязгаарт багтана
      await backdate(roOrderIds[0], 5);
      const row = await rowFor(RO_PHONE);
      expect(row).toBeDefined();
      expect(row).toMatchObject({ state: 'SOON', daysLeft: 5, qty: 1 });
    });

    it('хугацаа хэтэрсэн бол ХОЦОРСОН болно', async () => {
      await backdate(roOrderIds[0], 18); // 10 хоног хүрэх байсан → 8 хоцорсон
      const row = await rowFor(RO_PHONE);
      expect(row!.state).toBe('OVERDUE');
      expect(row!.daysLeft).toBe(-8);
    });

    it('тоо ширхэг хугацааг уртасгана', async () => {
      // 3 ширхэг × 10 хоног = 30 хоног хүрнэ
      const o = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э Олон ${T}`,
          customerPhone: RO_PHONE,
          ...UB_ADDR,
          items: [{ productId: roProductId, qty: 3 }],
        })
        .expect(201);
      roOrderIds.push(o.body.id);
      await backdate(o.body.id, 18);

      // Хамгийн СҮҮЛИЙН захиалгыг л хардаг тул хуучин нь орлогдоно.
      // 18 хоногийн өмнө 3ш авсан → 30 хоног хүрнэ → 12 хоног үлдсэн
      const row = await rowFor(RO_PHONE);
      expect(row).toBeUndefined(); // 12 > 7 хязгаар
    });

    it('daysSupply = 0 бараа сануулгад орохгүй', async () => {
      const o = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э Сав ${T}`,
          customerPhone: SKIP_PHONE,
          ...UB_ADDR,
          items: [{ productId: skipProductId, qty: 1 }],
        })
        .expect(201);
      roOrderIds.push(o.body.id);
      await backdate(o.body.id, 90); // ямар ч тохиолдолд «дууссан» байх ёстой

      expect(await rowFor(SKIP_PHONE)).toBeUndefined();
    });

    it('цуцлагдсан захиалга сануулга үүсгэхгүй', async () => {
      const o = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э Цуцлагдсан ${T}`,
          customerPhone: CANCEL_PHONE,
          ...UB_ADDR,
          items: [{ productId: roProductId, qty: 1 }],
        })
        .expect(201);
      roOrderIds.push(o.body.id);
      await backdate(o.body.id, 20);
      expect(await rowFor(CANCEL_PHONE)).toBeDefined();

      await api()
        .patch(`/api/orders/${o.body.id}/status`)
        .set(auth(tok.admin))
        .send({ status: 'CANCELLED' })
        .expect(200);

      expect(await rowFor(CANCEL_PHONE)).toBeUndefined();
    });

    it('хэт хоцорсныг хаясан гэж үзэж хасна', async () => {
      // reorderMaxOverdue = 60. 10 хоног хүрэх бараа 200 хоногийн өмнө
      // авсан → 190 хоног хоцорсон → жагсаалтаас гарна
      await backdate(roOrderIds[1], 200);
      await backdate(roOrderIds[0], 200);
      expect(await rowFor(RO_PHONE)).toBeUndefined();
    });

    it('жолоочид үйлчлүүлэгчийн жагсаалт харах эрх байхгүй', async () => {
      await api().get('/api/reorders').set(auth(tok.driver)).expect(403);
    });
  });


  describe('V5: Нягтлангийн тайлан ⭐', () => {
    /**
     * Хамгийн чухал нь ДАВХАРДАХГҮЙ байх: бараа худалдан авалт нь
     * зарагдахдаа ЗБӨ болдог тул зардалд орвол өртөг хоёр дахин
     * тоологдоно. Буцаалт нь борлуулалтаас аль хэдийн хасагдсан.
     */
    it('санхүүгийн байрлал — авлага, өглөг, бараа материал', async () => {
      const res = await api()
        .get('/api/finance/position')
        .set(auth(tok.admin))
        .expect(200);
      for (const k of ['cash', 'receivable', 'payable', 'inventory', 'net']) {
        expect(res.body).toHaveProperty(k);
      }
      // Цэвэр = мөнгө + авлага + бараа − өглөг
      const n = (v: string) => Number(v);
      expect(n(res.body.net)).toBeCloseTo(
        n(res.body.cash) + n(res.body.receivable) + n(res.body.inventory) -
          n(res.body.payable),
        2,
      );
      expect(typeof res.body.productsWithoutCost).toBe('number');
    });

    it('байрлал нь орлогын эрхгүй хүнд хаалттай', async () => {
      await api().get('/api/finance/position').set(auth(tok.driver)).expect(403);
      await api().get('/api/finance/pnl').set(auth(tok.driver)).expect(403);
    });

    it('орлого тайлан — нийт ашиг ба цэвэр ашиг зөв бодогдоно', async () => {
      const res = await api()
        .get('/api/finance/pnl?from=2020-01-01&to=2099-12-31')
        .set(auth(tok.admin))
        .expect(200);
      const n = (v: string) => Number(v);
      expect(n(res.body.grossProfit)).toBeCloseTo(
        n(res.body.revenue) - n(res.body.cogs),
        2,
      );
      expect(n(res.body.netProfit)).toBeCloseTo(
        n(res.body.grossProfit) + n(res.body.otherIncome) -
          n(res.body.expenseTotal),
        2,
      );
      // Зардлын мөрүүдийн нийлбэр нь дүнтэй тэнцэнэ
      const sum = (res.body.expenses as Array<{ amount: string }>).reduce(
        (a, e) => a + Number(e.amount),
        0,
      );
      expect(sum).toBeCloseTo(n(res.body.expenseTotal), 2);
    });

    it('бараа худалдан авалт ба төлбөр тайланд ОРОХГҮЙ', async () => {
      const res = await api()
        .get('/api/finance/pnl?from=2020-01-01&to=2099-12-31')
        .set(auth(tok.admin))
        .expect(200);
      const labels = (res.body.expenses as Array<{ label: string }>).map(
        (e) => e.label,
      );
      // Эдгээр нь ЗБӨ/борлуулалттай давхардах тул зардалд гарч болохгүй
      expect(labels).not.toContain('Бараа худалдан авалт');
      expect(labels).not.toContain('Үйлчлүүлэгчид буцаалт');
      // Харин ил тод байлгахын тулд «ороогүй» жагсаалтад гарна
      const ex = (res.body.excluded as Array<{ label: string }>).map(
        (e) => e.label,
      );
      expect(ex).toContain('Захиалгын төлбөр');
      // Нэг нэрээр НЭГТГЭГДСЭН байх — 'PAYMENT' ба хуучин 'ORDER' хоёр
      // мөр болж нягтланг төөрөгдүүлдэг байв
      expect(ex.filter((l) => l === 'Захиалгын төлбөр')).toHaveLength(1);
    });

    it('орлого тайлан CSV татагдана', async () => {
      const res = await api()
        .get('/api/reports/pnl.csv?from=2020-01-01&to=2099-12-31')
        .set(auth(tok.admin))
        .expect(200);
      expect(res.headers['content-type']).toContain('csv');
      // Excel-д кирилл зөв гарах BOM
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(res.text).toContain('Борлуулалт');
      expect(res.text).toContain('ЦЭВЭР АШИГ');
      // Ангилал КОД-оор биш МОНГОЛ нэрээр гарна
      expect(res.text).not.toContain('DRIVER_PAYROLL');
    });

    it('санхүүгийн CSV ангиллыг монголоор гаргана', async () => {
      const res = await api()
        .get('/api/reports/finance.csv')
        .set(auth(tok.admin))
        .expect(200);
      expect(res.text).not.toContain('DRIVER_PAYROLL');
      expect(res.text).not.toContain('OTHER_INCOME');
    });
  });


  describe('V5: ОРЛОГО = ТӨЛБӨР хамгаалалт ⭐', () => {
    let paidOrderId: string;
    let payProductId: string;

    afterAll(async () => {
      if (paidOrderId) {
        await prisma.financeEntry.deleteMany({
          where: { refOrderId: paidOrderId },
        });
        await prisma.payment.deleteMany({ where: { orderId: paidOrderId } });
        await prisma.notification.deleteMany({ where: { refId: paidOrderId } });
        await prisma.orderItem.deleteMany({ where: { orderId: paidOrderId } });
        await prisma.order.deleteMany({ where: { id: paidOrderId } });
      }
      if (payProductId) {
        await prisma.stockMovement.deleteMany({
          where: { productId: payProductId },
        });
        await prisma.product.deleteMany({ where: { id: payProductId } });
      }
    });

    /**
     * ЯАГААД ЭНЭ ТЕСТ БАЙХ ЁСТОЙ ВЭ:
     *
     * Хуучин код захиалга үүсэх мөчид шууд ОРЛОГО бичдэг байсан —
     * төлбөр хүлээж авсан эсэхээс үл хамааран. Үүнээс болж 29
     * захиалгын 1,102,700₮ нь ОРЛОГО ба АВЛАГА хоёуланд нь давхар
     * зогсож, санхүүгийн тайлан 77%-иар хөөрөгдөж байв.
     *
     * Зарчим: ОРЛОГО = ТӨЛБӨР. Payment мөргүйгээр INCOME бичигдэхгүй.
     */
    it('төлсөн захиалга Payment + INCOME хоёуланг үүсгэнэ', async () => {
      const prod = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({ sku: `${SKU}-PAY`, name: `Э2Э Төлбөр ${T}`, price: '5000' })
        .expect(201);
      payProductId = prod.body.id;
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.admin))
        .send({ productId: payProductId, qtyChange: 10, reason: 'PURCHASE_IN' })
        .expect(201);

      const order = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э Төлбөрт ${T}`,
          customerPhone: `4${T}`,
          ...UB_ADDR,
          items: [{ productId: payProductId, qty: 2 }],
          paid: true,
        })
        .expect(201);
      paidOrderId = order.body.id;
      expect(order.body.paymentStatus).toBe('PAID');

      const payments = await prisma.payment.findMany({
        where: { orderId: paidOrderId },
      });
      const incomes = await prisma.financeEntry.findMany({
        where: { refOrderId: paidOrderId, type: 'INCOME' },
      });

      // Гурвуулаа байх ба ижил дүнтэй
      expect(payments).toHaveLength(1);
      expect(incomes).toHaveLength(1);
      expect(Number(incomes[0].amount)).toBe(Number(payments[0].amount));
      expect(Number(order.body.paidAmount)).toBe(Number(payments[0].amount));

      // ОРЛОГО нь тухайн ТӨЛБӨР рүү шууд заана — өнчин бичилт үүсэхгүй
      expect(incomes[0].refPaymentId).toBe(payments[0].id);
    });

    it('төлөөгүй захиалга ОРЛОГО үүсгэхГҮЙ', async () => {
      const order = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э Төлөөгүй ${T}`,
          customerPhone: `4${T}`,
          ...UB_ADDR,
          items: [{ productId: payProductId, qty: 1 }],
        })
        .expect(201);
      expect(order.body.paymentStatus).toBe('UNPAID');

      const incomes = await prisma.financeEntry.count({
        where: { refOrderId: order.body.id, type: 'INCOME' },
      });
      expect(incomes).toBe(0);

      // Цэвэрлэгээ
      await prisma.notification.deleteMany({ where: { refId: order.body.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.body.id } });
      await prisma.order.deleteMany({ where: { id: order.body.id } });
    });

    /**
     * Кодын ЯМАР Ч зам Payment-гүй INCOME үүсгэж болохгүй. Тестийн
     * явцад үүссэн бүх орлогыг шалгана — хуучин өгөгдөл биш, ЭНЭ
     * ажиллагааны кодын гаргалгааг.
     */
    it('тестийн явцад үүссэн бүх ОРЛОГО төлбөртэй холбоотой', async () => {
      const since = new Date(Date.now() - 10 * 60_000);
      const orphans = await prisma.financeEntry.findMany({
        where: {
          type: 'INCOME',
          entryDate: { gte: since },
          refPaymentId: null,
          // Гараар бүртгэсэн бусад орлого нь төлбөргүй байх нь хэвийн
          category: { notIn: ['OTHER_INCOME'] },
        },
        select: { id: true, category: true, amount: true, note: true },
      });
      expect(orphans).toEqual([]);
    });
  });


  describe('V5: Зөвхөн шилжүүлэг — залилангаас хамгаалах ⭐', () => {
    let fraudProductId: string;
    let fraudRequestId: string;
    let honestRequestId: string;
    let honestOrderId: string;
    let publicTok: string;
    const FRAUD_PHONE = `2${T.slice(0, 6)}7`;

    afterAll(async () => {
      for (const id of [fraudRequestId, honestRequestId].filter(Boolean)) {
        await prisma.notification.deleteMany({ where: { refId: id } });
        // Мөрүүд нь cascade-аар устдаг ч тодорхой байлгахын тулд
        await prisma.orderRequestItem.deleteMany({ where: { requestId: id } });
        await prisma.orderRequest.deleteMany({ where: { id } });
      }
      if (honestOrderId) {
        await prisma.financeEntry.deleteMany({
          where: { refOrderId: honestOrderId },
        });
        await prisma.payment.deleteMany({ where: { orderId: honestOrderId } });
        await prisma.notification.deleteMany({ where: { refId: honestOrderId } });
        await prisma.orderItem.deleteMany({
          where: { orderId: honestOrderId },
        });
        await prisma.order.deleteMany({ where: { id: honestOrderId } });
      }
      if (fraudProductId) {
        await prisma.stockMovement.deleteMany({
          where: { productId: fraudProductId },
        });
        await prisma.product.deleteMany({ where: { id: fraudProductId } });
      }
    });

    const submit = async () => {
      const res = await api()
        .post(`/api/public/order-requests?token=${publicTok}`)
        .field('customerName', `Э2Э Залилан ${T}`)
        .field('phone', FRAUD_PHONE)
        .field('channel', 'INSTAGRAM')
        .field('region', 'ULAANBAATAR')
        .field('district', 'ХУД')
        .field('khoroo', '1')
        .field('building', '1')
        .attach('proof', PNG, { filename: 'proof.png', contentType: 'image/png' })
        .field('items', JSON.stringify([{ productId: fraudProductId, qty: 1 }]))
        .expect(201);
      requestIds.push(res.body.id);
      return res.body.id as string;
    };

    it('бэлтгэл', async () => {
      const prod = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({ sku: `${SKU}-FRAUD`, name: `Э2Э Залилан ${T}`, price: '50000' })
        .expect(201);
      fraudProductId = prod.body.id;
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.admin))
        .send({ productId: fraudProductId, qtyChange: 10, reason: 'PURCHASE_IN' })
        .expect(201);

      const link = await api()
        .get('/api/order-requests/link')
        .set(auth(tok.admin))
        .expect(200);
      publicTok = link.body.token;
    });

    /**
     * ⭐ ГОЛ ДҮРЭМ: үйлчлүүлэгчийн «Төлбөрөө хийсэн» товч нь МЭДҮҮЛЭГ.
     * Ажилтан данс дээрээ мөнгийг хараагүй бол захиалга үүсэхгүй.
     */
    it('«төлсөн» гэж мэдүүлсэн ч баталгаажуулаагүй бол захиалга үүсэхгүй', async () => {
      fraudRequestId = await submit();

      const res = await api()
        .post(`/api/order-requests/${fraudRequestId}/convert`)
        .set(auth(tok.admin))
        .send({ paymentConfirmed: false })
        .expect(400);
      expect(res.body.message).toContain('баталгаажуулаагүй');

      // Хүсэлт хөндөгдөөгүй, үлдэгдэл хөдлөөгүй
      const req = await prisma.orderRequest.findUniqueOrThrow({
        where: { id: fraudRequestId },
      });
      expect(req.status).toBe('NEW');
      expect(req.orderId).toBeNull();
    });

    /**
     * Линкээр захиалахын тулд ЭХЛЭЭД шилжүүлж, баримтаа хавсаргана.
     * «Дараа төлнө» гэсэн зам байхгүй — компани бэлэн мөнгөөр
     * үйлчлэхгүй тул баримтгүй хүсэлт нь ажилтанд шалгах юмгүй,
     * зөвхөн дарааллыг дүүргэдэг.
     */
    it('баримтгүй бол нийтийн хүсэлт хүлээж авахгүй', async () => {
      const res = await api()
        .post(`/api/public/order-requests?token=${publicTok}`)
        .field('customerName', `Э2Э Баримтгүй ${T}`)
        .field('phone', FRAUD_PHONE)
        .field('channel', 'INSTAGRAM')
        .field('region', 'ULAANBAATAR')
        .field('district', 'ХУД')
        .field('khoroo', '1')
        .field('building', '1')
        .field('items', JSON.stringify([{ productId: fraudProductId, qty: 1 }]))
        .expect(400);
      expect(res.body.message).toContain('баримт');
    });

    it('баримттай хүсэлт «төлсөн гэсэн» тэмдэгтэй үүснэ', async () => {
      const id = await submit();
      const req = await prisma.orderRequest.findUniqueOrThrow({
        where: { id },
      });
      expect(req.paid).toBe(true);
      expect(req.paymentProofUrl).toBeTruthy();
      // Цэвэрлэгээнд орохын тулд
      await prisma.orderRequestItem.deleteMany({ where: { requestId: id } });
      await prisma.notification.deleteMany({ where: { refId: id } });
      await prisma.orderRequest.deleteMany({ where: { id } });
    });

    it('баталгаажуулалтын талбаргүй бол хүлээж авахгүй', async () => {
      await api()
        .post(`/api/order-requests/${fraudRequestId}/convert`)
        .set(auth(tok.admin))
        .send({})
        .expect(400);
    });

    it('мөнгө ороогүй хүсэлтийг шалтгаантай татгалзана', async () => {
      const res = await api()
        .post(`/api/order-requests/${fraudRequestId}/reject`)
        .set(auth(tok.admin))
        .send({ reason: 'Дансанд мөнгө ороогүй' })
        .expect(201);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejectReason).toBe('Дансанд мөнгө ороогүй');
    });

    it('баталгаажуулсан бол захиалга ТӨЛСӨН төлөвтэй үүснэ', async () => {
      honestRequestId = await submit();
      const order = await api()
        .post(`/api/order-requests/${honestRequestId}/convert`)
        .set(auth(tok.admin))
        .send({ paymentConfirmed: true })
        .expect(201);
      honestOrderId = order.body.id;
      expect(order.body.paymentStatus).toBe('PAID');

      // Төлбөр нь ЗӨВХӨН ШИЛЖҮҮЛЭГ байна — бэлэн мөнгө системд байхгүй
      const payments = await prisma.payment.findMany({
        where: { orderId: honestOrderId },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0].method).toBe('TRANSFER');
    });

    it('бэлэн мөнгөөр төлбөр бүртгэх боломжгүй', async () => {
      const res = await api()
        .post(`/api/orders/${honestOrderId}/payments`)
        .set(auth(tok.admin))
        .send({ amount: '1000', method: 'CASH' })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('Хэлбэр буруу');
    });
  });


  describe('V5: Аюулгүй байдал — файл ба толгой ⭐', () => {
    let secProductId: string;
    let productImageUrl: string;
    let proofOrderId: string;

    afterAll(async () => {
      if (proofOrderId) {
        await prisma.notification.deleteMany({ where: { refId: proofOrderId } });
        await prisma.orderItem.deleteMany({ where: { orderId: proofOrderId } });
        await prisma.order.deleteMany({ where: { id: proofOrderId } });
      }
      if (secProductId) {
        await prisma.stockMovement.deleteMany({
          where: { productId: secProductId },
        });
        await prisma.product.deleteMany({ where: { id: secProductId } });
      }
    });

    it('бэлтгэл — зурагтай бараа', async () => {
      const prod = await api()
        .post('/api/products')
        .set(auth(tok.admin))
        .send({ sku: `${SKU}-SEC`, name: `Э2Э Аюулгүй ${T}`, price: '1000' })
        .expect(201);
      secProductId = prod.body.id;

      const withImg = await api()
        .post(`/api/products/${secProductId}/image`)
        .set(auth(tok.admin))
        .attach('image', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(201);
      productImageUrl = withImg.body.imageUrl;
      expect(productImageUrl).toMatch(/^\/api\/uploads\/[a-f0-9]{32}\.png$/);
    });

    /**
     * ⭐ Барааны зураг нь НИЙТИЙН захиалгын хуудсанд гардаг —
     * үйлчлүүлэгч нэвтэрдэггүй тул нээлттэй байх ЁСТОЙ.
     */
    it('барааны зураг нэвтрэлтгүйгээр нээгдэнэ', async () => {
      const res = await api().get(productImageUrl).expect(200);
      expect(res.headers['content-type']).toContain('image/png');
      // Браузер агуулгыг нь таамаглахгүй байх толгой
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    /**
     * ⭐ Гүйлгээний баримт, хүргэлтийн зураг нь хувийн мэдээлэл
     * агуулдаг — нэвтрэлтгүйгээр хаагдсан байх ЁСТОЙ.
     * (Өмнө нь ServeStaticModule guard-гүй үйлчилдэг тул задарч байв.)
     */
    it('баримтын зураг нэвтрэлтгүйд ХААЛТТАЙ', async () => {
      const order = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: `Э2Э Баримт ${T}`,
          customerPhone: `3${T}`,
          ...UB_ADDR,
          items: [{ productId: productId, qty: 1 }],
        })
        .expect(201);
      proofOrderId = order.body.id;

      // Барааны зураг БИШ файл нэр — DB-д бүртгэлгүй тул хаалттай
      const name = productImageUrl.split('/').pop()!;
      const other = name.replace(/^./, name[0] === 'a' ? 'b' : 'a');

      await api().get(`/api/uploads/${other}`).expect(401);
      // Нэвтэрсэн хүнд 404 (файл байхгүй) — 401 биш
      await api()
        .get(`/api/uploads/${other}`)
        .set(auth(tok.admin))
        .expect(404);
    });

    it('зам гарах оролдлого таслагдана', async () => {
      // Нэвтрэлтгүйд 401 — файл байгаа эсэхийг ч мэдэгдэхгүй нь зөв
      await api().get('/api/uploads/..%2F..%2Fpackage.json').expect(401);
      // Нэвтэрсэн хүнд нэрийн шалгалт: hex+өргөтгөл биш бол 400
      await api()
        .get('/api/uploads/..%2F..%2Fpackage.json')
        .set(auth(tok.admin))
        .expect(400);
      await api()
        .get('/api/uploads/not-a-valid-name.png')
        .set(auth(tok.admin))
        .expect(400);
    });

    /**
     * ⭐ Клиентийн зарласан mimetype хуурамчлагдана. Файлын ЖИНХЭНЭ
     * агуулгыг (magic bytes) шалгах ёстой — эс тэгвэл HTML/скрипт
     * агуулгатай файл зураг нэрээр сервер дээр хадгалагдана.
     */
    it('зураг биш агуулгыг зураг гэж хуурч болохгүй', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      const res = await api()
        .post(`/api/products/${secProductId}/image`)
        .set(auth(tok.admin))
        .attach('image', html, { filename: 'x.png', contentType: 'image/png' })
        .expect(400);
      expect(res.body.message).toContain('Зураг биш');
    });

    it('аюулгүй байдлын HTTP толгойнууд байна', async () => {
      const res = await api().get('/api/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      // Framework-ээ зарлахгүй
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });


  describe('V5: Талбарын уртын хязгаар ⭐', () => {
    /**
     * Өмнө нь DTO-нуудад @MaxLength огт байхгүй байсан тул 10,000
     * тэмдэгт нэр амжилттай хадгалагддаг байв. Ийм өгөгдөл нь
     * хүснэгт, тайлан, CSV экспортыг эвдэж, DB-г хөөнө.
     *
     * ХЯЗГААР НЬ БОДИТ ХЭРЭГЛЭЭНД ТОХИРСОН БАЙХ ЁСТОЙ — хэт чанга
     * тавибал жинхэнэ монгол хаяг, нэр татгалзана. Тиймээс хоёр
     * талаас нь шалгана.
     */
    const long = (n: number) => 'А'.repeat(n);

    it('хэт урт утга татгалзана', async () => {
      const res = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          customerName: long(10000),
          customerPhone: `9${T}`,
          ...UB_ADDR,
          items: [{ productId, qty: 1 }],
        })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('customerName');
    });

    it('тэмдэглэл, хаягийн дэлгэрэнгүйд ч хязгаар үйлчилнэ', async () => {
      await api()
        .post('/api/stock/adjust')
        .set(auth(tok.admin))
        .send({
          productId,
          qtyChange: 1,
          reason: 'CORRECTION',
          note: long(5000),
        })
        .expect(400);
    });

    it('ЖИНХЭНЭ урт өгөгдөл татгалзахгүй', async () => {
      const order = await api()
        .post('/api/orders')
        .set(auth(tok.admin))
        .send({
          // Бодит монгол нэр, хаяг урт байж болно
          customerName: 'Батбаярын Мөнх-Очирын Ганзориг-Эрдэнэбилэг',
          customerPhone: `9${T}`,
          region: 'ULAANBAATAR',
          district: 'ХУД',
          khoroo: '11-р хороо',
          building: '13-р хорооллын 4-р байрны ард талын шинэ цамхаг',
          entrance: '2',
          floor: '4',
          door: '32',
          addressDetail: 'Гуравдугаар эмнэлгийн урдуур '.repeat(8),
          items: [{ productId, qty: 1 }],
        })
        .expect(201);
      lengthOrderId = order.body.id;
    });

    it('жолоочийн бүсийн массивт хязгаар байна', async () => {
      const res = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: `e2e-zones-${T}@ursgal.mn`,
          password: 'zones123',
          name: `Э2Э Бүс ${T}`,
          role: 'DRIVER',
          feePerDelivery: '1000',
          zones: Array.from({ length: 50 }, () => 'ХУД'),
        })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('zones');
    });
  });


  describe('V5: Аюулгүй байдлын мөшгилт ⭐', () => {
    const SEC_EMAIL = `e2e-sec-${T}@ursgal.mn`;

    afterAll(async () => {
      await prisma.activityLog.deleteMany({ where: { entity: 'security' } });
    });

    /**
     * ActivityLogInterceptor нь зөвхөн АМЖИЛТТАЙ өөрчлөлтийг бичдэг
     * бөгөөд `/auth/`-ыг бүрэн алгасдаг байв. Тиймээс «хэн орох гэж
     * оролдоод чадаагүй», «хэн эрхээсээ хэтрэх гэж үзсэн» гэдгийг
     * мөшгих ямар ч зам байсангүй.
     */
    it('амжилтгүй нэвтрэлт бүртгэгдэнэ', async () => {
      const before = await prisma.activityLog.count({
        where: { action: 'LOGIN_FAILED' },
      });

      await api()
        .post('/api/auth/login')
        .send({ email: SEC_EMAIL, password: 'буруу-нууц-үг' })
        .expect(401);

      const rows = await prisma.activityLog.findMany({
        where: { action: 'LOGIN_FAILED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(
        await prisma.activityLog.count({ where: { action: 'LOGIN_FAILED' } }),
      ).toBe(before + 1);

      // Бүртгэлгүй хаяг тул хэрэглэгч танигдаагүй
      expect(rows[0].userId).toBeNull();
      const meta = rows[0].meta as { email?: string; ip?: string };
      // ⭐ Имэйл БҮТНЭЭР хадгалагдахгүй — лог өөрөө задралын эх
      // сурвалж болох ёсгүй
      expect(meta.email).not.toBe(SEC_EMAIL);
      expect(meta.email).toContain('***');
      expect(meta.email).toContain('@ursgal.mn');
    });

    /**
     * ⭐ Хамгийн үнэ цэнэтэй дохио: НЭВТЭРСЭН хүн эрхээсээ хэтрэх
     * гэж оролдсон нь.
     */
    it('403 бүртгэгдэж, хэн юуг оролдсон нь тодорхой байна', async () => {
      await api().get('/api/finance/summary').set(auth(tok.driver)).expect(403);

      const row = await prisma.activityLog.findFirst({
        where: { action: 'FORBIDDEN' },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).not.toBeNull();
      expect(row!.entity).toBe('security');
      // Хэн оролдсоныг мэдэх ёстой
      expect(row!.userId).toBeTruthy();
      const meta = row!.meta as { method?: string; path?: string };
      expect(meta.method).toBe('GET');
      expect(meta.path).toContain('/finance/summary');
    });

    it('403 хариу ӨӨРЧЛӨГДӨӨГҮЙ байх ёстой', async () => {
      // Бүртгэл нь хариуг хөндөхгүй — зөвхөн тэмдэглэнэ
      const res = await api()
        .get('/api/users')
        .set(auth(tok.driver))
        .expect(403);
      expect(res.body.message).toBeTruthy();
      expect(res.body.statusCode).toBe(403);
    });

    /**
     * Ердийн 401 нь токен хугацаа дуусах бүрд, автомат сканнерээс
     * тасралтгүй гардаг. Бичвэл хүснэгт хогоор дүүрч жинхэнэ дохио
     * алдагдана — тиймээс ЗОРИУД бүртгэхгүй.
     */
    it('токенгүй хандалт (401) бүртгэлийг дүүргэхгүй', async () => {
      const before = await prisma.activityLog.count({
        where: { entity: 'security' },
      });
      for (let i = 0; i < 5; i++) {
        await api().get('/api/orders').expect(401);
      }
      expect(
        await prisma.activityLog.count({ where: { entity: 'security' } }),
      ).toBe(before);
    });
  });


  describe('V5: Нэвтрэлтийн түүх ⭐', () => {
    let histUserId: string;
    let histToken: string;
    const HIST_EMAIL = `e2e-hist-${T}@ursgal.mn`;

    afterAll(async () => {
      if (histUserId) {
        await prisma.loginHistory.deleteMany({ where: { userId: histUserId } });
        await prisma.refreshToken.deleteMany({ where: { userId: histUserId } });
        await prisma.user.deleteMany({ where: { id: histUserId } });
      }
    });

    /**
     * Өмнө нь зөвхөн User.lastLoginAt шинэчлэгддэг байсан тул
     * «хаанаас, ямар төхөөрөмжөөр орсон бэ» гэдэгт хариулах ямар ч
     * зам байсангүй.
     */
    it('нэвтрэхэд төхөөрөмж ба IP бүртгэгдэнэ', async () => {
      const created = await api()
        .post('/api/users')
        .set(auth(tok.admin))
        .send({
          email: HIST_EMAIL,
          password: 'hist123',
          name: `Э2Э Түүх ${T}`,
          role: 'MANAGER',
        })
        .expect(201);
      histUserId = created.body.id;

      const login = await api()
        .post('/api/auth/login')
        .set(
          'User-Agent',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
            'AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
        )
        .send({ email: HIST_EMAIL, password: 'hist123' })
        .expect(200);
      histToken = login.body.accessToken;

      const rows = await api()
        .get('/api/auth/login-history')
        .set(auth(histToken))
        .expect(200);

      expect(rows.body).toHaveLength(1);
      // Хүн уншихуйц болгосон байх — түүхий User-Agent биш
      expect(rows.body[0].device).toBe('Safari · iOS');
      expect(rows.body[0].at).toBeTruthy();
    });

    it('өөр төхөөрөмжөөс орвол тусад нь бүртгэгдэнэ', async () => {
      await api()
        .post('/api/auth/login')
        .set(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            'Chrome/120.0 Safari/537.36',
        )
        .send({ email: HIST_EMAIL, password: 'hist123' })
        .expect(200);

      const rows = await api()
        .get('/api/auth/login-history')
        .set(auth(histToken))
        .expect(200);
      expect(rows.body).toHaveLength(2);
      // Хамгийн сүүлийнх нь эхэнд
      expect(rows.body[0].device).toBe('Chrome · Windows');
    });

    /**
     * ⭐ Хэрэглэгч ЗӨВХӨН өөрийнхөө түүхийг харна — бусдын нэвтрэлт
     * хаанаас болсныг мэдэх нь өөрөө мэдээлэл задралт.
     */
    it('зөвхөн ӨӨРИЙН түүх харагдана', async () => {
      const mine = await api()
        .get('/api/auth/login-history')
        .set(auth(tok.admin))
        .expect(200);
      const ids = (mine.body as Array<{ id: string }>).map((r) => r.id);

      const theirs = await prisma.loginHistory.findMany({
        where: { userId: histUserId },
        select: { id: true },
      });
      for (const row of theirs) {
        expect(ids).not.toContain(row.id);
      }
    });

    it('амжилтгүй нэвтрэлт түүхэд ОРОХГҮЙ', async () => {
      const before = await prisma.loginHistory.count({
        where: { userId: histUserId },
      });
      await api()
        .post('/api/auth/login')
        .send({ email: HIST_EMAIL, password: 'буруу' })
        .expect(401);
      expect(
        await prisma.loginHistory.count({ where: { userId: histUserId } }),
      ).toBe(before);
    });
  });

});

import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ActivityLogInterceptor } from './activity-log/activity-log.interceptor';
import { ActivityLogModule } from './activity-log/activity-log.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthThrottlerGuard } from './auth/guards/auth-throttler.guard';
import { PasswordChangeGuard } from './auth/guards/password-change.guard';
import { AllExceptionsFilter } from './logging/all-exceptions.filter';
import { LoggingModule } from './logging/logging.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CategoriesModule } from './categories/categories.module';
import { PrismaModule } from './prisma/prisma.module';
import { CompaniesModule } from './companies/companies.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DeliveryModule } from './delivery/delivery.module';
import { FinanceModule } from './finance/finance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrderRequestsModule } from './order-requests/order-requests.module';
import { OrdersModule } from './orders/orders.module';
import { PermissionsGuard } from './permissions/permissions.guard';
import { PermissionsModule } from './permissions/permissions.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { ProductsModule } from './products/products.module';
import { BatchesModule } from './batches/batches.module';
import { ReordersModule } from './reorders/reorders.module';
import { UploadsModule } from './uploads/uploads.module';
import { StockModule } from './stock/stock.module';
import { SuppliesModule } from './supplies/supplies.module';
import { UsersModule } from './users/users.module';
import { WarehouseModule } from './warehouse/warehouse.module';

@Module({
  imports: [
    // Rate limit (V4-07) — global guard БИШ: зөвхөн auth route-ууд
    /**
     * Хязгаар нь БҮХ endpoint-д хамаарна (V5). Өмнө нь ThrottlerModule
     * бүртгэгдсэн ч глобал guard байхгүй байсан тул зөвхөн auth
     * route-уудад л үйлчилж, бусад зам brute-force, scraping,
     * санамсаргүй давталтад нээлттэй байв.
     *
     * ЛИМИТ ЯАГААД ӨНДӨР ВЭ: throttler нь IP-гээр тоолдог. Оффисын
     * 20 ажилтан нэг NAT IP-гээр гардаг тул хамтдаа минутанд мянга
     * гаруй хүсэлт хийж болно — хэт бага тавибал бодит ажил тасална.
     * Энэ хязгаар нь DoS/хуулалтаас хамгаалах зорилготой, хэрэглэгч
     * тус бүрийн хязгаар БИШ. Нэвтрэлтийн хатуу хязгаар (5/мин) нь
     * auth.controller-т тусдаа хэвээр.
     */
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: parseInt(process.env.GLOBAL_RATE_LIMIT ?? '', 10) || 2000,
      },
    ]),
    // frontend/dist-ийг нэг порт дээрээс serve хийнэ:
    // /api/* backend-д, бусад бүх зам SPA-ийн index.html руу.
    // uploads/ нь ЭНД БИШ — UploadsModule-ээр эрхийн хамгаалалттай
    // үйлчлэгдэнэ (V5). ServeStatic нь guard-аар дамждаггүй тул
    // гүйлгээний баримт, хүргэлтийн зураг нэвтрэлтгүй задардаг байв.
    ServeStaticModule.forRoot(
      {
        rootPath: join(__dirname, '..', '..', 'frontend', 'dist'),
        exclude: ['/api/{*path}'],
        serveStaticOptions: {
          setHeaders: (res: ServerResponse, path: string) => {
            if (path.endsWith('.html')) {
              // index.html хэзээ ч cache-лэгдэхгүй — шинэ build шууд очно
              res.setHeader('Cache-Control', 'no-store');
            } else if (path.includes('/assets/')) {
              // hash-тай asset-ууд — урт хугацааны cache
              res.setHeader(
                'Cache-Control',
                'public, max-age=31536000, immutable',
              );
            }
          },
        },
      },
    ),
    PrismaModule,
    PermissionsModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    StockModule,
    BatchesModule,
    UploadsModule,
    ReordersModule,
    OrdersModule,
    OrderRequestsModule,
    DashboardModule,
    DeliveryModule,
    FinanceModule,
    NotificationsModule,
    ActivityLogModule,
    CompaniesModule,
    CustomersModule,
    SettingsModule,
    AnalyticsModule,
    ReportsModule,
    SuppliesModule,
    UsersModule,
    WarehouseModule,
    LoggingModule,
  ],
  controllers: [AppController],
  providers: [
    // Дараалал чухал: эхлээд JWT (Public-ийг үл хамааруулна), дараа нь Roles,
    // сүүлд Permissions (@RequirePermission заасан route дээр л оролцоно)
    /**
     * Rate-limit нь бүх route-д — JWT-ээс ӨМНӨ ажиллана.
     * AuthThrottlerGuard нь ThrottlerGuard-ыг өргөтгөж 429-ийн
     * мессежийг монголоор өгдөг. Route бүрийн @Throttle тохиргоог
     * хэвээр уншина.
     *
     * ЗӨВХӨН ЭНЭ ГУУДАН БАЙХ ЁСТОЙ: route дээр давхар
     * @UseGuards(AuthThrottlerGuard) тавибал нэг хүсэлт ХОЁР удаа
     * тоологдож, тухайн route-ын хязгаар хагасална.
     */
    { provide: APP_GUARD, useClass: AuthThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Түр нууц үгтэй хэрэглэгчийг солитол нь түгжинэ (V4-06)
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Амжилттай өөрчлөлт бүрийг ActivityLog-д бичнэ
    { provide: APP_INTERCEPTOR, useClass: ActivityLogInterceptor },
    // Catch болоогүй 500-уудыг файлд логлоно (V4-14)
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  /**
   * АЮУЛГҮЙ БАЙДЛЫН HTTP ТОЛГОЙ (V5).
   *
   * Өмнө нь CSP, nosniff, HSTS, X-Frame-Options аль нь ч байхгүй,
   * X-Powered-By нь framework-ээ зарладаг байв.
   *
   * ЯАГААД main.ts БИШ ЭНД ВЭ: bootstrap дахь `app.use()` нь зөвхөн
   * production-ы entry point дээр ажилладаг тул тест орчинд
   * үйлчлэхгүй — өөрөөр хэлбэл ХАМГААЛАЛТ ТЕСТЭЭР БАРИГДАХГҮЙ.
   * Модулийн middleware болгосноор хаана ч ажиллана.
   */
  configure(consumer: MiddlewareConsumer) {
    // cookie-parser ЭНД (main.ts-д биш): bootstrap дахь app.use() нь
    // тест орчинд ажилладаггүй тул refresh cookie тестээр баригдахгүй
    // байх байсан — helmet-тэй ижил шалтгаан (V5)
    consumer.apply(cookieParser()).forRoutes('*');
    consumer
      .apply(
        helmet({
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind
              imgSrc: ["'self'", 'data:', 'blob:'],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", 'data:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          },
          crossOriginResourcePolicy: { policy: 'same-site' },
        }),
      )
      .forRoutes('*');
  }
}

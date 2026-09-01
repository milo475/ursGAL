import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ActivityLogInterceptor } from './activity-log/activity-log.interceptor';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { PasswordChangeGuard } from './auth/guards/password-change.guard';
import { AllExceptionsFilter } from './logging/all-exceptions.filter';
import { LoggingModule } from './logging/logging.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CategoriesModule } from './categories/categories.module';
import { PrismaModule } from './prisma/prisma.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DeliveryModule } from './delivery/delivery.module';
import { FinanceModule } from './finance/finance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PermissionsGuard } from './permissions/permissions.guard';
import { PermissionsModule } from './permissions/permissions.module';
import { PortalModule } from './portal/portal.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { ProductsModule } from './products/products.module';
import { StockModule } from './stock/stock.module';
import { UploadsModule } from './media/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Rate limit (V4-07) — global guard БИШ: зөвхөн auth route-ууд
    // @UseGuards(ThrottlerGuard)-аар ашиглана
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
    // frontend/dist-ийг нэг порт дээрээс serve хийнэ:
    // /api/* backend-д, бусад бүх зам SPA-ийн index.html руу.
    // uploads/ — баталгаажуулах зургууд ОДОО задгай ServeStatic-ээр БИШ,
    // эрхийн шалгалттай UploadsController (/api/uploads/:filename)-оор
    // очно (R-1). Тиймээс энд зөвхөн frontend/dist-ийг serve хийнэ.
    ServeStaticModule.forRoot({
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
    }),
    PrismaModule,
    PermissionsModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    StockModule,
    OrdersModule,
    DashboardModule,
    DeliveryModule,
    FinanceModule,
    NotificationsModule,
    ActivityLogModule,
    PortalModule,
    CustomersModule,
    SettingsModule,
    AnalyticsModule,
    ReportsModule,
    UsersModule,
    LoggingModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [
    // Дараалал чухал: эхлээд JWT (Public-ийг үл хамааруулна), дараа нь Roles,
    // сүүлд Permissions (@RequirePermission заасан route дээр л оролцоно)
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
export class AppModule {}

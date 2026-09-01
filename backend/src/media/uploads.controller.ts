import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { JwtPayload } from '../auth/auth.service';
import { Public } from '../auth/decorators/public.decorator';
import { Role } from '../generated/prisma/client';
import { PERM } from '../permissions/permission-keys';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { UPLOADS_DIR } from '../uploads.config';

/**
 * Байршуулсан баталгаажуулах зургийг ЭРХИЙН ШАЛГАЛТТАЙ serve хийнэ (R-1).
 *
 * Урьд нь /api/uploads-ийг ServeStaticModule задгай (нэвтрэлтгүй) serve
 * хийдэг байсан — хэн ч URL мэдвэл зургийг татдаг байв. Одоо энэ endpoint
 * дараах хүнд Л зөвшөөрнө:
 *   - ADMIN
 *   - orders.view эрхтэй ажилтан (MANAGER/OPERATOR г.м.)
 *   - тухайн захиалгад хуваарилагдсан жолооч
 *   - тухайн захиалгыг эзэмшигч онлайн харилцагч
 * Бусад бүх тохиолдолд 403.
 *
 * <img> таг Authorization header илгээдэггүй тул токеныг header-ЭСВЭЛ
 * ?token= query-гээр хүлээн авна — /notifications/stream (SSE)-тэй ижил
 * тогтсон загвар. @Public — global JwtAuthGuard-ыг тойрч, токеныг энд
 * гараар шалгана (суурь guard-ын логик хэвээр).
 */
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  @Public()
  @Get(':filename')
  async serve(
    @Param('filename') filename: string,
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // 1. Нэрийн хатуу загвар — сервер өгдөг hex нэр (path traversal хаана)
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(filename)) {
      throw new NotFoundException('Файл олдсонгүй');
    }

    // 2. Токеныг header ЭСВЭЛ query-гээс шалгана. Эрхээ батлаагүй бүх
    // тохиолдолд (токенгүй, хүчингүй, идэвхгүй) 403 — файл байгаа эсэхийг
    // нэвтрэлтгүй хүнд задруулахгүй, эзэмшил шалгалттай (403) нэгэн ижил.
    const header = req.headers.authorization;
    const bearer =
      header && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer ?? queryToken;
    const denied = new ForbiddenException('Энэ файлыг үзэх эрх байхгүй');
    if (!token) throw denied;

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw denied;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw denied;

    // 3. Энэ файлыг ямар захиалга эзэмшдэгийг олно
    const order = await this.prisma.order.findFirst({
      where: { deliveryProofUrl: `/api/uploads/${filename}` },
      select: { assignedDriverId: true, customerId: true },
    });
    if (!order) {
      throw new NotFoundException('Файл олдсонгүй');
    }

    // 4. Эрх: ADMIN | staff(orders.view) | хуваарилагдсан жолооч | эзэмшигч
    let allowed = user.role === Role.ADMIN;
    if (!allowed && order.assignedDriverId === user.id) allowed = true;
    if (!allowed && order.customerId === user.id) allowed = true;
    if (!allowed) {
      allowed = await this.permissions.has(
        user.id,
        user.role,
        PERM.ORDERS_VIEW,
      );
    }
    if (!allowed) {
      throw denied;
    }

    // 5. Serve — nosniff-тэй. Нэр аль хэдийн хатуу шүүгдсэн ч давхар
    // хамгаалалт: шийдэгдсэн зам UPLOADS_DIR дотор байхыг батална.
    const filePath = normalize(join(UPLOADS_DIR, filename));
    if (!filePath.startsWith(normalize(UPLOADS_DIR)) || !existsSync(filePath)) {
      throw new NotFoundException('Файл олдсонгүй');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // ETag-д санамсаргүй нэрийг ашиглана (агуулга нь нэрээрээ тодорхойлогддог)
    res.setHeader('ETag', createHash('sha1').update(filename).digest('hex'));
    res.sendFile(filePath);
  }
}

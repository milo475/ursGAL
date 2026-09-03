import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Observable, defer, switchMap } from 'rxjs';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import type { SseEvent } from './notifications.service';

class QueryNotificationsDto {
  @IsOptional()
  @IsBooleanString()
  unread?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** Бүх route зөвхөн өөрийн мэдэгдэл дээр ажиллана — эрхийн шалгалт хэрэггүй */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Stream-ийн ТАСАЛБАР (V5).
   *
   * EventSource header дэмждэггүй тул ямар нэг зүйл query-гээр явахаас
   * аргагүй. Өмнө нь 15 минут хүчинтэй ACCESS TOKEN явдаг байсан нь
   * сервер/proxy-ийн логт үлдэж болзошгүй байв — тэр токеноор БҮХ API
   * нээгддэг.
   *
   * Одоо ердийн header-ээр нэвтэрч тасалбар авна: 60 секунд амьдардаг,
   * purpose='sse' тул stream нээхээс өөр ЮУНД Ч хэрэглэгдэхгүй.
   * Логт үлдсэн ч ашиглах цонх нь хэдхэн секунд.
   */
  @Get('stream-ticket')
  async streamTicket(@CurrentUser() user: AuthUser) {
    const ticket = await this.jwt.signAsync(
      { sub: user.id, purpose: 'sse' },
      { secret: process.env.JWT_SECRET, expiresIn: '60s' },
    );
    return { ticket };
  }

  /** SSE stream (V4-09) — зөвхөн дээрх тасалбараар нээгдэнэ */
  @Public()
  @Sse('stream')
  stream(@Query('ticket') ticket: string): Observable<SseEvent> {
    return defer(async () => {
      let payload: JwtPayload & { purpose?: string };
      try {
        payload = await this.jwt.verifyAsync(ticket ?? '', {
          secret: process.env.JWT_SECRET,
        });
      } catch {
        throw new UnauthorizedException('Stream ticket хүчингүй');
      }
      // Ердийн access token-ыг ЭНД хүлээж авахгүй — тасалбар л байна
      if (payload.purpose !== 'sse') {
        throw new UnauthorizedException('Stream ticket хүчингүй');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true },
      });
      if (!user?.isActive) {
        throw new UnauthorizedException('Stream ticket хүчингүй');
      }
      return user.id;
    }).pipe(switchMap((userId) => this.notificationsService.subscribe(userId)));
  }

  @Get()
  list(@Query() query: QueryNotificationsDto, @CurrentUser() user: AuthUser) {
    return this.notificationsService.list(
      user.id,
      query.unread === 'true',
      query.page,
      query.limit,
    );
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notificationsService.markRead(user.id, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllRead(user.id);
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * ДЕМО ХЭРЭГЛЭГЧ — ЗӨВХӨН УНШИХ.
 *
 * DEMO_READONLY_USERS (таслалаар тусгаарласан нэвтрэх нэрс) дахь
 * хэрэглэгч зөвхөн GET/HEAD хийнэ; үүсгэх/засах/устгах бүх хүсэлт 403.
 * Нээлттэй демо (ochir.mn «Жишээ ажлууд») дээр хэн ч өгөгдлийг эвдэж,
 * нууц үгийг сольж чадахгүй.
 *
 * JwtAuthGuard-ын ДАРАА бүртгэгдсэн тул req.user энд аль хэдийн
 * тодорсон байна. Public route-д (login, refresh) user байхгүй тул нэвтэрнэ.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Session-оо хаах нь өгөгдөл өөрчлөхгүй
const ALLOWED_WRITES = new Set(['/api/auth/logout']);

export function demoReadonlyUsers(): Set<string> {
  return new Set(
    (process.env.DEMO_READONLY_USERS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

@Injectable()
export class DemoReadonlyGuard implements CanActivate {
  private readonly users = demoReadonlyUsers();

  canActivate(context: ExecutionContext): boolean {
    if (this.users.size === 0) return true;
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const email = req.user?.email?.toLowerCase();
    if (!email || !this.users.has(email)) return true;
    if (SAFE.has(req.method)) return true;
    const path = (req.originalUrl ?? req.url).split('?')[0];
    if (ALLOWED_WRITES.has(path)) return true;
    throw new ForbiddenException('Демо горим — зөвхөн үзэх боломжтой');
  }
}

import type { Request, Response } from 'express';

/**
 * Refresh token-ий httpOnly cookie (V5).
 *
 * ЯАГААД: refresh token localStorage-д хадгалагдаж байсан нь XSS
 * амжилттай болсон тохиолдолд 7 хоногийн session бүтнээрээ хулгайд
 * алдагдана гэсэн үг байв. httpOnly cookie-д JS огт хүрч чадахгүй.
 *
 * SameSite=Strict — гадны сайтаас энэ cookie-той хүсэлт илгээгдэхгүй
 * тул CSRF-ээр refresh дуудуулах боломжгүй.
 *
 * path=/api/auth — зөвхөн auth endpoint-ууд руу явна: бусад бүх
 * хүсэлтэд илүүц ачаалал үүсгэхгүй, задрах талбай ч багасна.
 */
const COOKIE = 'ursgal_rt';
const WEEK_MS = 7 * 24 * 60 * 60_000; // refresh token-ий насжилттай ижил

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: WEEK_MS,
  });
}

export function readRefreshCookie(req: Request): string | null {
  const cookies = (req as { cookies?: Record<string, string> }).cookies;
  return cookies?.[COOKIE] ?? null;
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(COOKIE, { path: '/api/auth' });
}

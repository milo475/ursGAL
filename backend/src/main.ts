import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { UPLOADS_DIR } from './uploads.config';

async function bootstrap() {
  // uploads хавтас байхгүй бол үүсгэнэ (шинэ clone/production дээр ServeStatic алдахгүй)
  mkdirSync(UPLOADS_DIR, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Reverse proxy (nginx / Railway edge) ард ажиллах үед req.ip-г
  // X-Forwarded-For-оос авна — эс тэгвэл нэвтрэлтийн rate limit бүх
  // хэрэглэгчид нэг IP-гаар тоологдоно.
  if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set(
      'trust proxy',
      /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v,
    );
  }

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableCors({
    // Dev үед Vite (5173); production-д нэг порт тул CORS бараг хэрэггүй ч
    // тусдаа домэйнд байршуулбал CORS_ORIGIN-оор тохируулна
    // Таслалаар хэд хэдэн домэйн өгч болно
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

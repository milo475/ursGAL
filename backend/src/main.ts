import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UPLOADS_DIR } from './uploads.config';

async function bootstrap() {
  // uploads хавтас байхгүй бол үүсгэнэ (шинэ clone/production дээр ServeStatic алдахгүй)
  mkdirSync(UPLOADS_DIR, { recursive: true });

  const app = await NestFactory.create(AppModule);

  // Бүх response-д content-sniffing хамгаалалт (R-2 / Y-1). Хуурамч
  // MIME-тэй файлыг браузер өөрөө "тааж" өөр төрлөөр гүйцэтгэхээс сэргийлнэ.
  app.use((_req, res: ServerResponse, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

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
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

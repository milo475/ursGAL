import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Зөвшөөрөгдсөн файлын нэрийн хэлбэр: 32 hex + зургийн өргөтгөл.
 * Бидний өөрсдийн үүсгэдэг нэр яг ийм байдаг тул `../` зэрэг зам
 * гаргах оролдлого энд таслагдана.
 */
export const SAFE_UPLOAD_NAME = /^[a-f0-9]{32}\.(png|jpe?g|webp)$/i;

/**
 * БАЙРШУУЛСАН ФАЙЛД ХАНДАХ ЭРХ (V5).
 *
 * Өмнө нь `/api/uploads/*` нь ServeStaticModule-ээр үйлчлэгддэг
 * байсан бөгөөд guard-аар огт дамждаггүй тул НЭВТРЭЛТГҮЙГЭЭР хэн ч
 * татаж авах боломжтой байв. Тэнд гүйлгээний баримт, хүргэлтийн
 * баталгаажуулах зураг байдаг — хүлээн авагчийн хаяг, орчин
 * харагдаж болзошгүй.
 *
 * ХОЁР ТӨРӨЛ:
 *   Барааны зураг → НЭЭЛТТЭЙ. Нийтийн захиалгын хуудсанд гардаг,
 *     үйлчлүүлэгч нэвтэрдэггүй. Бүгдийг хаавал тэр хуудас эвдэрнэ.
 *   Бусад бүх файл → нэвтэрсэн хэрэглэгчид.
 *
 * Ялгааг Product.imageUrl-аар тогтооно — ингэснээр байгаа 581 файлыг
 * зөөх, DB-г шинэчлэх шаардлагагүй.
 */
@Injectable()
export class UploadAccessGuard extends AuthGuard('jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      params?: { name?: string };
    }>();
    const name = req.params?.name;

    if (name && SAFE_UPLOAD_NAME.test(name)) {
      const isProductImage = await this.prisma.product.count({
        where: { imageUrl: `/api/uploads/${name}` },
      });
      if (isProductImage > 0) return true;
    }

    // Бусад бүх тохиолдолд ердийн JWT шалгалт
    return (await super.canActivate(context)) as boolean;
  }
}

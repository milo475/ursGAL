import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UploadsController } from './uploads.controller';

/**
 * Баталгаажуулах зургийг эрхийн шалгалттай serve хийх модуль (R-1).
 * PrismaService, PermissionsService нь @Global; JwtService-ийг query
 * токен шалгахад JwtModule.register({})-ээс авна (notifications-тэй ижил).
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [UploadsController],
})
export class UploadsModule {}

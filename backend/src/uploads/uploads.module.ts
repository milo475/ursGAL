import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadAccessGuard } from './upload-access.guard';

@Module({
  controllers: [UploadsController],
  providers: [UploadAccessGuard],
})
export class UploadsModule {}

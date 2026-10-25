import { Global, Module } from '@nestjs/common';
import { KycCryptoService } from '../kyc/kyc-crypto.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { FILE_STORAGE, FileLinks, fileStorageFor } from './file-storage';
import { FilesController } from './files.controller';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    FileLinks,
    KycCryptoService,
    {
      provide: FILE_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => fileStorageFor(c),
    },
  ],
  exports: [FileLinks, KycCryptoService, FILE_STORAGE],
})
export class FilesModule {}

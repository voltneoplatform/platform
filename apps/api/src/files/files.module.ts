import { Global, Module } from '@nestjs/common';
import { KycCryptoService } from '../kyc/kyc-crypto.service';
import { FILE_STORAGE, FileLinks, LocalFileStorage } from './file-storage';
import { FilesController } from './files.controller';

@Global()
@Module({
  controllers: [FilesController],
  providers: [FileLinks, KycCryptoService, { provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [FileLinks, KycCryptoService, FILE_STORAGE],
})
export class FilesModule {}

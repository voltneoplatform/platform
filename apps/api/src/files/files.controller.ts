import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { FILE_STORAGE, FileLinks, type FileStorage } from './file-storage';

@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly links: FileLinks,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /**
   * Serves a private file from a signed, short-lived link. The link itself is
   * the permission: it is issued only by routes that check the role and log
   * the view.
   */
  @Public()
  @Get(':token')
  async serve(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const link = this.links.verify(token);
    if (!link) throw new NotFoundException('This link has expired. Open the document again.');
    let file;
    try {
      file = await this.storage.open(link.k);
    } catch {
      throw new NotFoundException('File not found');
    }
    res.setHeader('Content-Type', link.t);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `inline; filename="${link.n.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    );
    file.stream.pipe(res);
  }
}

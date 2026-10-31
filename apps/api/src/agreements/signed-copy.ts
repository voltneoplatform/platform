import { BadRequestException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { MAX_UPLOAD_BYTES, checkUpload } from '../files/file-storage';

/** A scanned agreement can be larger than a single photo. */
export const MAX_SIGNED_PDF_BYTES = 25 * 1024 * 1024;
/** Photos of every page, one per page. */
export const MAX_SIGNED_PHOTOS = 20;

export interface SignedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

/**
 * The signed agreement as one PDF: either a single scanned PDF (up to 25 MB),
 * or photos of the pages (JPEG or PNG, up to 10 MB each, at most 20), joined
 * in the order uploaded, one A4 page each.
 */
export async function assembleSignedCopy(
  files: readonly SignedFile[] | undefined,
  agreementNumber: string,
): Promise<{ buffer: Buffer; name: string; pages: number | null }> {
  const list = files ?? [];
  if (!list.length) {
    throw new BadRequestException(
      'Attach the signed agreement: one PDF scan, or photos of every page',
    );
  }
  const checked = list.map((f) => ({ f, c: checkUpload(f, MAX_SIGNED_PDF_BYTES) }));
  const pdfs = checked.filter((x) => x.c.ext === 'pdf');
  if (pdfs.length) {
    if (list.length > 1) {
      throw new BadRequestException('Upload either one PDF, or photos of the pages, not both');
    }
    return { buffer: list[0]!.buffer, name: checked[0]!.c.originalName, pages: null };
  }
  if (list.length > MAX_SIGNED_PHOTOS) {
    throw new BadRequestException(`Upload at most ${MAX_SIGNED_PHOTOS} photos`);
  }
  for (const { f, c } of checked) {
    if (c.ext === 'webp') throw new BadRequestException('Page photos must be JPEG or PNG');
    if (f.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`Each page photo must be at most 10 MB (${c.originalName})`);
    }
  }

  const doc = new PDFDocument({
    autoFirstPage: false,
    info: { Title: `${agreementNumber} signed` },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  for (const { f, c } of checked) {
    doc.addPage({ size: 'A4', margin: 0 });
    try {
      doc.image(f.buffer, 0, 0, {
        fit: [doc.page.width, doc.page.height],
        align: 'center',
        valign: 'center',
      });
    } catch {
      throw new BadRequestException(`Could not read the photo ${c.originalName}`);
    }
  }
  doc.end();
  return { buffer: await done, name: `${agreementNumber}-signed.pdf`, pages: checked.length };
}

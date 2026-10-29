import PDFDocument from 'pdfkit';
import { COMPANY, companyIdentity } from '@voltneo/shared';
import type { Lang } from './texts';

/**
 * Fonts under the SIL Open Font License that pdfkit shapes correctly: Hind
 * Siliguri for Bengali (Noto Sans Bengali loses some word spaces in pdfkit),
 * Noto Sans Devanagari for Hindi and Noto Sans for English. The Bengali and
 * Devanagari fonts also contain Latin letters, digits and the rupee sign, so
 * mixed text (names, plan codes) prints in one font.
 */
const FONT_FILES: Record<Lang, { regular: string; bold: string }> = {
  EN: {
    regular: '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf',
    bold: '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf',
  },
  BN: {
    regular: '@expo-google-fonts/hind-siliguri/400Regular/HindSiliguri_400Regular.ttf',
    bold: '@expo-google-fonts/hind-siliguri/700Bold/HindSiliguri_700Bold.ttf',
  },
  HI: {
    regular: '@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf',
    bold: '@expo-google-fonts/noto-sans-devanagari/700Bold/NotoSansDevanagari_700Bold.ttf',
  },
};

const resolved = new Map<string, string>();
function fontPath(spec: string): string {
  let p = resolved.get(spec);
  if (!p) {
    p = require.resolve(spec);
    resolved.set(spec, p);
  }
  return p;
}

const INK = '#1a1a1a';
const MUTED = '#5c5c5c';
const RULE = '#cfcfcf';
const MARGIN = { top: 48, bottom: 64, left: 48, right: 48 };

export interface PdfInfo {
  title: string;
  createdAt: Date;
}

/** A small layout helper over pdfkit: headings, label/value rows, tables, footers. */
export class Pdf {
  readonly doc: PDFKit.PDFDocument;

  constructor(lang: Lang, info: PdfInfo) {
    this.doc = new PDFDocument({
      size: 'A4',
      margins: MARGIN,
      bufferPages: true,
      info: {
        Title: info.title,
        Author: `Volt Neo (${COMPANY.legalName})`,
        Creator: 'Volt Neo platform',
        CreationDate: info.createdAt,
      },
    });
    this.doc.registerFont('regular', fontPath(FONT_FILES[lang].regular));
    this.doc.registerFont('bold', fontPath(FONT_FILES[lang].bold));
    this.doc.font('regular').fontSize(10).fillColor(INK);
  }

  get width(): number {
    return this.doc.page.width - MARGIN.left - MARGIN.right;
  }

  private get bottom(): number {
    return this.doc.page.height - MARGIN.bottom;
  }

  /** Starts a new page if fewer than `height` points are left. */
  ensure(height: number): void {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  brand(title: string, subtitle?: string): void {
    const d = this.doc;
    d.font('bold').fontSize(16).fillColor(INK).text('Volt Neo', MARGIN.left, MARGIN.top);
    d.font('regular').fontSize(9).fillColor(MUTED).text('Neo Own');
    // The company behind the brand (L14). The legal name stays in English in every language.
    d.font('regular').fontSize(7.5).fillColor(MUTED);
    for (const line of companyIdentity()) d.text(line, { width: this.width });
    d.moveDown(0.6);
    d.font('bold').fontSize(14).fillColor(INK).text(title);
    if (subtitle) d.font('regular').fontSize(9).fillColor(MUTED).text(subtitle);
    d.moveDown(0.6);
    d.fillColor(INK);
  }

  banner(text: string, tone: 'warn' | 'info'): void {
    const d = this.doc;
    d.font('bold').fontSize(9);
    const h = d.heightOfString(text, { width: this.width - 16 }) + 10;
    this.ensure(h + 6);
    const y = d.y;
    d.save()
      .rect(MARGIN.left, y, this.width, h)
      .fill(tone === 'warn' ? '#fdecc8' : '#e3ecf7')
      .restore();
    d.fillColor(tone === 'warn' ? '#6b4300' : '#173a63').text(text, MARGIN.left + 8, y + 5, {
      width: this.width - 16,
    });
    d.fillColor(INK).font('regular').fontSize(10);
    d.y = y + h + 6;
    d.x = MARGIN.left;
  }

  sectionTitle(text: string): void {
    this.ensure(30);
    this.doc.moveDown(0.4);
    this.doc.font('bold').fontSize(11).fillColor(INK).text(text, MARGIN.left);
    this.doc.moveDown(0.2);
    this.doc.font('regular').fontSize(10);
  }

  note(text: string): void {
    this.doc.font('regular').fontSize(9).fillColor(MUTED).text(text, MARGIN.left, undefined, {
      width: this.width,
    });
    this.doc.fillColor(INK).fontSize(10).moveDown(0.3);
  }

  /** A paragraph of body text. */
  paragraph(text: string, fontSize = 11): void {
    this.doc.font('regular').fontSize(fontSize).fillColor(INK).text(text, MARGIN.left, undefined, {
      width: this.width,
      lineGap: 2,
    });
    this.doc.fontSize(10).moveDown(0.8);
  }

  /** Label/value rows with a rule between them; long values wrap. */
  rows(rows: readonly (readonly [string, string])[], labelShare = 0.42, fontSize = 10): void {
    const d = this.doc;
    const lw = Math.round(this.width * labelShare);
    const vw = this.width - lw - 10;
    d.fontSize(fontSize);
    for (const [label, value] of rows) {
      const lh = d.font('bold').heightOfString(label, { width: lw });
      const vh = d.font('regular').heightOfString(value || '—', { width: vw });
      const h = Math.max(lh, vh) + 8;
      this.ensure(h);
      const y = d.y;
      d.font('bold')
        .fillColor(MUTED)
        .text(label, MARGIN.left, y + 4, { width: lw });
      d.font('regular')
        .fillColor(INK)
        .text(value || '—', MARGIN.left + lw + 10, y + 4, { width: vw });
      d.moveTo(MARGIN.left, y + h)
        .lineTo(MARGIN.left + this.width, y + h)
        .lineWidth(0.5)
        .strokeColor(RULE)
        .stroke();
      d.y = y + h;
    }
    d.x = MARGIN.left;
    d.fontSize(10).fillColor(INK);
  }

  /** A simple table; the header row repeats on each new page. */
  table(
    columns: readonly { title: string; share: number; align?: 'left' | 'right' }[],
    rows: readonly (readonly string[])[],
  ): void {
    const d = this.doc;
    const widths = columns.map((c) => this.width * c.share);
    const drawRow = (cells: readonly string[], bold: boolean) => {
      d.font(bold ? 'bold' : 'regular').fontSize(9.5);
      const h =
        Math.max(...cells.map((c, i) => d.heightOfString(c, { width: widths[i]! - 8 }))) + 6;
      if (d.y + h > this.bottom) {
        d.addPage();
        if (!bold)
          drawRow(
            columns.map((c) => c.title),
            true,
          );
        d.font(bold ? 'bold' : 'regular').fontSize(9.5);
      }
      const y = d.y;
      let x = MARGIN.left;
      cells.forEach((c, i) => {
        d.text(c, x + 4, y + 3, { width: widths[i]! - 8, align: columns[i]!.align ?? 'left' });
        x += widths[i]!;
      });
      d.moveTo(MARGIN.left, y + h)
        .lineTo(MARGIN.left + this.width, y + h)
        .lineWidth(bold ? 0.8 : 0.4)
        .strokeColor(bold ? MUTED : RULE)
        .stroke();
      d.y = y + h;
    };
    this.ensure(40);
    drawRow(
      columns.map((c) => c.title),
      true,
    );
    for (const r of rows) drawRow(r, false);
    d.x = MARGIN.left;
    d.font('regular').fontSize(10);
  }

  /** Signature lines, side by side. */
  signatures(boxes: readonly { label: string; sub?: string }[]): void {
    const d = this.doc;
    this.ensure(80);
    d.moveDown(1.5);
    const y = d.y + 30;
    const w = (this.width - 20 * (boxes.length - 1)) / boxes.length;
    boxes.forEach((b, i) => {
      const x = MARGIN.left + i * (w + 20);
      d.moveTo(x, y)
        .lineTo(x + w, y)
        .lineWidth(0.7)
        .strokeColor(MUTED)
        .stroke();
      d.font('regular')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(b.label, x, y + 4, { width: w });
      if (b.sub) d.text(b.sub, x, undefined, { width: w });
    });
    d.y = y + 40;
    d.x = MARGIN.left;
    d.fillColor(INK).fontSize(10);
  }

  /** Writes a footer on every page, then returns the finished file. */
  finish(footer: (page: number, of: number) => { left: string; right: string }): Promise<Buffer> {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      const { left, right } = footer(i + 1, range.count);
      const y = d.page.height - MARGIN.bottom + 18;
      d.page.margins.bottom = 0;
      d.font('regular').fontSize(7.5).fillColor(MUTED);
      d.text(left, MARGIN.left, y, { width: this.width * 0.75, lineBreak: true });
      d.text(right, MARGIN.left + this.width * 0.75, y, {
        width: this.width * 0.25,
        align: 'right',
      });
      d.page.margins.bottom = MARGIN.bottom;
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      d.on('data', (c: Buffer) => chunks.push(c));
      d.on('end', () => resolve(Buffer.concat(chunks)));
      d.on('error', reject);
      d.end();
    });
  }
}

import PDFDocument from 'pdfkit';
import { COMPANY, amountInWords, formatRupees, type ScheduleLine } from '@voltneo/shared';
import type { Block, Part } from './agreement-text';
import { registerFonts } from './pdf';

const INK = '#111111';
const MUTED = '#555555';
const RULE = '#bbbbbb';
/** A4 in points. The wider left margin leaves room for binding. */
const PAGE = { width: 595.28, height: 841.89 };
const M = { top: 56, bottom: 96, left: 66, right: 54 };
/** The top half of page 1 stays blank for the stamp paper's printed area (founder, 31 Oct 2026). */
export const STAMP_SPACE = PAGE.height / 2;

export interface SignatureBox {
  heading: string;
  lines: string[];
  thumb?: boolean;
}

/**
 * Lays out the printed agreement: page 1 starts halfway down, every page has a
 * footer with the agreement number, page number and initial boxes, and the
 * draft banner (while the wording is unreviewed) heads every page.
 */
export class AgreementPdf {
  readonly doc: PDFKit.PDFDocument;
  private readonly width = PAGE.width - M.left - M.right;

  constructor(
    title: string,
    private readonly draftBanner: string | null,
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      margins: M,
      bufferPages: true,
      info: {
        Title: title,
        Author: `Volt Neo (${COMPANY.legalName})`,
        Creator: 'Volt Neo platform',
      },
    });
    registerFonts(this.doc, 'EN');
    this.doc.font('regular').fontSize(10).fillColor(INK);
    this.doc.on('pageAdded', () => this.banner());
    this.doc.y = STAMP_SPACE;
    this.banner();
  }

  private get bottom() {
    return PAGE.height - M.bottom;
  }

  private banner() {
    if (!this.draftBanner) return;
    const d = this.doc;
    const y = d.y;
    d.font('bold').fontSize(8);
    const h = d.heightOfString(this.draftBanner, { width: this.width - 12 }) + 8;
    d.save().rect(M.left, y, this.width, h).fill('#fdecc8').restore();
    d.fillColor('#6b4300').text(this.draftBanner, M.left + 6, y + 4, { width: this.width - 12 });
    d.fillColor(INK).font('regular').fontSize(10);
    d.x = M.left;
    d.y = y + h + 8;
  }

  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  newPage() {
    this.doc.addPage();
  }

  title(text: string, sub?: string) {
    const d = this.doc;
    d.font('bold').fontSize(14).fillColor(INK).text(text, M.left, undefined, {
      width: this.width,
      align: 'center',
    });
    if (sub) {
      d.font('regular')
        .fontSize(9)
        .fillColor(MUTED)
        .text(sub, { width: this.width, align: 'center' });
    }
    d.fillColor(INK).moveDown(0.8);
  }

  centered(text: string) {
    this.ensure(24);
    this.doc.font('bold').fontSize(10.5).text(text, M.left, undefined, {
      width: this.width,
      align: 'center',
    });
    this.doc.moveDown(0.5);
  }

  /** Body text, justified; segments marked bold are set in bold. */
  para(text: string | readonly { text: string; bold?: boolean }[], opts: { indent?: number } = {}) {
    const d = this.doc;
    const parts = typeof text === 'string' ? [{ text }] : text;
    const indent = opts.indent ?? 0;
    d.fontSize(10).fillColor(INK);
    const plain = parts.map((p) => p.text).join('');
    this.ensure(Math.min(60, d.heightOfString(plain, { width: this.width - indent }) + 4));
    parts.forEach((p, i) => {
      d.font(p.bold ? 'bold' : 'regular').text(
        p.text,
        i === 0 ? M.left + indent : undefined,
        undefined,
        {
          width: this.width - indent,
          align: 'justify',
          lineGap: 1.5,
          continued: i < parts.length - 1,
        },
      );
    });
    d.moveDown(0.45);
    d.x = M.left;
  }

  /** A numbered or bulleted list, Indian style: (a), (b), (c). */
  list(items: readonly string[], ordered: boolean) {
    const d = this.doc;
    items.forEach((item, i) => {
      const marker = ordered ? `(${String.fromCharCode(97 + i)})` : '•';
      d.font('regular').fontSize(10);
      const h = d.heightOfString(item, { width: this.width - 28 });
      this.ensure(h + 4);
      const y = d.y;
      d.text(marker, M.left + 6, y, { width: 22 });
      d.text(item, M.left + 28, y, { width: this.width - 28, align: 'justify', lineGap: 1.5 });
      d.moveDown(0.25);
    });
    d.moveDown(0.2);
    d.x = M.left;
  }

  blocks(blocks: readonly Block[]) {
    for (const b of blocks) {
      if (typeof b === 'string') this.para(b);
      else if ('ol' in b) this.list(b.ol, true);
      else this.list(b.ul, false);
    }
  }

  parts(parts: readonly Part[]) {
    for (const part of parts) {
      this.ensure(60);
      this.doc.moveDown(0.4);
      this.doc.font('bold').fontSize(11.5).text(part.title.toUpperCase(), M.left, undefined, {
        width: this.width,
      });
      this.doc.moveDown(0.4);
      for (const c of part.clauses) {
        this.ensure(40);
        this.doc.font('bold').fontSize(10).text(`${c.no}. ${c.title}`, M.left, undefined, {
          width: this.width,
        });
        this.doc.moveDown(0.2);
        this.blocks(c.blocks);
      }
    }
  }

  heading(text: string) {
    this.ensure(50);
    this.doc.moveDown(0.6);
    this.doc.font('bold').fontSize(11.5).text(text, M.left, undefined, { width: this.width });
    this.doc.moveDown(0.4);
    this.doc.font('regular').fontSize(10);
  }

  rows(rows: readonly (readonly [string, string])[]) {
    const d = this.doc;
    const lw = Math.round(this.width * 0.36);
    const vw = this.width - lw - 10;
    for (const [label, value] of rows) {
      d.fontSize(9.5);
      const h =
        Math.max(
          d.font('bold').heightOfString(label, { width: lw }),
          d.font('regular').heightOfString(value || '—', { width: vw }),
        ) + 8;
      this.ensure(h);
      const y = d.y;
      d.font('bold')
        .fillColor(MUTED)
        .text(label, M.left, y + 4, { width: lw });
      d.font('regular')
        .fillColor(INK)
        .text(value || '—', M.left + lw + 10, y + 4, { width: vw });
      d.moveTo(M.left, y + h)
        .lineTo(M.left + this.width, y + h)
        .lineWidth(0.5)
        .strokeColor(RULE)
        .stroke();
      d.y = y + h;
    }
    d.x = M.left;
    d.moveDown(0.5);
    d.fontSize(10).fillColor(INK);
  }

  table(
    columns: readonly { title: string; share: number; align?: 'left' | 'right' }[],
    rows: readonly (readonly string[])[],
  ) {
    const d = this.doc;
    const widths = columns.map((c) => this.width * c.share);
    const draw = (cells: readonly string[], bold: boolean) => {
      d.font(bold ? 'bold' : 'regular').fontSize(9);
      const h =
        Math.max(...cells.map((c, i) => d.heightOfString(c, { width: widths[i]! - 8 }))) + 6;
      if (d.y + h > this.bottom) {
        d.addPage();
        if (!bold)
          draw(
            columns.map((c) => c.title),
            true,
          );
        d.font(bold ? 'bold' : 'regular').fontSize(9);
      }
      const y = d.y;
      let x = M.left;
      cells.forEach((c, i) => {
        d.text(c, x + 4, y + 3, { width: widths[i]! - 8, align: columns[i]!.align ?? 'left' });
        x += widths[i]!;
      });
      d.moveTo(M.left, y + h)
        .lineTo(M.left + this.width, y + h)
        .lineWidth(bold ? 0.8 : 0.4)
        .strokeColor(bold ? MUTED : RULE)
        .stroke();
      d.y = y + h;
    };
    this.ensure(40);
    draw(
      columns.map((c) => c.title),
      true,
    );
    for (const r of rows) draw(r, false);
    d.x = M.left;
    d.moveDown(0.5);
    d.font('regular').fontSize(10);
  }

  /** Signature boxes, two per row, each with lines to write on and an optional thumb box. */
  signatureBoxes(boxes: readonly SignatureBox[]) {
    const d = this.doc;
    const colW = (this.width - 24) / 2;
    for (let i = 0; i < boxes.length; i += 2) {
      const row = boxes.slice(i, i + 2);
      const heights = row.map((b) => 26 + b.lines.length * 30 + (b.thumb ? 0 : 0));
      const h = Math.max(...heights, row.some((b) => b.thumb) ? 140 : 0);
      this.ensure(h + 10);
      const y = d.y;
      row.forEach((b, j) => {
        const x = M.left + j * (colW + 24);
        d.font('bold').fontSize(9).fillColor(INK).text(b.heading, x, y, { width: colW });
        let ly = d.y + 26;
        const lineW = b.thumb ? colW - 78 : colW;
        for (const label of b.lines) {
          d.moveTo(x, ly)
            .lineTo(x + lineW, ly)
            .lineWidth(0.6)
            .strokeColor(MUTED)
            .stroke();
          d.font('regular')
            .fontSize(8)
            .fillColor(MUTED)
            .text(label, x, ly + 3, { width: lineW });
          ly += 30;
        }
        if (b.thumb) {
          const tx = x + colW - 70;
          const ty = y + 22;
          d.rect(tx, ty, 70, 84).lineWidth(0.6).strokeColor(MUTED).stroke();
          d.font('regular')
            .fontSize(7)
            .fillColor(MUTED)
            .text('Left thumb impression (if not signing)', tx + 4, ty + 88, {
              width: 66,
              align: 'center',
            });
        }
      });
      d.y = y + h + 12;
      d.x = M.left;
      d.fillColor(INK).fontSize(10);
    }
  }

  /** A single line to sign on, with a label. */
  signLine(label: string) {
    this.signatureBoxes([{ heading: '', lines: [label] }]);
  }

  /** Footer on every page, then the finished file. */
  finish(left: string): Promise<Buffer> {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      d.page.margins.bottom = 0;
      const y = PAGE.height - M.bottom + 24;
      d.moveTo(M.left, y - 8)
        .lineTo(M.left + this.width, y - 8)
        .lineWidth(0.4)
        .strokeColor(RULE)
        .stroke();
      d.font('regular').fontSize(7.5).fillColor(MUTED);
      d.text(left, M.left, y, { width: this.width * 0.72 });
      d.text(`Page ${i + 1} of ${range.count}`, M.left + this.width * 0.72, y, {
        width: this.width * 0.28,
        align: 'right',
      });
      // Initial boxes: both parties initial every page.
      const by = y + 16;
      const boxes = ['Driver', 'For Volt Neo'];
      boxes.forEach((label, j) => {
        const x = M.left + j * 170;
        d.text(`Initials (${label})`, x, by + 8, { width: 80 });
        d.rect(x + 82, by, 70, 24)
          .lineWidth(0.5)
          .strokeColor(MUTED)
          .stroke();
      });
      d.page.margins.bottom = M.bottom;
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

export const rupeesWords = (paise: number) =>
  `${formatRupees(paise)} (${amountInWords(paise, 'EN')})`;
export type { ScheduleLine };

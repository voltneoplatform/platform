import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { PaymentLinksService } from './payment-links.service';

const PAGES = {
  PAID: {
    title: 'Already paid',
    lines: [
      'This payment link has already been paid. Thank you.',
      'এই পেমেন্ট লিংকে টাকা দেওয়া হয়ে গেছে। ধন্যবাদ।',
      'इस पेमेंट लिंक का भुगतान हो चुका है। धन्यवाद।',
    ],
  },
  CLOSED: {
    title: 'Link closed',
    lines: [
      'This payment link has expired or was replaced. Ask your Volt Neo agent for a new link.',
      'এই পেমেন্ট লিংকের মেয়াদ শেষ বা বদলে গেছে। নতুন লিংকের জন্য Volt Neo এজেন্টকে বলুন।',
      'इस पेमेंट लिंक की अवधि खत्म हो गई है या बदल दिया गया है। नए लिंक के लिए Volt Neo एजेंट से कहें।',
    ],
  },
  UNKNOWN: {
    title: 'Link not found',
    lines: [
      'This payment link was not found. Check the SMS or ask your Volt Neo agent.',
      'এই পেমেন্ট লিংক পাওয়া যায়নি। SMS দেখুন বা Volt Neo এজেন্টকে বলুন।',
      'यह पेमेंट लिंक नहीं मिला। SMS देखें या Volt Neo एजेंट से पूछें।',
    ],
  },
} as const;

function page(kind: keyof typeof PAGES): string {
  const p = PAGES[kind];
  const body = p.lines.map((l) => `<p>${l}</p>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Volt Neo: ${p.title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#16202b;line-height:1.5}h1{font-size:1.25rem}p{margin:0 0 .75rem}</style></head><body><h1>Volt Neo</h1>${body}</body></html>`;
}

/**
 * Short payment links sent by SMS: https://api.voltcompany.in/p/<code> forwards
 * to the gateway's payment page while the link is open (DLT allows only short
 * values in an SMS template). Outside /v1 so the address stays short.
 */
@ApiExcludeController()
@Controller('p')
export class PayLinkController {
  constructor(private readonly links: PaymentLinksService) {}

  @Public()
  @Get(':code')
  async open(@Param('code') code: string, @Res() res: Response) {
    const r = await this.links.resolveShortCode(code);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if ('redirect' in r) return res.redirect(302, r.redirect);
    res
      .status(r.closed === 'UNKNOWN' ? 404 : 410)
      .type('html')
      .send(page(r.closed));
  }
}

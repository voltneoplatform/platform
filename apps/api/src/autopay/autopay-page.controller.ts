import { randomBytes } from 'node:crypto';
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/gateway';
import { AutopayService } from './autopay.service';

type Lang = 'BN' | 'HI' | 'EN';

const T: Record<
  Lang,
  Record<
    'title' | 'opening' | 'button' | 'on' | 'wait' | 'failed' | 'gone' | 'back' | 'fake',
    string
  >
> = {
  EN: {
    title: 'Volt Neo UPI AutoPay',
    opening: 'Opening the secure Cashfree page. Approve the AutoPay request in your UPI app.',
    button: 'Continue',
    on: 'UPI AutoPay is on. Your instalment will be taken on each Due Date.',
    wait: 'Your bank is confirming the AutoPay. Go back to the Volt Neo app; it will show when it is on.',
    failed: 'AutoPay was not set up. Go back to the Volt Neo app and try again.',
    gone: 'This AutoPay request is no longer open. Start again from the Volt Neo app.',
    back: 'You can now go back to the Volt Neo app.',
    fake: 'Test server: no real gateway. Approve this request from the admin panel (agreement → AutoPay).',
  },
  BN: {
    title: 'Volt Neo UPI অটোপে',
    opening: 'নিরাপদ Cashfree পাতা খুলছে। আপনার UPI অ্যাপে অটোপে অনুরোধ মঞ্জুর করুন।',
    button: 'এগিয়ে যান',
    on: 'UPI অটোপে চালু হয়েছে। প্রতি কিস্তির তারিখে কিস্তি কাটা হবে।',
    wait: 'আপনার ব্যাংক অটোপে নিশ্চিত করছে। Volt Neo অ্যাপে ফিরে যান; চালু হলে দেখাবে।',
    failed: 'অটোপে চালু হয়নি। Volt Neo অ্যাপে ফিরে আবার চেষ্টা করুন।',
    gone: 'এই অটোপে অনুরোধ আর খোলা নেই। Volt Neo অ্যাপ থেকে আবার শুরু করুন।',
    back: 'এখন Volt Neo অ্যাপে ফিরে যেতে পারেন।',
    fake: 'টেস্ট সার্ভার: আসল গেটওয়ে নেই।',
  },
  HI: {
    title: 'Volt Neo UPI ऑटोपे',
    opening: 'सुरक्षित Cashfree पेज खुल रहा है। अपने UPI ऐप में ऑटोपे अनुरोध मंज़ूर करें।',
    button: 'आगे बढ़ें',
    on: 'UPI ऑटोपे चालू है। हर किस्त की तारीख पर किस्त कटेगी।',
    wait: 'आपका बैंक ऑटोपे की पुष्टि कर रहा है। Volt Neo ऐप पर लौटें; चालू होने पर दिखेगा।',
    failed: 'ऑटोपे चालू नहीं हुआ। Volt Neo ऐप पर लौटकर फिर से कोशिश करें।',
    gone: 'यह ऑटोपे अनुरोध अब खुला नहीं है। Volt Neo ऐप से फिर शुरू करें।',
    back: 'अब आप Volt Neo ऐप पर लौट सकते हैं।',
    fake: 'टेस्ट सर्वर: असली गेटवे नहीं है।',
  },
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function shell(lang: Lang, body: string, head = ''): string {
  const t = T[lang];
  return `<!doctype html><html lang="${lang === 'EN' ? 'en' : lang === 'BN' ? 'bn' : 'hi'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#16202b;line-height:1.5}h1{font-size:1.25rem;color:#0f2a44}p{margin:0 0 .75rem}button{font-size:1.05rem;padding:.8rem 1.4rem;border:0;border-radius:10px;background:#0b5cd5;color:#fff}</style>${head}</head><body><h1>${esc(t.title)}</h1>${body}</body></html>`;
}

/**
 * The page the Driver App opens to approve UPI AutoPay:
 * https://api.voltcompany.in/autopay/<code>. It starts Cashfree's subscription
 * checkout (JS SDK v3, subscriptionsCheckout) with the mandate's session; the
 * gateway returns the driver to /autopay/<code>/done. Outside /v1, like /p/<code>.
 * REQUIRES VALIDATION in the Cashfree sandbox.
 */
@ApiExcludeController()
@Controller('autopay')
export class AutopayPageController {
  constructor(
    private readonly autopay: AutopayService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Public()
  @Get(':code')
  async open(@Param('code') code: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const m = await this.autopay.byCode(code);
    const lang = (m?.driver.language as Lang | undefined) ?? 'EN';
    const t = T[lang];
    if (!m || m.status !== 'PENDING' || !m.sessionId) {
      return res
        .status(m ? 410 : 404)
        .type('html')
        .send(shell(lang, `<p>${esc(t.gone)}</p>`));
    }
    if (this.gateway.name !== 'cashfree') {
      return res
        .type('html')
        .send(
          shell(lang, `<p>${esc(T.EN.fake)}</p>${lang === 'EN' ? '' : `<p>${esc(t.fake)}</p>`}`),
        );
    }
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'nonce-${nonce}' https://sdk.cashfree.com`,
        "style-src 'unsafe-inline'",
        'connect-src https://*.cashfree.com',
        'frame-src https://*.cashfree.com',
        'img-src https: data:',
        "form-action 'self' https:",
        "base-uri 'none'",
      ].join('; '),
    );
    const mode = this.gateway.autopayMode ?? 'sandbox';
    const script = `<script src="https://sdk.cashfree.com/js/v3/cashfree.js" nonce="${nonce}"></script><script nonce="${nonce}">
function go(){var cf=Cashfree({mode:${JSON.stringify(mode)}});cf.subscriptionsCheckout({subsSessionId:${JSON.stringify(m.sessionId)},redirectTarget:"_self"}).then(function(r){if(r&&r.error){document.getElementById("err").textContent=r.error.message||"Error";}});}
document.addEventListener("DOMContentLoaded",function(){document.getElementById("go").addEventListener("click",go);go();});
</script>`;
    return res
      .type('html')
      .send(
        shell(
          lang,
          `<p>${esc(t.opening)}</p><p><button id="go">${esc(t.button)}</button></p><p id="err" style="color:#c0262d"></p>`,
          script,
        ),
      );
  }

  @Public()
  @Get(':code/done')
  async done(@Param('code') code: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const m = await this.autopay.afterApproval(code);
    const found = await this.autopay.byCode(code);
    const lang = (found?.driver.language as Lang | undefined) ?? 'EN';
    const t = T[lang];
    const line = !m
      ? t.gone
      : m.status === 'ACTIVE'
        ? t.on
        : m.status === 'PENDING'
          ? t.wait
          : t.failed;
    return res
      .status(m ? 200 : 404)
      .type('html')
      .send(shell(lang, `<p>${esc(line)}</p><p>${esc(t.back)}</p>`));
  }
}

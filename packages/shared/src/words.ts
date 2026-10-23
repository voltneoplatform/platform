/**
 * Amounts in words for agreement documents (clause B1: "stated in figures and
 * words"). Uses the Indian system: thousand, lakh, crore.
 *
 * REQUIRES VALIDATION: the Bengali and Hindi number words and phrasing must be
 * checked by a native speaker before documents are used with drivers.
 */

import type { Paise } from './money';

export type WordsLanguage = 'BN' | 'HI' | 'EN';

const EN_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

// prettier-ignore
const HI = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
];

// prettier-ignore
const BN = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চোদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
  'কুড়ি', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আঠাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বাহান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'অষ্টাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

interface Vocabulary {
  below100(n: number): string;
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
}

const VOCAB: Record<WordsLanguage, Vocabulary> = {
  EN: {
    below100: (n) =>
      n < 20 ? EN_ONES[n]! : EN_TENS[Math.floor(n / 10)]! + (n % 10 ? `-${EN_ONES[n % 10]}` : ''),
    hundred: 'hundred',
    thousand: 'thousand',
    lakh: 'lakh',
    crore: 'crore',
  },
  HI: { below100: (n) => HI[n]!, hundred: 'सौ', thousand: 'हज़ार', lakh: 'लाख', crore: 'करोड़' },
  BN: { below100: (n) => BN[n]!, hundred: 'শত', thousand: 'হাজার', lakh: 'লক্ষ', crore: 'কোটি' },
};

/** A whole number in words, Indian grouping. */
export function numberInWords(n: number, lang: WordsLanguage): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Expected a whole number ≥ 0');
  const v = VOCAB[lang];
  if (n === 0) return v.below100(0);
  const out: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  let rest = n % 10_000_000;
  if (crore) out.push(numberInWords(crore, lang), v.crore);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  if (lakh) out.push(v.below100(lakh), v.lakh);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) out.push(v.below100(thousand), v.thousand);
  const hundred = Math.floor(rest / 100);
  rest %= 100;
  if (hundred) out.push(v.below100(hundred), v.hundred);
  if (rest) out.push(v.below100(rest));
  return out.join(' ');
}

/** An amount in words as written on a cheque, e.g. "Rupees seventy-four thousand only". */
export function amountInWords(amount: Paise, lang: WordsLanguage): string {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError('Expected paise ≥ 0');
  const rupees = Math.floor(amount / 100);
  const paise = amount % 100;
  const r = numberInWords(rupees, lang);
  const p = paise ? numberInWords(paise, lang) : null;
  switch (lang) {
    case 'EN':
      return `Rupees ${r}${p ? ` and ${p} paise` : ''} only`;
    case 'HI':
      return `${r} रुपये${p ? ` और ${p} पैसे` : ''} मात्र`;
    case 'BN':
      return `${r} টাকা${p ? ` এবং ${p} পয়সা` : ''} মাত্র`;
  }
}

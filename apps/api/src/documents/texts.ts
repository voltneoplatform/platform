import { COMPANY } from '@voltneo/shared';

/**
 * Wording for Schedule 1, Schedule 5, receipts and receipt messages, in the
 * driver's language. English follows the Plain-Language Draft V1.
 *
 * REQUIRES VALIDATION: none of this wording has been reviewed by a lawyer, and
 * the Bengali and Hindi translations must be checked by native speakers before
 * any document is used with a driver. Every PDF says so in a banner.
 */

export type Lang = 'BN' | 'HI' | 'EN';

export interface Texts {
  languageName: Record<Lang, string>;
  draftBanner: string;
  previewBanner: string;
  schedule1Title: string;
  schedule5Title: string;
  agreementNo: string;
  driver: string;
  phone: string;
  vehicle: string;
  plan: string;
  planValue: (name: string, code: string, version: number) => string;
  batteryType: string;
  downPayment: string;
  monthlyInstalment: string;
  numberOfInstalments: string;
  totalPayable: string;
  dueDate: string;
  dueDateValue: (day: number) => string;
  firstDueDate: string;
  lastDueDate: string;
  lateFee: string;
  lateFeeValue: (fee: string, grace: number, cap: number, max: string) => string;
  gst: string;
  gstValue: string;
  nominee: string;
  paymentTable: string;
  colNumber: string;
  colDueDate: string;
  colAmount: string;
  downPaymentRow: string;
  beforeInstallation: string;
  driverSignature: string;
  date: string;
  forVoltNeo: string;
  nameAndId: string;
  // Schedule 5 (key facts)
  k5Intro: string;
  k5PayNow: string;
  k5PayMonthly: string;
  k5PayMonthlyValue: (amount: string, day: number, months: number) => string;
  k5Total: string;
  k5Yours: string;
  k5YoursValue: (lastDue: string) => string;
  k5Late: string;
  k5LateValue: (grace: number, fee: string, cap: number, max: string) => string;
  k5NoPay: string;
  k5NoPayValue: (days: number) => string;
  k5Early: string;
  k5EarlyValue: string;
  k5Cannot: string;
  k5CannotValue: string;
  k5Stolen: string;
  k5StolenValue: string;
  k5Repair: string;
  k5RepairValue: (hours: number) => string;
  k5Confirm: (language: string) => string;
  k5ExplainedBy: string;
  // Receipt
  receiptTitle: string;
  receiptNo: string;
  receivedAt: string;
  amountReceived: string;
  method: string;
  reference: string;
  collectedBy: string;
  paidTowards: string;
  allocDownPayment: string;
  allocInstalment: (n: number, due: string) => string;
  allocLateFee: (date: string) => string;
  allocExcess: string;
  balanceAfter: string;
  receiptValidity: string;
  receiptSms: (p: {
    amount: string;
    agreement: string;
    date: string;
    receipt: string;
    balance: string;
  }) => string;
  page: (n: number, of: number) => string;
  // Collections messages (SMS)
  reminderSms: (p: {
    amount: string;
    agreement: string;
    dueDate: string;
    today: boolean;
  }) => string;
  finalNoticeSms: (p: {
    amount: string;
    agreement: string;
    disableFrom: string;
    fee: string;
  }) => string;
  immobilisedSms: (p: { amount: string; agreement: string }) => string;
  restoredSms: (p: { agreement: string }) => string;
  // Schedule 8 and M4 messages
  certificateTitle: string;
  certificateNo: string;
  agreementDate: string;
  battery: string;
  totalPaid: string;
  paidInFullOn: string;
  ownershipPassedOn: string;
  gpsOffOn: string;
  certificateBody: (p: {
    driver: string;
    agreement: string;
    agreementDate: string;
    serial: string;
    transferDate: string;
    gpsOffDate: string;
  }) => string;
  certificateKeep: string;
  authorisedSignatory: string;
  transferredSms: (p: { agreement: string; serial: string; certificate: string }) => string;
  ticketReceivedSms: (p: { ticket: string; hours: number }) => string;
  ticketResolvedSms: (p: { ticket: string }) => string;
  paymentLinkSms: (p: { amount: string; agreement: string; url: string; until: string }) => string;
  /** Sign-in code by SMS (staff now, drivers in M6). */
  signInCodeSms: (p: { code: string; minutes: string }) => string;
}

/**
 * English SMS write "Rs" instead of "₹": the rupee sign is not in the basic SMS
 * alphabet and would turn an English SMS into Unicode, which holds 70 instead
 * of 160 characters per part. Bengali and Hindi are Unicode anyway.
 */
const rs = (amount: string) => amount.replace(/₹\s?/g, 'Rs ');

const EN: Texts = {
  languageName: { BN: 'Bengali', HI: 'Hindi', EN: 'English' },
  draftBanner: 'DRAFT WORDING: not yet reviewed by a lawyer. Not for use with drivers.',
  previewBanner: 'Preview: this agreement is not signed yet.',
  schedule1Title: 'Schedule 1: Your plan',
  schedule5Title: 'Schedule 5: Key facts',
  agreementNo: 'Agreement number',
  driver: 'Driver',
  phone: 'Phone',
  vehicle: 'Vehicle',
  plan: 'Plan',
  planValue: (name, code, v) => `${name} (${code}, version ${v})`,
  batteryType: 'Battery type',
  downPayment: 'Down Payment (not refundable)',
  monthlyInstalment: 'Monthly Instalment',
  numberOfInstalments: 'Number of Instalments',
  totalPayable: 'Total Payable',
  dueDate: 'Due Date',
  dueDateValue: (d) => `The ${d === 2 ? '2nd' : '17th'} of every month`,
  firstDueDate: 'First Due Date',
  lastDueDate: 'Last Due Date',
  lateFee: 'Late Fee',
  lateFeeValue: (fee, grace, cap, max) =>
    `${fee} per day after the ${grace}-day Grace Period, for at most ${cap} days each time you are late (at most ${max}), however many instalments are overdue`,
  gst: 'GST',
  gstValue: 'To be confirmed before launch',
  nominee: 'Nominee',
  paymentTable: 'Payment table',
  colNumber: 'No.',
  colDueDate: 'Due date',
  colAmount: 'Amount',
  downPaymentRow: 'Down Payment',
  beforeInstallation: 'Before installation',
  driverSignature: 'Driver signature or thumb impression',
  date: 'Date',
  forVoltNeo: `For ${COMPANY.legalName} (Volt Neo)`,
  nameAndId: 'Name and staff ID',
  k5Intro: 'Read aloud to the driver before signing.',
  k5PayNow: 'You pay now (Down Payment, not refunded)',
  k5PayMonthly: 'You pay each month',
  k5PayMonthlyValue: (a, d, m) => `${a} on the ${d === 2 ? '2nd' : '17th'}, for ${m} months`,
  k5Total: 'Total you pay',
  k5Yours: 'The battery becomes yours',
  k5YoursValue: (last) => `After the last instalment, due on ${last}`,
  k5Late: 'If you pay late',
  k5LateValue: (g, fee, cap, max) =>
    `${g} days' grace. Day ${g}: final notice. Day ${g + 1}: battery disabled. Late fee ${fee} per day, for at most ${cap} days each time you are late (at most ${max}).`,
  k5NoPay: 'If you still do not pay',
  k5NoPayValue: (d) =>
    `The battery is collected ${d} days after it is disabled. The Down Payment is not returned. The account is closed.`,
  k5Early: 'To finish early',
  k5EarlyValue: 'Pay all remaining instalments.',
  k5Cannot: 'You cannot',
  k5CannotValue: 'Return the battery to end the agreement, or pass it to another driver.',
  k5Stolen: 'If the battery is stolen',
  k5StolenValue: 'You keep paying the instalments.',
  k5Repair: 'Volt Neo repairs the battery',
  k5RepairValue: (h) =>
    `While Volt Neo owns it, if it fails or loses capacity in normal use. A technician responds within ${h} hours.`,
  k5Confirm: (l) => `I confirm these facts were explained to me in ${l}.`,
  k5ExplainedBy: 'Explained by (Volt Neo staff name and ID)',
  receiptTitle: 'Payment receipt',
  receiptNo: 'Receipt number',
  receivedAt: 'Received on',
  amountReceived: 'Amount received',
  method: 'Paid by',
  reference: 'Reference',
  collectedBy: 'Collected by',
  paidTowards: 'Paid towards',
  allocDownPayment: 'Down Payment',
  allocInstalment: (n, due) => `Instalment ${n} (due ${due})`,
  allocLateFee: (date) => `Late fee for ${date}`,
  allocExcess: 'Paid in excess (to be refunded)',
  balanceAfter: 'Still to pay after this payment',
  receiptValidity: 'Only receipts generated by the Volt Neo system are valid proof of payment.',
  receiptSms: (p) =>
    `Volt Neo: Received ${rs(p.amount)} for agreement ${p.agreement} on ${p.date}. Receipt ${p.receipt}. Still to pay: ${rs(p.balance)}.`,
  page: (n, of) => `Page ${n} of ${of}`,
  reminderSms: (p) =>
    `Volt Neo: Your instalment of ${rs(p.amount)} for agreement ${p.agreement} is due ${p.today ? `today (${p.dueDate})` : `on ${p.dueDate}`}. Pay by UPI or to a Volt Neo agent and keep the system receipt.`,
  finalNoticeSms: (p) =>
    `Volt Neo: FINAL NOTICE. ${rs(p.amount)} is overdue on agreement ${p.agreement}. If it is not paid today, your battery may be disabled from ${p.disableFrom}, and a late fee of ${rs(p.fee)} a day applies from then. Pay now to avoid this.`,
  immobilisedSms: (p) =>
    `Volt Neo: Your battery has been disabled because ${rs(p.amount)} is due on agreement ${p.agreement}. Pay ${rs(p.amount)} to have it switched back on. There is no reconnection fee.`,
  restoredSms: (p) =>
    `Volt Neo: Thank you. Your battery on agreement ${p.agreement} has been switched back on.`,
  certificateTitle: 'Schedule 8: Ownership Transfer Certificate',
  certificateNo: 'Certificate number',
  agreementDate: 'Agreement date',
  battery: 'Battery',
  totalPaid: 'Total Payable paid',
  paidInFullOn: 'Paid in full on',
  ownershipPassedOn: 'Ownership passed on',
  gpsOffOn: 'GPS module switched off on',
  certificateBody: (p) =>
    `Volt Neo confirms that ${p.driver} has paid the full amount due under Neo Own agreement ${p.agreement} dated ${p.agreementDate}. Ownership of battery serial number ${p.serial} passed to ${p.driver} on ${p.transferDate}. The GPS module was switched off on ${p.gpsOffDate}. Volt Neo's service obligations ended on that date.`,
  certificateKeep: 'Keep this certificate as proof that the battery is yours.',
  authorisedSignatory: 'Authorised signatory, name and date',
  transferredSms: (p) =>
    `Volt Neo: Congratulations! Agreement ${p.agreement} is fully paid and battery ${p.serial} is now yours. Certificate ${p.certificate}. The GPS module has been switched off and Volt Neo service has ended.`,
  ticketReceivedSms: (p) =>
    `Volt Neo: We have your battery problem report, number ${p.ticket}. A technician will contact you within ${p.hours} hours.`,
  ticketResolvedSms: (p) =>
    `Volt Neo: Your service request ${p.ticket} is closed. If the problem comes back, call Volt Neo.`,
  paymentLinkSms: (p) =>
    `Volt Neo: Pay ${rs(p.amount)} for agreement ${p.agreement} by UPI: ${p.url} (open until ${p.until}). You get a receipt SMS once it is paid.`,
  signInCodeSms: (p) =>
    `Volt Neo: Your sign-in code is ${p.code}. It expires in ${p.minutes} minutes. Do not share it with anyone.`,
};

const BN: Texts = {
  languageName: { BN: 'বাংলা', HI: 'হিন্দি', EN: 'ইংরেজি' },
  draftBanner: 'খসড়া: আইনজীবী এখনও পর্যালোচনা করেননি। চালকদের সঙ্গে ব্যবহারের জন্য নয়।',
  previewBanner: 'প্রিভিউ: এই চুক্তি এখনও সই হয়নি।',
  schedule1Title: 'তফসিল ১: আপনার প্ল্যান',
  schedule5Title: 'তফসিল ৫: মূল তথ্য',
  agreementNo: 'চুক্তি নম্বর',
  driver: 'চালক',
  phone: 'ফোন',
  vehicle: 'গাড়ি',
  plan: 'প্ল্যান',
  planValue: (name, code, v) => `${name} (${code}, সংস্করণ ${v})`,
  batteryType: 'ব্যাটারির ধরন',
  downPayment: 'ডাউন পেমেন্ট (ফেরতযোগ্য নয়)',
  monthlyInstalment: 'মাসিক কিস্তি',
  numberOfInstalments: 'কিস্তির সংখ্যা',
  totalPayable: 'মোট দেয় অর্থ',
  dueDate: 'দেয় তারিখ',
  dueDateValue: (d) => `প্রতি মাসের ${d} তারিখ`,
  firstDueDate: 'প্রথম কিস্তির তারিখ',
  lastDueDate: 'শেষ কিস্তির তারিখ',
  lateFee: 'বিলম্ব ফি',
  lateFeeValue: (fee, grace, cap, max) =>
    `${grace} দিনের ছাড়ের পরে প্রতিদিন ${fee}, প্রতিবার দেরিতে সর্বোচ্চ ${cap} দিন (সর্বোচ্চ ${max}); একাধিক কিস্তি বাকি থাকলেও দিনে ${fee}-এর বেশি নয়`,
  gst: 'জিএসটি',
  gstValue: 'চালু হওয়ার আগে নিশ্চিত করা হবে',
  nominee: 'নমিনি',
  paymentTable: 'পেমেন্টের তালিকা',
  colNumber: 'ক্রম',
  colDueDate: 'দেয় তারিখ',
  colAmount: 'পরিমাণ',
  downPaymentRow: 'ডাউন পেমেন্ট',
  beforeInstallation: 'ইনস্টলেশনের আগে',
  driverSignature: 'চালকের সই বা টিপসই',
  date: 'তারিখ',
  forVoltNeo: `${COMPANY.legalName} (Volt Neo)-র পক্ষে`,
  nameAndId: 'নাম ও কর্মী আইডি',
  k5Intro: 'সই করার আগে চালককে পড়ে শোনাতে হবে।',
  k5PayNow: 'এখন দেবেন (ডাউন পেমেন্ট, ফেরত হবে না)',
  k5PayMonthly: 'প্রতি মাসে দেবেন',
  k5PayMonthlyValue: (a, d, m) => `প্রতি মাসের ${d} তারিখে ${a}, ${m} মাস ধরে`,
  k5Total: 'মোট দেবেন',
  k5Yours: 'ব্যাটারি আপনার হবে',
  k5YoursValue: (last) => `শেষ কিস্তি দেওয়ার পরে (শেষ কিস্তির তারিখ ${last})`,
  k5Late: 'দেরিতে দিলে',
  k5LateValue: (g, fee, cap, max) =>
    `${g} দিন ছাড়। দিন ${g}: শেষ নোটিস। দিন ${g + 1}: ব্যাটারি বন্ধ করা হবে। প্রতিদিন ${fee} বিলম্ব ফি, প্রতিবার দেরিতে সর্বোচ্চ ${cap} দিন (সর্বোচ্চ ${max})।`,
  k5NoPay: 'তারপরও না দিলে',
  k5NoPayValue: (d) =>
    `ব্যাটারি বন্ধ হওয়ার ${d} দিন পরে ব্যাটারি নিয়ে নেওয়া হবে। ডাউন পেমেন্ট ফেরত হবে না। অ্যাকাউন্ট বন্ধ হবে।`,
  k5Early: 'আগে শেষ করতে চাইলে',
  k5EarlyValue: 'বাকি সব কিস্তি দিয়ে দিন।',
  k5Cannot: 'আপনি পারবেন না',
  k5CannotValue: 'ব্যাটারি ফেরত দিয়ে চুক্তি শেষ করতে, বা অন্য চালককে ব্যাটারি দিতে।',
  k5Stolen: 'ব্যাটারি চুরি হলে',
  k5StolenValue: 'কিস্তি দেওয়া চালিয়ে যেতে হবে।',
  k5Repair: 'Volt Neo ব্যাটারি সারাবে',
  k5RepairValue: (h) =>
    `যতদিন ব্যাটারি Volt Neo-র, স্বাভাবিক ব্যবহারে খারাপ হলে বা ক্ষমতা কমে গেলে। টেকনিশিয়ান ${h} ঘণ্টার মধ্যে সাড়া দেবেন।`,
  k5Confirm: (l) => `আমি নিশ্চিত করছি যে এই তথ্যগুলি আমাকে ${l} ভাষায় বুঝিয়ে বলা হয়েছে।`,
  k5ExplainedBy: 'বুঝিয়েছেন (Volt Neo কর্মীর নাম ও আইডি)',
  receiptTitle: 'পেমেন্টের রসিদ',
  receiptNo: 'রসিদ নম্বর',
  receivedAt: 'পাওয়ার তারিখ',
  amountReceived: 'পাওয়া অর্থ',
  method: 'পেমেন্টের মাধ্যম',
  reference: 'রেফারেন্স',
  collectedBy: 'সংগ্রহ করেছেন',
  paidTowards: 'যার জন্য দেওয়া হল',
  allocDownPayment: 'ডাউন পেমেন্ট',
  allocInstalment: (n, due) => `কিস্তি ${n} (দেয় ${due})`,
  allocLateFee: (date) => `${date} তারিখের বিলম্ব ফি`,
  allocExcess: 'বেশি দেওয়া অর্থ (ফেরত দেওয়া হবে)',
  balanceAfter: 'এই পেমেন্টের পরে বাকি',
  receiptValidity: 'শুধুমাত্র Volt Neo সিস্টেমের তৈরি রসিদই পেমেন্টের বৈধ প্রমাণ।',
  receiptSms: (p) =>
    `Volt Neo: চুক্তি ${p.agreement}-এর জন্য ${p.date} তারিখে ${p.amount} পাওয়া গেছে। রসিদ ${p.receipt}। বাকি: ${p.balance}।`,
  page: (n, of) => `পৃষ্ঠা ${n} / ${of}`,
  reminderSms: (p) =>
    `Volt Neo: চুক্তি ${p.agreement}-এর ${p.amount} কিস্তি ${p.today ? `আজ (${p.dueDate})` : `${p.dueDate} তারিখে`} দেয়। UPI-তে বা Volt Neo এজেন্টকে দিন এবং সিস্টেমের রসিদ রাখুন।`,
  finalNoticeSms: (p) =>
    `Volt Neo: শেষ নোটিস। চুক্তি ${p.agreement}-এ ${p.amount} বাকি। আজ না দিলে ${p.disableFrom} থেকে আপনার ব্যাটারি বন্ধ করা হতে পারে, এবং সেদিন থেকে প্রতিদিন ${p.fee} বিলম্ব ফি লাগবে। এড়াতে এখনই দিন।`,
  immobilisedSms: (p) =>
    `Volt Neo: চুক্তি ${p.agreement}-এ ${p.amount} বাকি থাকায় আপনার ব্যাটারি বন্ধ করা হয়েছে। ${p.amount} দিলে আবার চালু করা হবে। আবার চালু করার জন্য কোনো ফি নেই।`,
  restoredSms: (p) => `Volt Neo: ধন্যবাদ। চুক্তি ${p.agreement}-এর ব্যাটারি আবার চালু করা হয়েছে।`,
  certificateTitle: 'তফসিল ৮: মালিকানা হস্তান্তরের শংসাপত্র',
  certificateNo: 'শংসাপত্র নম্বর',
  agreementDate: 'চুক্তির তারিখ',
  battery: 'ব্যাটারি',
  totalPaid: 'মোট প্রদেয় পরিশোধিত',
  paidInFullOn: 'সম্পূর্ণ পরিশোধের তারিখ',
  ownershipPassedOn: 'মালিকানা হস্তান্তরের তারিখ',
  gpsOffOn: 'জিপিএস মডিউল বন্ধের তারিখ',
  certificateBody: (p) =>
    `Volt Neo নিশ্চিত করছে যে ${p.driver} ${p.agreementDate} তারিখের Neo Own চুক্তি ${p.agreement}-এর সম্পূর্ণ প্রদেয় অর্থ পরিশোধ করেছেন। ব্যাটারি সিরিয়াল নম্বর ${p.serial}-এর মালিকানা ${p.transferDate} তারিখে ${p.driver}-এর কাছে হস্তান্তরিত হয়েছে। জিপিএস মডিউল ${p.gpsOffDate} তারিখে বন্ধ করা হয়েছে। সেই তারিখে Volt Neo-র পরিষেবার দায়িত্ব শেষ হয়েছে।`,
  certificateKeep: 'ব্যাটারি যে আপনার, তার প্রমাণ হিসেবে এই শংসাপত্রটি রেখে দিন।',
  authorisedSignatory: 'অনুমোদিত স্বাক্ষরকারী, নাম ও তারিখ',
  transferredSms: (p) =>
    `Volt Neo: অভিনন্দন! চুক্তি ${p.agreement}-এর সম্পূর্ণ অর্থ পরিশোধ হয়েছে এবং ব্যাটারি ${p.serial} এখন আপনার। শংসাপত্র ${p.certificate}। জিপিএস মডিউল বন্ধ করা হয়েছে এবং Volt Neo-র পরিষেবা শেষ হয়েছে।`,
  ticketReceivedSms: (p) =>
    `Volt Neo: আপনার ব্যাটারির সমস্যার অভিযোগ পেয়েছি, নম্বর ${p.ticket}। ${p.hours} ঘণ্টার মধ্যে একজন টেকনিশিয়ান আপনার সঙ্গে যোগাযোগ করবেন।`,
  ticketResolvedSms: (p) =>
    `Volt Neo: আপনার পরিষেবা অনুরোধ ${p.ticket} বন্ধ করা হয়েছে। সমস্যা আবার হলে Volt Neo-কে ফোন করুন।`,
  paymentLinkSms: (p) =>
    `Volt Neo: চুক্তি ${p.agreement}-এর ${p.amount} UPI-তে দিন: ${p.url} (${p.until} পর্যন্ত খোলা)। পেমেন্ট হলে রসিদের SMS পাবেন।`,
  signInCodeSms: (p) =>
    `Volt Neo: আপনার সাইন-ইন কোড ${p.code}। ${p.minutes} মিনিটে এর মেয়াদ শেষ হবে। কাউকে এই কোড জানাবেন না।`,
};

const HI: Texts = {
  languageName: { BN: 'बांग्ला', HI: 'हिंदी', EN: 'अंग्रेज़ी' },
  draftBanner: 'मसौदा: वकील ने अभी समीक्षा नहीं की है। चालकों के साथ उपयोग के लिए नहीं।',
  previewBanner: 'पूर्वावलोकन: इस अनुबंध पर अभी हस्ताक्षर नहीं हुए हैं।',
  schedule1Title: 'अनुसूची 1: आपका प्लान',
  schedule5Title: 'अनुसूची 5: मुख्य बातें',
  agreementNo: 'अनुबंध संख्या',
  driver: 'चालक',
  phone: 'फ़ोन',
  vehicle: 'गाड़ी',
  plan: 'प्लान',
  planValue: (name, code, v) => `${name} (${code}, संस्करण ${v})`,
  batteryType: 'बैटरी का प्रकार',
  downPayment: 'डाउन पेमेंट (वापस नहीं होगा)',
  monthlyInstalment: 'मासिक किस्त',
  numberOfInstalments: 'किस्तों की संख्या',
  totalPayable: 'कुल देय राशि',
  dueDate: 'देय तिथि',
  dueDateValue: (d) => `हर महीने की ${d} तारीख`,
  firstDueDate: 'पहली किस्त की तारीख',
  lastDueDate: 'आख़िरी किस्त की तारीख',
  lateFee: 'विलंब शुल्क',
  lateFeeValue: (fee, grace, cap, max) =>
    `${grace} दिन की छूट के बाद ${fee} प्रति दिन, हर बार देरी होने पर अधिकतम ${cap} दिन (अधिकतम ${max}); कई किस्तें बाकी हों तब भी दिन में ${fee} से ज़्यादा नहीं`,
  gst: 'जीएसटी',
  gstValue: 'शुरू होने से पहले तय किया जाएगा',
  nominee: 'नॉमिनी',
  paymentTable: 'भुगतान तालिका',
  colNumber: 'क्रम',
  colDueDate: 'देय तिथि',
  colAmount: 'राशि',
  downPaymentRow: 'डाउन पेमेंट',
  beforeInstallation: 'इंस्टॉलेशन से पहले',
  driverSignature: 'चालक के हस्ताक्षर या अँगूठे का निशान',
  date: 'तारीख',
  forVoltNeo: `${COMPANY.legalName} (Volt Neo) की ओर से`,
  nameAndId: 'नाम और कर्मचारी आईडी',
  k5Intro: 'हस्ताक्षर से पहले चालक को पढ़कर सुनाएँ।',
  k5PayNow: 'अभी देंगे (डाउन पेमेंट, वापस नहीं होगा)',
  k5PayMonthly: 'हर महीने देंगे',
  k5PayMonthlyValue: (a, d, m) => `हर महीने की ${d} तारीख को ${a}, ${m} महीने तक`,
  k5Total: 'कुल देंगे',
  k5Yours: 'बैटरी आपकी होगी',
  k5YoursValue: (last) => `आख़िरी किस्त के बाद (आख़िरी किस्त की तारीख ${last})`,
  k5Late: 'देर से देने पर',
  k5LateValue: (g, fee, cap, max) =>
    `${g} दिन की छूट। दिन ${g}: अंतिम नोटिस। दिन ${g + 1}: बैटरी बंद। ${fee} प्रति दिन विलंब शुल्क, हर बार देरी होने पर अधिकतम ${cap} दिन (अधिकतम ${max})।`,
  k5NoPay: 'फिर भी न देने पर',
  k5NoPayValue: (d) =>
    `बैटरी बंद होने के ${d} दिन बाद बैटरी वापस ले ली जाएगी। डाउन पेमेंट वापस नहीं होगा। खाता बंद होगा।`,
  k5Early: 'जल्दी पूरा करने के लिए',
  k5EarlyValue: 'बाकी सभी किस्तें चुका दें।',
  k5Cannot: 'आप नहीं कर सकते',
  k5CannotValue: 'बैटरी लौटाकर अनुबंध खत्म करना, या बैटरी किसी दूसरे चालक को देना।',
  k5Stolen: 'बैटरी चोरी होने पर',
  k5StolenValue: 'किस्तें देते रहना होगा।',
  k5Repair: 'Volt Neo बैटरी ठीक करेगा',
  k5RepairValue: (h) =>
    `जब तक बैटरी Volt Neo की है, सामान्य उपयोग में ख़राब होने या क्षमता घटने पर। तकनीशियन ${h} घंटे के अंदर जवाब देगा।`,
  k5Confirm: (l) => `मैं पुष्टि करता/करती हूँ कि ये बातें मुझे ${l} में समझाई गईं।`,
  k5ExplainedBy: 'समझाने वाले (Volt Neo कर्मचारी का नाम और आईडी)',
  receiptTitle: 'भुगतान रसीद',
  receiptNo: 'रसीद संख्या',
  receivedAt: 'प्राप्ति की तारीख',
  amountReceived: 'प्राप्त राशि',
  method: 'भुगतान का तरीका',
  reference: 'संदर्भ',
  collectedBy: 'संग्रहकर्ता',
  paidTowards: 'किसके लिए',
  allocDownPayment: 'डाउन पेमेंट',
  allocInstalment: (n, due) => `किस्त ${n} (देय ${due})`,
  allocLateFee: (date) => `${date} का विलंब शुल्क`,
  allocExcess: 'अधिक भुगतान (वापस किया जाएगा)',
  balanceAfter: 'इस भुगतान के बाद बाकी',
  receiptValidity: 'केवल Volt Neo सिस्टम से बनी रसीद ही भुगतान का मान्य प्रमाण है।',
  receiptSms: (p) =>
    `Volt Neo: अनुबंध ${p.agreement} के लिए ${p.date} को ${p.amount} प्राप्त हुए। रसीद ${p.receipt}। बाकी: ${p.balance}।`,
  page: (n, of) => `पृष्ठ ${n} / ${of}`,
  reminderSms: (p) =>
    `Volt Neo: अनुबंध ${p.agreement} की ${p.amount} की किस्त ${p.today ? `आज (${p.dueDate})` : `${p.dueDate} को`} देय है। UPI से या Volt Neo एजेंट को भुगतान करें और सिस्टम की रसीद रखें।`,
  finalNoticeSms: (p) =>
    `Volt Neo: अंतिम नोटिस। अनुबंध ${p.agreement} पर ${p.amount} बाकी है। आज भुगतान न होने पर ${p.disableFrom} से आपकी बैटरी बंद की जा सकती है, और उस दिन से ${p.fee} प्रति दिन विलंब शुल्क लगेगा। इससे बचने के लिए अभी भुगतान करें।`,
  immobilisedSms: (p) =>
    `Volt Neo: अनुबंध ${p.agreement} पर ${p.amount} बाकी होने के कारण आपकी बैटरी बंद कर दी गई है। ${p.amount} का भुगतान करने पर इसे फिर से चालू किया जाएगा। दोबारा चालू करने का कोई शुल्क नहीं है।`,
  restoredSms: (p) => `Volt Neo: धन्यवाद। अनुबंध ${p.agreement} की बैटरी फिर से चालू कर दी गई है।`,
  certificateTitle: 'अनुसूची 8: स्वामित्व हस्तांतरण प्रमाणपत्र',
  certificateNo: 'प्रमाणपत्र संख्या',
  agreementDate: 'अनुबंध की तारीख',
  battery: 'बैटरी',
  totalPaid: 'कुल देय राशि का भुगतान',
  paidInFullOn: 'पूरा भुगतान की तारीख',
  ownershipPassedOn: 'स्वामित्व हस्तांतरण की तारीख',
  gpsOffOn: 'जीपीएस मॉड्यूल बंद होने की तारीख',
  certificateBody: (p) =>
    `Volt Neo पुष्टि करता है कि ${p.driver} ने ${p.agreementDate} के Neo Own अनुबंध ${p.agreement} के तहत देय पूरी राशि चुका दी है। बैटरी सीरियल नंबर ${p.serial} का स्वामित्व ${p.transferDate} को ${p.driver} को हस्तांतरित हुआ। जीपीएस मॉड्यूल ${p.gpsOffDate} को बंद किया गया। उसी तारीख को Volt Neo की सेवा की ज़िम्मेदारी समाप्त हुई।`,
  certificateKeep: 'बैटरी आपकी है, इसके प्रमाण के रूप में यह प्रमाणपत्र संभालकर रखें।',
  authorisedSignatory: 'अधिकृत हस्ताक्षरकर्ता, नाम और तारीख',
  transferredSms: (p) =>
    `Volt Neo: बधाई! अनुबंध ${p.agreement} का पूरा भुगतान हो गया है और बैटरी ${p.serial} अब आपकी है। प्रमाणपत्र ${p.certificate}। जीपीएस मॉड्यूल बंद कर दिया गया है और Volt Neo की सेवा समाप्त हो गई है।`,
  ticketReceivedSms: (p) =>
    `Volt Neo: आपकी बैटरी की समस्या की शिकायत मिल गई है, नंबर ${p.ticket}। ${p.hours} घंटे के अंदर तकनीशियन आपसे संपर्क करेगा।`,
  ticketResolvedSms: (p) =>
    `Volt Neo: आपका सेवा अनुरोध ${p.ticket} बंद कर दिया गया है। समस्या फिर से हो तो Volt Neo को फ़ोन करें।`,
  paymentLinkSms: (p) =>
    `Volt Neo: अनुबंध ${p.agreement} के ${p.amount} UPI से चुकाएँ: ${p.url} (${p.until} तक खुला)। भुगतान होने पर रसीद का SMS मिलेगा।`,
  signInCodeSms: (p) =>
    `Volt Neo: आपका साइन-इन कोड ${p.code} है। यह ${p.minutes} मिनट में समाप्त हो जाएगा। यह कोड किसी को न बताएँ।`,
};

export const TEXTS: Record<Lang, Texts> = { BN, HI, EN };

/** Dates on documents are written DD/MM/YYYY in every language (ASSUMED). */
export function docDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

import type { AgreementState, PaymentMethod, TicketCategory, TicketStatus } from '@voltneo/shared';
import type { Lang } from './index';

/** Names for the backend's codes, per language. REQUIRES VALIDATION by native speakers. */
export interface Labels {
  state: Record<AgreementState, string>;
  method: Record<PaymentMethod, string>;
  category: Record<TicketCategory, string>;
  ticket: Record<TicketStatus, string>;
}

export const LABELS: Record<Lang, Labels> = {
  EN: {
    state: {
      DRAFT: 'Being prepared',
      AWAITING_DOWN_PAYMENT: 'Waiting for the down payment',
      AWAITING_INSTALLATION: 'Waiting for installation',
      ACTIVE: 'Active',
      IN_GRACE: 'Overdue',
      IMMOBILISED: 'Battery switched off',
      RECOVERED: 'Battery collected',
      CLOSED: 'Closed',
      PAID_OFF: 'Fully paid',
      EARLY_EXIT: 'Paid early',
      TRANSFERRED: 'Battery is yours',
      CANCELLED: 'Cancelled',
    },
    method: { UPI: 'UPI', CARD: 'card', CASH: 'cash', ENACH: 'bank account (e-NACH)' },
    category: {
      NOT_WORKING: 'Battery not working',
      LOW_CAPACITY: 'Runs out too soon',
      CHARGING: 'Charging problem',
      PHYSICAL_DAMAGE: 'Damage',
      GPS_MODULE: 'GPS box problem',
      OTHER: 'Something else',
    },
    ticket: {
      OPEN: 'Received',
      ASSIGNED: 'Technician assigned',
      RESOLVED: 'Solved',
      CANCELLED: 'Closed',
      CLOSE_REQUESTED: 'Being checked by Volt Neo',
    },
  },
  BN: {
    state: {
      DRAFT: 'তৈরি হচ্ছে',
      AWAITING_DOWN_PAYMENT: 'ডাউন পেমেন্টের অপেক্ষায়',
      AWAITING_INSTALLATION: 'ইনস্টলেশনের অপেক্ষায়',
      ACTIVE: 'চালু',
      IN_GRACE: 'বাকি আছে',
      IMMOBILISED: 'ব্যাটারি বন্ধ',
      RECOVERED: 'ব্যাটারি ফেরত নেওয়া হয়েছে',
      CLOSED: 'বন্ধ',
      PAID_OFF: 'সম্পূর্ণ পরিশোধ',
      EARLY_EXIT: 'আগেই পরিশোধ',
      TRANSFERRED: 'ব্যাটারি আপনার',
      CANCELLED: 'বাতিল',
    },
    method: { UPI: 'UPI', CARD: 'কার্ড', CASH: 'নগদ', ENACH: 'ব্যাংক অ্যাকাউন্ট (ই-ন্যাক)' },
    category: {
      NOT_WORKING: 'ব্যাটারি চলছে না',
      LOW_CAPACITY: 'তাড়াতাড়ি চার্জ শেষ হয়',
      CHARGING: 'চার্জিংয়ের সমস্যা',
      PHYSICAL_DAMAGE: 'ক্ষতি হয়েছে',
      GPS_MODULE: 'জিপিএস বাক্সের সমস্যা',
      OTHER: 'অন্য কিছু',
    },
    ticket: {
      OPEN: 'পাওয়া গেছে',
      ASSIGNED: 'টেকনিশিয়ান দেওয়া হয়েছে',
      RESOLVED: 'সমাধান হয়েছে',
      CANCELLED: 'বন্ধ',
      CLOSE_REQUESTED: 'Volt Neo যাচাই করছে',
    },
  },
  HI: {
    state: {
      DRAFT: 'तैयार हो रहा है',
      AWAITING_DOWN_PAYMENT: 'डाउन पेमेंट का इंतज़ार',
      AWAITING_INSTALLATION: 'इंस्टॉलेशन का इंतज़ार',
      ACTIVE: 'चालू',
      IN_GRACE: 'बकाया',
      IMMOBILISED: 'बैटरी बंद',
      RECOVERED: 'बैटरी वापस ली गई',
      CLOSED: 'बंद',
      PAID_OFF: 'पूरा भुगतान',
      EARLY_EXIT: 'पहले ही भुगतान',
      TRANSFERRED: 'बैटरी आपकी',
      CANCELLED: 'रद्द',
    },
    method: { UPI: 'UPI', CARD: 'कार्ड', CASH: 'नकद', ENACH: 'बैंक खाता (ई-नैक)' },
    category: {
      NOT_WORKING: 'बैटरी नहीं चल रही',
      LOW_CAPACITY: 'जल्दी खत्म हो जाती है',
      CHARGING: 'चार्जिंग की समस्या',
      PHYSICAL_DAMAGE: 'नुकसान',
      GPS_MODULE: 'जीपीएस बॉक्स की समस्या',
      OTHER: 'कुछ और',
    },
    ticket: {
      OPEN: 'मिल गया',
      ASSIGNED: 'तकनीशियन तय',
      RESOLVED: 'हल हो गया',
      CANCELLED: 'बंद',
      CLOSE_REQUESTED: 'Volt Neo जाँच रहा है',
    },
  },
};

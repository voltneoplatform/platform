import type { Lang } from '../documents/texts';
import type { DltKey } from './sms-templates';

/**
 * What the DLT portal approved for Vishwakarman Investment Services Private
 * Limited (TRAI rules): the principal entity, the sender name (header) and one
 * template ID per message and language. Filled in from the "VOLT NEO — DLT SMS
 * Template Pack" document as approvals arrive. A message whose template has no
 * ID yet is not sent (it is recorded as failed and can be sent again later).
 */
export const DLT_REGISTRATION: {
  entityId: string | null;
  header: string | null;
  templates: Record<DltKey, Record<Lang, string | null>>;
} = {
  entityId: null,
  header: null,
  templates: {
    payment_receipt: { EN: null, BN: null, HI: null },
    reminder: { EN: null, BN: null, HI: null },
    reminder_today: { EN: null, BN: null, HI: null },
    final_notice: { EN: null, BN: null, HI: null },
    immobilised: { EN: null, BN: null, HI: null },
    restored: { EN: null, BN: null, HI: null },
    ownership_transferred: { EN: null, BN: null, HI: null },
    ticket_received: { EN: null, BN: null, HI: null },
    ticket_resolved: { EN: null, BN: null, HI: null },
    payment_link: { EN: null, BN: null, HI: null },
    sign_in_code: { EN: null, BN: null, HI: null },
  },
};

export type DltRegistration = typeof DLT_REGISTRATION;

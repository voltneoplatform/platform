import type { TicketCategory, TicketStatus, TicketTiming } from '@voltneo/shared';

export interface TicketRow {
  id: string;
  number: string;
  driver: { name: string; phone: string };
  batterySerial: string | null;
  category: TicketCategory;
  status: TicketStatus;
  timing: TicketTiming;
  reportedAt: string;
  dueBy: string;
  respondedAt: string | null;
}

export const timingTone = (t: TicketTiming): 'danger' | 'warn' | 'success' | 'info' =>
  t === 'MISSED'
    ? 'danger'
    : t === 'DUE_SOON' || t === 'MET_LATE'
      ? 'warn'
      : t === 'MET'
        ? 'success'
        : 'info';

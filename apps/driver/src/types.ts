import type {
  AgreementState,
  DueNow,
  PaymentMethod,
  TicketCategory,
  TicketStatus,
} from '@voltneo/shared';

/** GET /v1/me */
export interface Me {
  driver: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    language: 'BN' | 'HI' | 'EN';
  };
  agreements: { id: string; number: string; state: AgreementState }[];
}

/** GET /v1/me/agreement */
export interface MyAgreement {
  id: string;
  number: string;
  state: AgreementState;
  signedAt: string | null;
  activatedAt: string | null;
  plan: { code: string; name: string };
  battery: { type: string; serial: string | null };
  vehicle: { registration: string | null; type: string };
  money: {
    downPayment: number;
    instalment: number;
    termMonths: number;
    totalPayable: number;
    paid: number;
    outstanding: number;
    lateFeesDue: number;
    instalmentsPaid: number;
    dueDay: number;
  };
  due: DueNow;
  /** UPI AutoPay will take the instalment now due: show that instead of Pay. */
  dueByAutopay: boolean;
  autopay: {
    available: boolean;
    unavailableReason: string | null;
    methods: Record<'UPI' | 'ENACH', { available: boolean; reason: string | null }>;
    method: 'UPI' | 'ENACH' | null;
    status: 'OFF' | 'PENDING' | 'ACTIVE';
    maxAmount: number;
    approvalUrl: string | null;
    nextCharge: { amount: number; date: string | null; status: string } | null;
  };
  schedule: {
    sequence: number;
    dueDate: string | null;
    amount: number;
    amountPaid: number;
    status: 'UNPAID' | 'PART_PAID' | 'PAID';
  }[];
  documents: { signedCopy: boolean };
}

/** GET /v1/me/payments */
export interface Receipt {
  id: string;
  receiptNumber: string;
  agreementNumber: string;
  amount: number;
  method: PaymentMethod;
  receivedAt: string;
  balanceAfter: number;
}

/** GET /v1/me/tickets */
export interface MyTicket {
  id: string;
  number: string;
  agreementNumber: string;
  category: TicketCategory;
  description: string;
  status: TicketStatus;
  reportedAt: string;
  dueBy: string;
  resolvedAt: string | null;
}

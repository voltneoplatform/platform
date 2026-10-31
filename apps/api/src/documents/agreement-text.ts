/**
 * Neo Own agreement wording (English), from "Neo Own Agreement: Plain-Language
 * Draft V1" (22 Oct 2026). The LAWYER notes are left out. Blanks the founder or
 * lawyer has not filled yet print as "[to be confirmed: …]" so they cannot be
 * missed. REQUIRES VALIDATION: none of this has been reviewed by a lawyer (L1–L17);
 * every page carries the draft banner until it has.
 *
 * Changes from Draft V1, all PROPOSED: A1 becomes the formal parties block
 * (agreement-pdf.ts); "Late Spell" is added to the definitions; B12 points to
 * Schedule 1; F8 says the signed text is English (founder, 31 Oct 2026); F11
 * describes signing on stamp paper.
 */

export type Block = string | { ol: string[] } | { ul: string[] };
export interface Clause {
  no: string;
  title: string;
  blocks: Block[];
}
export interface Part {
  title: string;
  clauses: Clause[];
}

export interface AgreementTextValues {
  graceDays: number;
  lateFee: string; // e.g. ₹100
  lateFeeCapDays: number;
  lateFeeCap: string; // e.g. ₹3,000
  recoveryAfterDays: number;
  serviceHours: number;
  headOfficeAddress: string;
}

/** A blank that still needs a decision; printed so it cannot be overlooked. */
export const tbc = (what: string) => `[to be confirmed: ${what}]`;

export function agreementParts(v: AgreementTextValues): Part[] {
  return [
    {
      title: 'Part A: Definitions and nature of this agreement',
      clauses: [
        {
          no: 'A1',
          title: 'Vehicle owner',
          blocks: [
            'If the vehicle in Schedule 3 is not owned by you, its owner signs the consent in Schedule 7. The vehicle owner does not take on your payment obligations.',
          ],
        },
        {
          no: 'A2',
          title: 'Background',
          blocks: [
            'Volt Neo supplies batteries for totos, e-rickshaws and e-three-wheelers on a pay-monthly basis. You pay a down payment and monthly instalments, and the battery becomes yours once every instalment has been paid.',
          ],
        },
        {
          no: 'A3',
          title: 'Definitions',
          blocks: [
            'In this agreement:',
            {
              ul: [
                'Battery means the battery described in Schedule 2, and any replacement Volt Neo fits under this agreement.',
                'GPS Module means the tracking and remote-disable device fitted to the Battery.',
                'Plan means the Neo Own plan you have chosen, as set out in Schedule 1.',
                'Down Payment means the amount in Schedule 1 that you pay before installation.',
                'Instalment means each monthly payment in Schedule 1.',
                'Due Date means the day each month your Instalment is due: the 2nd or the 17th, as stated in Schedule 1.',
                `Grace Period means the ${v.graceDays} days after a Due Date.`,
                'Late Fee means the fee in clause B9.',
                'Late Spell means the period that starts when a Due Date passes unpaid and ends when every Instalment that has fallen due and every Late Fee has been paid.',
                'Total Payable means the Down Payment plus all Instalments.',
                'Remaining Balance means the total of all Instalments not yet paid.',
                'Immobilisation means remotely disabling the Battery through the GPS Module.',
                'Recovery means Volt Neo collecting the Battery under clause E4.',
                'Ownership Transfer means the Battery becoming your property under clause E9.',
                `Head Office means Volt Neo's office at ${v.headOfficeAddress}.`,
                'App means the Volt Neo driver app.',
              ],
            },
          ],
        },
        {
          no: 'A4',
          title: 'What this agreement does',
          blocks: [
            {
              ol: [
                'You may use the Battery from installation while you pay for it.',
                'Volt Neo owns the Battery until you have paid the Total Payable.',
                'When you have paid the Total Payable, the Battery becomes yours.',
              ],
            },
          ],
        },
        {
          no: 'A5',
          title: 'Your plan',
          blocks: [
            'Your plan, its version and all its figures are set out in Schedule 1. They are fixed when you sign. If Volt Neo later changes, renames or withdraws the plan for new customers, your agreement does not change.',
          ],
        },
        {
          no: 'A6',
          title: 'Who can change your terms',
          blocks: [
            'Only Head Office can agree to change any term of this agreement. A change is valid only if it is in writing and approved by two authorised Head Office staff. Field agents and technicians cannot change any term, and you should not rely on anything they say that differs from this agreement.',
          ],
        },
        {
          no: 'A7',
          title: 'If documents conflict',
          blocks: [
            'If this agreement and a Schedule say different things, Schedule 1 applies to amounts and dates, and this agreement applies to everything else.',
          ],
        },
      ],
    },
    {
      title: 'Part B: Payments',
      clauses: [
        {
          no: 'B1',
          title: 'What you pay in total',
          blocks: [
            'You agree to pay the Total Payable shown in Schedule 1: the Down Payment plus every Instalment. The Total Payable is written in figures and in words in Schedule 1 and in the Key Facts summary (Schedule 5), which is explained to you before you sign.',
          ],
        },
        {
          no: 'B2',
          title: 'Down Payment',
          blocks: [
            {
              ol: [
                'You pay the Down Payment before the Battery is installed.',
                'The Down Payment is part of the price of the Battery. It is not refundable.',
                'If the Battery is recovered under clause E4, Volt Neo keeps the Down Payment.',
                'If you finish early under clause E7, the Down Payment is not deducted from the Remaining Balance.',
              ],
            },
          ],
        },
        {
          no: 'B3',
          title: 'Instalments',
          blocks: [
            'You pay the number of Instalments shown in Schedule 1, each of the amount shown. The Battery becomes yours only after the last Instalment is paid.',
          ],
        },
        {
          no: 'B4',
          title: 'Due Date',
          blocks: [
            'Your Instalment is due on the same day each month, either the 2nd or the 17th. Head Office assigns your Due Date, and it is shown in Schedule 1 together with your first Due Date.',
          ],
        },
        {
          no: 'B5',
          title: 'Paying in parts',
          blocks: [
            'You may pay any amount at any time before your Due Date. Your Instalment is paid once Volt Neo has received the full amount by the Due Date. The App shows how much you have paid towards the current Instalment.',
          ],
        },
        {
          no: 'B6',
          title: 'How to pay',
          blocks: [
            "You can pay by UPI, UPI AutoPay, debit or credit card, or in cash to an authorised Volt Neo agent. For every payment you will receive a receipt from Volt Neo's system by SMS, WhatsApp or the App. Only a system-generated receipt is proof of payment. Do not pay anyone who cannot give you one.",
          ],
        },
        {
          no: 'B7',
          title: 'AutoPay',
          blocks: [
            'You may choose to set up an AutoPay mandate so your Instalment is collected automatically. You can cancel it at any time through your bank or UPI app. AutoPay follows the rules of your bank and payment provider.',
          ],
        },
        {
          no: 'B8',
          title: 'Reminders',
          blocks: [
            'Volt Neo will send you a reminder 5 days, 3 days and 1 day before your Due Date, and on the Due Date. Your Instalment is still due on the Due Date even if a reminder does not reach you.',
          ],
        },
        {
          no: 'B9',
          title: 'Late Fee',
          blocks: [
            {
              ol: [
                `If an Instalment is still unpaid when the Grace Period ends, a Late Fee of ${v.lateFee} per day applies from the next day until the overdue amount is paid.`,
                `The Late Fee is ${v.lateFee} per day however many Instalments are overdue, and is charged for at most ${v.lateFeeCapDays} days in each Late Spell (at most ${v.lateFeeCap}). If you miss a later Due Date, a new Late Spell starts.`,
                'The Late Fee stops if the Battery is recovered under clause E4.',
              ],
            },
          ],
        },
        {
          no: 'B10',
          title: 'How your payments are used',
          blocks: [
            'Each payment you make is used first to pay any Late Fee you owe, and then towards your oldest unpaid Instalment.',
          ],
        },
        {
          no: 'B11',
          title: 'Statements',
          blocks: [
            'You can see what you have paid, what is due and what remains in the App at any time. You can also ask Volt Neo for a printed statement.',
          ],
        },
        {
          no: 'B12',
          title: 'Taxes',
          blocks: ['Schedule 1 states whether its amounts include GST.'],
        },
      ],
    },
    {
      title: 'Part C: The battery, installation, use and service',
      clauses: [
        {
          no: 'C1',
          title: 'The Battery',
          blocks: [
            "The Battery's type, serial number and specifications are set out in Schedule 2. The Battery is made by a third-party manufacturer. Your agreement is with Volt Neo only, and you deal with Volt Neo for everything about the Battery.",
          ],
        },
        {
          no: 'C2',
          title: 'Installation',
          blocks: [
            "After you have paid the Down Payment, a Volt Neo technician will install the Battery in the vehicle named in Schedule 3. The technician will record the Battery's condition and test readings, and take photos, in Schedule 3. You will be asked to confirm the record.",
          ],
        },
        {
          no: 'C3',
          title: 'What you must do',
          blocks: [
            'While Volt Neo owns the Battery, you must:',
            {
              ol: [
                'use the Battery only in the vehicle named in Schedule 3;',
                'charge and use it as Volt Neo instructs;',
                'take reasonable care of it and keep it safe;',
                'tell Volt Neo promptly, by phone, WhatsApp or the App, if the Battery develops a fault, is damaged, stolen or involved in an accident; and',
                "let Volt Neo's staff have reasonable access to the Battery to service, replace or recover it.",
              ],
            },
          ],
        },
        {
          no: 'C4',
          title: 'What you must not do',
          blocks: [
            'While Volt Neo owns the Battery, you must not:',
            {
              ol: [
                'sell, pledge, rent out, lend or give the Battery to anyone;',
                'open, modify or tamper with the Battery or the GPS Module;',
                'remove the Battery from the vehicle, or have anyone other than Volt Neo repair it; or',
                "use it in a way that is unsafe or against Volt Neo's instructions.",
              ],
            },
          ],
        },
        {
          no: 'C5',
          title: 'Changing your vehicle',
          blocks: [
            'If you want to use the Battery in a different vehicle, contact Volt Neo. A technician will move the Battery and update Schedule 3. If you do not own the new vehicle, its owner must sign a new Schedule 7.',
          ],
        },
        {
          no: 'C6',
          title: 'Service while Volt Neo owns the Battery',
          blocks: [
            {
              ol: [
                `If the Battery stops working, or its capacity falls below ${tbc('capacity level set by Head Office')}, in normal use, Volt Neo will repair or replace it at no cost to you.`,
                `After you report a fault, a technician will respond within ${v.serviceHours} hours.`,
                'Volt Neo does not carry out scheduled inspections. Service is provided when you report a problem.',
              ],
            },
          ],
        },
        {
          no: 'C7',
          title: 'Misuse and damage',
          blocks: [
            'If a repair is needed because of misuse, tampering, an accident, or work by someone other than Volt Neo, Volt Neo may charge you the reasonable cost of the repair. Before charging, Volt Neo will give you an inspection report with photos. You may dispute the charge under clause F4.',
          ],
        },
        {
          no: 'C8',
          title: 'Replacement Battery',
          blocks: [
            'If Volt Neo replaces the Battery, the replacement is covered by this agreement on the same Plan and payment schedule. Schedule 2 will be updated.',
          ],
        },
        {
          no: 'C9',
          title: 'Loss or theft',
          blocks: [
            `If the Battery is stolen, lost or destroyed while Volt Neo owns it, you must report it to Volt Neo and to the police at once. You must continue to pay your Instalments. ${tbc('whether Volt Neo supplies a replacement Battery, and on what terms')}`,
          ],
        },
      ],
    },
    {
      title: 'Part D: GPS, data and immobilisation',
      clauses: [
        {
          no: 'D1',
          title: 'The GPS Module',
          blocks: [
            'The Battery has a GPS Module that reports where the Battery is and allows Volt Neo to disable the Battery remotely. The GPS Module stays active until Ownership Transfer, when Volt Neo switches it off.',
          ],
        },
        {
          no: 'D2',
          title: 'What information Volt Neo collects and why',
          blocks: [
            'Volt Neo collects:',
            {
              ol: [
                "the Battery's location, from the GPS Module;",
                'your identity and address documents (KYC), and your vehicle details; and',
                'your payment records.',
              ],
            },
            'Volt Neo uses this information to protect its Battery, collect payments, provide service and prevent fraud. Schedule 6 explains this in more detail.',
          ],
        },
        {
          no: 'D3',
          title: 'Who sees your information and how long it is kept',
          blocks: [
            'Only authorised Volt Neo staff and named service providers working for Volt Neo can see your information. Volt Neo keeps it only as long as needed for the purposes in D2, or longer where the law requires. Retention periods are set out in Schedule 6.',
          ],
        },
        {
          no: 'D4',
          title: 'Your consent',
          blocks: [
            'By signing Schedule 6 you consent to the collection and use described there. If you do not own the vehicle, its owner consents through Schedule 7.',
          ],
        },
        {
          no: 'D5',
          title: "Volt Neo's right to disable the Battery",
          blocks: [
            'If an Instalment is still unpaid when the Grace Period ends, and Volt Neo has sent you the final notice in clause E2, Volt Neo may disable the Battery remotely.',
          ],
        },
        {
          no: 'D6',
          title: 'Safety',
          blocks: [
            'Volt Neo will disable the Battery only when the vehicle is stationary. It will never disable the Battery while the vehicle is moving.',
          ],
        },
        {
          no: 'D7',
          title: 'How it is done',
          blocks: [
            "Disabling the Battery must be approved by two authorised Volt Neo staff. It is carried out through the GPS supplier's system, and every step is recorded.",
          ],
        },
        {
          no: 'D8',
          title: 'Getting the Battery working again',
          blocks: [
            'As soon as you pay everything you owe, including any Late Fee, Volt Neo will re-enable the Battery. There is no reconnection fee.',
          ],
        },
        {
          no: 'D9',
          title: 'Emergency',
          blocks: [
            "If you face a genuine emergency while the Battery is disabled, you can ask Volt Neo's support desk to re-enable it for a short time. Each request is recorded and reviewed.",
          ],
        },
        {
          no: 'D10',
          title: 'Tampering',
          blocks: [
            'Removing, blocking or damaging the GPS Module is a serious breach of this agreement (see clause E3).',
          ],
        },
      ],
    },
    {
      title: 'Part E: Missed payments, recovery, finishing early and ownership',
      clauses: [
        {
          no: 'E1',
          title: 'Grace Period',
          blocks: [
            `If you have not paid an Instalment in full by its Due Date, you have a Grace Period of ${v.graceDays} days. No Late Fee is charged during the Grace Period.`,
          ],
        },
        {
          no: 'E2',
          title: 'Final notice',
          blocks: [
            `If the Instalment is still unpaid on the ${v.graceDays === 5 ? '5th' : `${v.graceDays}th`} day of the Grace Period, Volt Neo will send you a final notice in writing and by voice call, in your language. It will tell you the amount you owe and when the Battery will be disabled if it is not paid.`,
          ],
        },
        {
          no: 'E3',
          title: 'Serious breaches',
          blocks: [
            'Each of the following is a serious breach of this agreement:',
            {
              ol: [
                'an Instalment remaining unpaid after the Grace Period;',
                'tampering with the Battery or the GPS Module;',
                'selling, pledging or giving away the Battery; and',
                'giving Volt Neo false information in your KYC documents or application.',
              ],
            },
            `If you commit a serious breach in points 2 to 4, Volt Neo may disable and recover the Battery after giving you ${tbc('notice period')} written notice.`,
          ],
        },
        {
          no: 'E4',
          title: 'Recovery',
          blocks: [
            `If everything you owe is still unpaid ${v.recoveryAfterDays} days after the Battery was disabled, Volt Neo's field team will collect the Battery. You, and the vehicle owner through Schedule 7, must allow them access to the vehicle for this purpose.`,
          ],
        },
        {
          no: 'E5',
          title: 'How recovery is carried out',
          blocks: [
            "Recovery is carried out only by trained Volt Neo staff, following Volt Neo's written code of conduct. They will not use threats or force, and will not shame you in public.",
          ],
        },
        {
          no: 'E6',
          title: 'After recovery',
          blocks: [
            {
              ol: [
                'Volt Neo keeps the Down Payment and every Instalment you have already paid.',
                'Your account is closed.',
                'Volt Neo will not ask you to pay the unpaid Instalments or Late Fees.',
                'You will receive a final statement.',
              ],
            },
          ],
        },
        {
          no: 'E7',
          title: 'Finishing early',
          blocks: [
            'You can finish this agreement early at any time by paying the Remaining Balance: the full total of all Instalments not yet paid. The Down Payment is not deducted. Once Volt Neo receives the full Remaining Balance, the Battery becomes yours under clause E9.',
          ],
        },
        {
          no: 'E8',
          title: 'No return of the Battery',
          blocks: [
            'You cannot end this agreement by handing the Battery back. You can end it only by paying the Total Payable, or early under clause E7.',
          ],
        },
        {
          no: 'E9',
          title: 'Ownership Transfer',
          blocks: [
            'When Volt Neo has received the Total Payable, or the Remaining Balance under clause E7:',
            {
              ol: [
                'the Battery becomes your property;',
                'Volt Neo gives you an Ownership Transfer Certificate (Schedule 8);',
                'Volt Neo switches off the GPS Module; and',
                "Volt Neo's service obligations under clause C6 end.",
              ],
            },
          ],
        },
        {
          no: 'E10',
          title: 'After the Battery is yours',
          blocks: [
            `You are responsible for the Battery after Ownership Transfer, including its safe disposal at the end of its life. ${tbc('any remaining manufacturer warranty')}`,
          ],
        },
        {
          no: 'E11',
          title: 'Death or permanent incapacity',
          blocks: [
            'If you die or become permanently unable to work, the nominee named in Schedule 1, or a member of your family, may choose to:',
            {
              ol: [
                'continue the Plan in your place; or',
                'pay the Remaining Balance and keep the Battery.',
              ],
            },
          ],
        },
        {
          no: 'E12',
          title: 'Transferring this agreement',
          blocks: [
            'You may not transfer this agreement, or any of your rights under it, to anyone else, except to your nominee or family under clause E11.',
          ],
        },
      ],
    },
    {
      title: 'Part F: General terms',
      clauses: [
        {
          no: 'F1',
          title: "Limits on Volt Neo's responsibility",
          blocks: [
            "If the Battery fails, Volt Neo's responsibility is to repair or replace it under clause C6. Volt Neo is not responsible for earnings you lose while the Battery is not working. Nothing in this agreement limits any responsibility that the law does not allow Volt Neo to limit.",
          ],
        },
        {
          no: 'F2',
          title: 'Your responsibility for losses you cause',
          blocks: [
            "You will cover Volt Neo's reasonable losses caused by your tampering with or misuse of the Battery, or by false information you gave Volt Neo.",
          ],
        },
        {
          no: 'F3',
          title: "Events outside anyone's control",
          blocks: [
            'Neither you nor Volt Neo is responsible for a delay caused by events outside its control, such as natural disasters or government restrictions. Your Instalments remain due unless Volt Neo agrees otherwise in writing.',
          ],
        },
        {
          no: 'F4',
          title: 'Complaints',
          blocks: [
            {
              ol: [
                `Contact Volt Neo's support desk by phone at ${tbc('number')}, WhatsApp at ${tbc('number')}, or through the App. Volt Neo will respond within ${tbc('time')}.`,
                `If you are not satisfied, you can ask for your complaint to be reviewed by ${tbc('title of head-office officer')}, who will respond within ${tbc('time')}.`,
              ],
            },
          ],
        },
        {
          no: 'F5',
          title: 'Disputes',
          blocks: [
            `If a dispute cannot be resolved under F4, it will be decided by the courts at Kolkata. ${tbc('whether arbitration or conciliation comes first')}`,
          ],
        },
        {
          no: 'F6',
          title: 'Governing law',
          blocks: [
            'This agreement is governed by the laws of India. The courts at Kolkata, West Bengal have jurisdiction.',
          ],
        },
        {
          no: 'F7',
          title: 'Notices',
          blocks: [
            'Volt Neo will send notices to your registered mobile number by the App, SMS, WhatsApp or voice call, and in writing to your address where the law requires. You must tell Volt Neo promptly if your number or address changes.',
          ],
        },
        {
          no: 'F8',
          title: 'Language',
          blocks: [
            'This agreement is signed in English. Before you sign, it is explained to you aloud in Bengali, Hindi or English, as you choose, and you receive the Key Facts summary (Schedule 5) in that language. The signing section records who explained it and in which language.',
          ],
        },
        {
          no: 'F9',
          title: 'Changes to this agreement',
          blocks: [
            'Volt Neo may issue new versions of this agreement for new customers; they do not change your agreement. Your agreement can be changed only under clause A6.',
          ],
        },
        {
          no: 'F10',
          title: 'Whole agreement',
          blocks: [
            'This agreement and its Schedules are the whole agreement between you and Volt Neo about the Battery. If any part is found invalid, the rest continues to apply.',
          ],
        },
        {
          no: 'F11',
          title: 'Signing and stamp duty',
          blocks: [
            `This agreement is signed on paper, with its first page on non-judicial stamp paper, and every page is initialled by both parties. Stamp duty is paid by ${tbc('Volt Neo or the driver')}. You receive a copy on paper and in the App.`,
          ],
        },
      ],
    },
  ];
}

/** Schedule 6 wording: data and GPS consent (clause D4). */
export function schedule6(providers: string): Block[] {
  return [
    "What we collect: the Battery's location from the GPS Module; your name, address, ID and vehicle documents; your payment history.",
    "Why: to protect Volt Neo's Battery, collect payments, provide service, and prevent fraud.",
    `Who can see it: authorised Volt Neo staff and named service providers working for Volt Neo: ${providers}.`,
    `How long we keep it: ${tbc('retention period for each type of information')}.`,
    'When tracking stops: the GPS Module is switched off when the Battery becomes yours.',
    `Your rights: ${tbc('rights to access, correct and ask for deletion, and how to contact Volt Neo')}.`,
    'I consent to the collection and use of my information as described above.',
  ];
}

/** Service providers named in Schedule 6, as chosen so far (T72, T82, T93). */
export const SCHEDULE6_PROVIDERS = `Cashfree Payments (payments), SMSGatewayHub (SMS), Amazon Web Services (hosting, storage and email), and ${tbc('GPS provider')}`;

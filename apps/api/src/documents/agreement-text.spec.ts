import { describe, expect, it } from 'vitest';
import { agreementParts, type Block } from './agreement-text';

const parts = agreementParts({
  graceDays: 3,
  lateFee: '₹100',
  lateFeeCapDays: 30,
  lateFeeCap: '₹3,000',
  recoveryAfterDays: 30,
  serviceHours: 48,
  headOfficeAddress: 'Head Office, Kolkata',
});

const flat = (b: Block) =>
  typeof b === 'string' ? b : 'ol' in b ? b.ol.join(' ') : b.ul.join(' ');
const clause = (no: string) => {
  const c = parts.flatMap((p) => p.clauses).find((x) => x.no === no);
  if (!c) throw new Error(`no clause ${no}`);
  return c.blocks.map(flat).join(' ');
};
const all = parts.flatMap((p) => p.clauses.map((c) => c.blocks.map(flat).join(' '))).join(' ');

describe('agreement text (founder decisions T106)', () => {
  it('treats capacity below 60% as a fault', () => {
    expect(clause('C6')).toContain('below 60% of its rated capacity');
  });

  it('does not replace a stolen battery, and instalments continue', () => {
    expect(clause('C9')).toContain('does not replace a Battery that is stolen, lost or destroyed');
    expect(clause('C9')).toContain('continue to pay');
  });

  it('allows disabling at once for a serious breach, with 7 days to explain', () => {
    expect(clause('E3')).toContain('disable the Battery at once');
    expect(clause('E3')).toContain('within 7 days of the notice');
  });

  it('settles disputes by optional mediation, then the courts at Kolkata, keeping consumer rights', () => {
    expect(clause('F5')).toContain('mediation');
    expect(clause('F5')).toContain('courts at Kolkata');
    expect(clause('F5')).toContain('consumer protection law');
    expect(all).not.toMatch(/arbitrat/i);
  });

  it('says Volt Neo pays the stamp duty', () => {
    expect(clause('F11')).toContain('Volt Neo pays the stamp duty');
  });

  it('prints no support numbers or response times, and no open blanks for decided items', () => {
    expect(all).not.toMatch(
      /to be confirmed: (support|WhatsApp|response|stamp|capacity|notice|stolen|arbitration)/i,
    );
  });
});

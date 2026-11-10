import { describe, expect, it } from 'vitest';
import { installationItemStatus, installationReadyForApproval } from './installations';

describe('installation photo checks', () => {
  it('works out where an item stands from its photos', () => {
    expect(installationItemStatus([])).toBe('MISSING');
    expect(installationItemStatus(['REJECTED'])).toBe('REJECTED');
    expect(installationItemStatus(['REJECTED', 'PENDING'])).toBe('PENDING');
    expect(installationItemStatus(['REJECTED', 'VERIFIED', 'PENDING'])).toBe('VERIFIED');
  });

  it('allows the final approval only when every required item is verified and none waits', () => {
    const all = (['BATTERY', 'GPS', 'VEHICLE', 'VOLTAGE', 'HANDOVER'] as const).map((item) => ({
      item,
      status: 'VERIFIED' as const,
    }));
    expect(installationReadyForApproval(all)).toBe(true);
    expect(installationReadyForApproval(all.slice(1))).toBe(false);
    expect(installationReadyForApproval([...all, { item: 'OTHER', status: 'PENDING' }])).toBe(
      false,
    );
    expect(installationReadyForApproval([...all, { item: 'OTHER', status: 'REJECTED' }])).toBe(
      true,
    );
    expect(
      installationReadyForApproval([...all.slice(1), { item: 'BATTERY', status: 'REJECTED' }]),
    ).toBe(false);
  });
});

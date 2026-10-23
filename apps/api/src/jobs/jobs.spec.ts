import { SCHEDULES } from './jobs.service';

describe('scheduled jobs (spec section 6)', () => {
  it('runs the daily collections check at 00:05 and notices at 09:00, India time', () => {
    expect(SCHEDULES.map((s) => [s.id, s.pattern, s.tz])).toEqual([
      ['collections-daily', '5 0 * * *', 'Asia/Kolkata'],
      ['collections-notices', '0 9 * * *', 'Asia/Kolkata'],
    ]);
  });
});

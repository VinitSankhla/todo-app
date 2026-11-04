// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  describeDate,
  isValidTimeZone,
  resolveDateExpression,
  todayInTimeZone,
  weekdayName,
} from './dates';

// 2026-11-05 is a Thursday.
const TODAY = '2026-11-05';

function resolve(expression: string, today = TODAY) {
  const result = resolveDateExpression(expression, today);
  return 'date' in result ? result.date : `error: ${result.error}`;
}

describe('resolveDateExpression', () => {
  it.each([
    ['today', '2026-11-05'],
    ['Tomorrow', '2026-11-06'],
    ['tomorrow.', '2026-11-06'],
    ['day after tomorrow', '2026-11-07'],
    ['in 3 days', '2026-11-08'],
    ['in two weeks', '2026-11-19'],
    ['in a month', '2026-12-05'],
    ['next week', '2026-11-12'],
    ['next month', '2026-12-05'],
    ['2026-12-25', '2026-12-25'],
    ['by Friday', '2026-11-06'],
    ['this friday', '2026-11-06'],
    ['next Friday', '2026-11-06'],
    ['fri', '2026-11-06'],
    ['monday', '2026-11-09'],
    ['next monday', '2026-11-09'],
    // Same weekday as today: "Thursday" means today, "next Thursday" means a week later.
    ['thursday', '2026-11-05'],
    ['next thursday', '2026-11-12'],
    ['20 November', '2026-11-20'],
    ['20th of nov', '2026-11-20'],
    ['Nov 20th', '2026-11-20'],
    ['December 1, 2027', '2027-12-01'],
    // A date earlier this year without a year means next year.
    ['4 nov', '2027-11-04'],
    ['5 nov', '2026-11-05'],
  ])('"%s" -> %s', (expression, expected) => {
    expect(resolve(expression)).toBe(expected);
  });

  it('handles month ends and leap years', () => {
    expect(resolve('next month', '2026-01-31')).toBe('2026-02-28');
    expect(resolve('next month', '2028-01-31')).toBe('2028-02-29');
    expect(resolve('tomorrow', '2026-12-31')).toBe('2027-01-01');
  });

  it('rejects dates that do not exist or are out of range', () => {
    expect(resolve('31 february')).toMatch(/not a real date/);
    expect(resolve('2026-02-30')).toMatch(/not a real date/);
    expect(resolve('1 jan 2200')).toMatch(/between 2000 and 2100/);
  });

  it('asks for a clearer date when it cannot understand one', () => {
    for (const unclear of ['someday', '5/11', 'soonish', 'next blursday', 'in many days', '']) {
      expect(resolve(unclear)).toMatch(/^error: Could not understand that date/);
    }
  });

  it('returns a readable description to confirm with the user', () => {
    expect(resolveDateExpression('tomorrow', TODAY)).toEqual({
      date: '2026-11-06',
      description: 'Friday, 6 November 2026',
    });
  });
});

describe('time zones', () => {
  // 20:00 UTC on 5 Nov is already 01:30 on 6 Nov in India.
  const now = new Date('2026-11-05T20:00:00Z');

  it("uses the user's own date, not the server's", () => {
    expect(todayInTimeZone(now, 'Asia/Kolkata')).toBe('2026-11-06');
    expect(todayInTimeZone(now, 'America/New_York')).toBe('2026-11-05');
    expect(todayInTimeZone(now, 'UTC')).toBe('2026-11-05');
  });

  it('"tomorrow" depends on the time zone', () => {
    expect(resolve('tomorrow', todayInTimeZone(now, 'Asia/Kolkata'))).toBe('2026-11-07');
    expect(resolve('tomorrow', todayInTimeZone(now, 'America/New_York'))).toBe('2026-11-06');
  });

  it('accepts real time zones only', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('date descriptions', () => {
  it('names the weekday', () => {
    expect(weekdayName('2026-11-05')).toBe('Thursday');
    expect(describeDate('2027-01-01')).toBe('Friday, 1 January 2027');
  });
});

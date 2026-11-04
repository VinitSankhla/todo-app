import { validateDueDate } from '../../shared/task-validation';

/**
 * Turns the date words people say ("tomorrow", "next Friday", "in 3 days", "5 Nov") into a
 * YYYY-MM-DD due date, relative to "today" in the user's own time zone.
 * This runs in code rather than being left to the AI model, so dates are always resolved the
 * same way; the assistant then repeats the resolved date back to the user to confirm it.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Today's date (YYYY-MM-DD) as seen by someone in `timeZone`. */
export function todayInTimeZone(now: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** e.g. "Friday" for "2026-11-06". */
export function weekdayName(isoDate: string): string {
  const name = WEEKDAYS[toUtcDate(isoDate).getUTCDay()];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** e.g. "Friday, 6 November 2026" for "2026-11-06". */
export function describeDate(isoDate: string): string {
  const date = toUtcDate(isoDate);
  const month = MONTHS[date.getUTCMonth()];
  return `${weekdayName(isoDate)}, ${date.getUTCDate()} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getUTCFullYear()}`;
}

function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

function addMonths(isoDate: string, months: number): string {
  const date = toUtcDate(isoDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  // Clamp to the last day of the target month (31 Jan + 1 month = 28/29 Feb).
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIso(date);
}

function parseCount(word: string): number | null {
  if (/^\d{1,3}$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  return MONTHS.findIndex((month) => month.startsWith(word));
}

export type ResolvedDate = { date: string; description: string } | { error: string };

const NOT_UNDERSTOOD =
  'Could not understand that date. Ask the user for the date as e.g. "tomorrow", "next Friday", "in 3 days", "5 November" or YYYY-MM-DD.';

/**
 * Resolves a date expression relative to `today` (YYYY-MM-DD in the user's time zone).
 * Weekday rule: "Friday" / "this Friday" = the soonest Friday from today (today counts);
 * "next Friday" = the soonest Friday after today.
 */
export function resolveDateExpression(expression: string, today: string): ResolvedDate {
  const text = expression
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(on|by|due|for) /, '')
    .trim();

  const resolved = resolveText(text, today);
  if (resolved === null) return { error: NOT_UNDERSTOOD };
  const invalid = validateDueDate(resolved);
  if (invalid) return { error: invalid };
  return { date: resolved, description: describeDate(resolved) };
}

function resolveText(text: string, today: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (text === 'today' || text === 'tonight') return today;
  if (text === 'tomorrow' || text === 'tmrw' || text === 'tomorrow night') return addDays(today, 1);
  if (text === 'day after tomorrow' || text === 'the day after tomorrow') return addDays(today, 2);
  if (text === 'next week') return addDays(today, 7);
  if (text === 'next month') return addMonths(today, 1);

  // "in 3 days", "in two weeks", "in a month"
  const relative = /^in (\w+) (day|days|week|weeks|month|months)$/.exec(text);
  if (relative) {
    const count = parseCount(relative[1]);
    if (count === null) return null;
    if (relative[2].startsWith('day')) return addDays(today, count);
    if (relative[2].startsWith('week')) return addDays(today, count * 7);
    return addMonths(today, count);
  }

  // "friday", "this friday", "coming friday", "next friday"
  const weekday = /^(this |coming |this coming |next )?(\w+)$/.exec(text);
  if (weekday) {
    const target = WEEKDAYS.findIndex(
      (day) => day === weekday[2] || (weekday[2].length >= 3 && day.startsWith(weekday[2])),
    );
    if (target !== -1) {
      const current = toUtcDate(today).getUTCDay();
      let ahead = (target - current + 7) % 7;
      if (weekday[1] === 'next ' && ahead === 0) ahead = 7;
      return addDays(today, ahead);
    }
  }

  // "5 november", "5th nov 2027", "november 5", "nov 5th 2027"
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?$/.exec(text);
  const monthFirst = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(text);
  const parts = dayFirst
    ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
    : monthFirst
      ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] }
      : null;
  if (parts) {
    const month = monthIndex(parts.month);
    if (month === -1) return null;
    const day = Number(parts.day);
    const pad = (value: number) => String(value).padStart(2, '0');
    const build = (year: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
    if (parts.year) return build(Number(parts.year));
    // No year given: this year, or next year if that date has already passed.
    const thisYear = Number(today.slice(0, 4));
    const candidate = build(thisYear);
    return candidate < today ? build(thisYear + 1) : candidate;
  }

  return null;
}

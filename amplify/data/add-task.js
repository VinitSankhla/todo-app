import { util } from '@aws-appsync/utils';

// Keep in sync with shared/task-validation.ts (checked by resolvers.test.ts).
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

/**
 * True for a real calendar date written as YYYY-MM-DD. Uses only string slicing, indexOf and
 * arithmetic: AppSync's util.time parsers expect full timestamps, and the APPSYNC_JS runtime
 * supports only a subset of built-ins (a version using Number.isInteger was rejected at deploy).
 */
function isRealDate(value) {
  if (value.length !== 10 || value.slice(4, 5) !== '-' || value.slice(7, 8) !== '-') return false;
  const year = twoDigits(value.slice(0, 2)) * 100 + twoDigits(value.slice(2, 4));
  const month = twoDigits(value.slice(5, 7));
  const day = twoDigits(value.slice(8, 10));
  if (year < 0 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/** Value of a two-character digit string, or a large negative number if it is not digits. */
function twoDigits(text) {
  const tens = '0123456789'.indexOf(text.slice(0, 1));
  const ones = '0123456789'.indexOf(text.slice(1, 2));
  if (tens < 0 || ones < 0) return -10000;
  return tens * 10 + ones;
}

/**
 * addTask: validates input on the server, then stores a new task owned by the caller.
 * The owner comes from the verified Cognito identity, never from client input.
 * Runs in the AppSync JS runtime (no Lambda), so it must stay self-contained.
 */
export function request(ctx) {
  const title = ctx.args.title ? ctx.args.title.trim() : '';
  const description = ctx.args.description ? ctx.args.description.trim() : '';
  const dueDate = ctx.args.dueDate ? ctx.args.dueDate : '';

  if (!title) util.error('Title is required.', 'ValidationError');
  if (title.length > TITLE_MAX_LENGTH) {
    util.error(`Title must be ${TITLE_MAX_LENGTH} characters or fewer.`, 'ValidationError');
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    util.error(
      `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`,
      'ValidationError',
    );
  }
  if (dueDate) {
    if (!isRealDate(dueDate)) util.error('Due date is not a real date.', 'ValidationError');
    if (dueDate < '2000-01-01' || dueDate > '2100-12-31') {
      util.error('Due date must be between 2000 and 2100.', 'ValidationError');
    }
  }

  const now = util.time.nowISO8601();
  const item = {
    __typename: 'Task',
    title,
    done: false,
    owner: `${ctx.identity.sub}::${ctx.identity.username}`,
    createdAt: now,
    updatedAt: now,
  };
  if (description) item.description = description;
  if (dueDate) item.dueDate = dueDate;

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ id: util.autoId() }),
    attributeValues: util.dynamodb.toMapValues(item),
    condition: { expression: 'attribute_not_exists(id)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}

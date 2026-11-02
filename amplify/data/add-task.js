import { util } from '@aws-appsync/utils';

// Keep in sync with shared/task-validation.ts (checked by resolvers.test.ts).
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

/**
 * True for a real calendar date written as YYYY-MM-DD. Uses plain arithmetic because AppSync's
 * util.time parsers expect full timestamps and do not round-trip a bare date.
 */
function isRealDate(value) {
  const parts = value.split('-');
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2) return false;
  if (parts[2].length !== 2) return false;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
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

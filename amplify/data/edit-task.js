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
 * editTask: validates the changed fields on the server, then updates the task only if the
 * caller owns it. The ownership check is a DynamoDB condition, evaluated atomically with the write.
 * Omitted arguments are left unchanged; an empty description or null due date clears that field.
 */
export function request(ctx) {
  const args = ctx.args;
  const now = util.time.nowISO8601();
  const sets = ['#updatedAt = :updatedAt'];
  const removes = [];
  const names = { '#updatedAt': 'updatedAt' };
  const values = { ':updatedAt': now };

  if (args.title !== undefined) {
    const title = args.title ? args.title.trim() : '';
    if (!title) util.error('Title is required.', 'ValidationError');
    if (title.length > TITLE_MAX_LENGTH) {
      util.error(`Title must be ${TITLE_MAX_LENGTH} characters or fewer.`, 'ValidationError');
    }
    sets.push('#title = :title');
    names['#title'] = 'title';
    values[':title'] = title;
  }

  if (args.description !== undefined) {
    const description = args.description ? args.description.trim() : '';
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      util.error(
        `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`,
        'ValidationError',
      );
    }
    names['#description'] = 'description';
    if (description) {
      sets.push('#description = :description');
      values[':description'] = description;
    } else {
      removes.push('#description');
    }
  }

  if (args.dueDate !== undefined) {
    names['#dueDate'] = 'dueDate';
    if (args.dueDate) {
      if (!isRealDate(args.dueDate)) util.error('Due date is not a real date.', 'ValidationError');
      if (args.dueDate < '2000-01-01' || args.dueDate > '2100-12-31') {
        util.error('Due date must be between 2000 and 2100.', 'ValidationError');
      }
      sets.push('#dueDate = :dueDate');
      values[':dueDate'] = args.dueDate;
    } else {
      removes.push('#dueDate');
    }
  }

  if (args.done !== undefined) {
    if (args.done === null) util.error('Done must be true or false.', 'ValidationError');
    sets.push('#done = :done');
    names['#done'] = 'done';
    values[':done'] = args.done;
  }

  if (sets.length === 1 && removes.length === 0) {
    util.error('Nothing to update.', 'ValidationError');
  }

  let expression = `SET ${sets.join(', ')}`;
  if (removes.length > 0) expression = `${expression} REMOVE ${removes.join(', ')}`;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: args.id }),
    update: {
      expression,
      expressionNames: names,
      expressionValues: util.dynamodb.toMapValues(values),
    },
    condition: {
      expression: 'attribute_exists(id) AND #owner = :owner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({
        ':owner': `${ctx.identity.sub}::${ctx.identity.username}`,
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    // Same message whether the task is missing or belongs to someone else, so IDs can't be probed.
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Task not found.', 'NotFound');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

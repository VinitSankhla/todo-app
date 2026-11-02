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

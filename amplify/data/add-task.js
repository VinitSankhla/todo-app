import { util } from '@aws-appsync/utils';

// Keep in sync with shared/task-validation.ts (checked by resolvers.test.ts).
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

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
    const roundTrip = util.time.epochMilliSecondsToFormatted(
      util.time.parseFormattedToEpochMilliSeconds(dueDate, 'yyyy-MM-dd', 'UTC'),
      'yyyy-MM-dd',
      'UTC',
    );
    if (roundTrip !== dueDate) util.error('Due date is not a real date.', 'ValidationError');
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

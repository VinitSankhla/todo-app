// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../shared/task-validation';
import * as addTask from './add-task.js';
import * as editTask from './edit-task.js';

// Minimal stand-in for the AppSync runtime's `util` so the resolver logic can run in Node.
// Only helpers whose behaviour is trivial are faked; date validation must not depend on
// util.time parsers (their real behaviour with bare dates differs from any Node imitation).
vi.mock('@aws-appsync/utils', () => {
  class AppSyncError extends Error {
    constructor(
      message: string,
      public type?: string,
    ) {
      super(message);
    }
  }
  return {
    util: {
      error: (message: string, type?: string) => {
        throw new AppSyncError(message, type);
      },
      autoId: () => 'generated-id',
      time: {
        nowISO8601: () => '2026-11-02T10:00:00.000Z',
      },
      dynamodb: { toMapValues: (value: unknown) => value },
    },
  };
});

const identity = { sub: 'sub-a', username: 'user-a' };
const OWNER = 'sub-a::user-a';

type Ctx = Parameters<typeof addTask.request>[0];
const ctx = (args: Record<string, unknown>) => ({ args, identity }) as unknown as Ctx;

describe('due date checks (same code AppSync runs)', () => {
  // Regression: every valid date was rejected as "not a real date" in the deployed API.
  it.each(['2026-12-01', '2000-01-01', '2100-12-31', '2028-02-29', '2000-02-29', '2026-04-30'])(
    'accepts %s on add and edit',
    (dueDate) => {
      expect(addTask.request(ctx({ title: 'ok', dueDate })).attributeValues).toHaveProperty(
        'dueDate',
        dueDate,
      );
      expect(editTask.request(ctx({ id: 't1', dueDate })).update.expression).toContain('#dueDate');
    },
  );

  it.each([
    '2026-02-30',
    '2027-02-29',
    '2100-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
  ])('rejects %s on add and edit', (dueDate) => {
    expect(() => addTask.request(ctx({ title: 'ok', dueDate }))).toThrow(
      'Due date is not a real date.',
    );
    expect(() => editTask.request(ctx({ id: 't1', dueDate }))).toThrow(
      'Due date is not a real date.',
    );
  });
});

describe('addTask resolver', () => {
  it('stores a trimmed task owned by the caller, ignoring any client-sent owner', () => {
    const request = addTask.request(
      ctx({ title: '  Buy milk ', description: ' 2 litres ', dueDate: '2026-12-01', owner: 'x' }),
    );
    expect(request).toEqual({
      operation: 'PutItem',
      key: { id: 'generated-id' },
      attributeValues: {
        __typename: 'Task',
        title: 'Buy milk',
        description: '2 litres',
        dueDate: '2026-12-01',
        done: false,
        owner: OWNER,
        createdAt: '2026-11-02T10:00:00.000Z',
        updatedAt: '2026-11-02T10:00:00.000Z',
      },
      condition: { expression: 'attribute_not_exists(id)' },
    });
  });

  it('omits empty optional fields', () => {
    const request = addTask.request(ctx({ title: 'Read', description: '   ' }));
    expect(request.attributeValues).not.toHaveProperty('description');
    expect(request.attributeValues).not.toHaveProperty('dueDate');
  });

  it('enforces the same length limits as the browser', () => {
    expect(() => addTask.request(ctx({ title: 'a'.repeat(TITLE_MAX_LENGTH) }))).not.toThrow();
    expect(() => addTask.request(ctx({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) }))).toThrow(
      'Title must be 200 characters or fewer.',
    );
    expect(() =>
      addTask.request(ctx({ title: 'ok', description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1) })),
    ).toThrow('Description must be 2000 characters or fewer.');
  });

  it.each([
    [{ title: '' }, 'Title is required.'],
    [{ title: '    ' }, 'Title is required.'],
    [{ title: 'ok', dueDate: '2026-02-30' }, 'Due date is not a real date.'],
    [{ title: 'ok', dueDate: '1999-12-31' }, 'Due date must be between 2000 and 2100.'],
  ])('rejects %j', (args, message) => {
    expect(() => addTask.request(ctx(args))).toThrow(message);
  });

  it('passes DynamoDB errors through', () => {
    expect(() =>
      addTask.response({ error: { message: 'boom', type: 'X' } } as unknown as Ctx),
    ).toThrow('boom');
  });
});

describe('editTask resolver', () => {
  it('updates only the given fields and only if the caller owns the task', () => {
    const request = editTask.request(ctx({ id: 't1', title: ' New ', done: true }));
    expect(request).toEqual({
      operation: 'UpdateItem',
      key: { id: 't1' },
      update: {
        expression: 'SET #updatedAt = :updatedAt, #title = :title, #done = :done',
        expressionNames: { '#updatedAt': 'updatedAt', '#title': 'title', '#done': 'done' },
        expressionValues: {
          ':updatedAt': '2026-11-02T10:00:00.000Z',
          ':title': 'New',
          ':done': true,
        },
      },
      condition: {
        expression: 'attribute_exists(id) AND #owner = :owner',
        expressionNames: { '#owner': 'owner' },
        expressionValues: { ':owner': OWNER },
      },
    });
  });

  it('clears description and due date when they are emptied', () => {
    const request = editTask.request(ctx({ id: 't1', description: '', dueDate: '' }));
    expect(request.update.expression).toBe(
      'SET #updatedAt = :updatedAt REMOVE #description, #dueDate',
    );
  });

  // editTask takes dueDate as a plain string, so the resolver alone must reject bad formats.
  it.each(['2026-1-01', '20261201', '2026/12/01', 'abcd-ef-gh', '2026-12-01T00:00', ' 2026-12-01'])(
    'rejects badly formatted due date %j',
    (dueDate) => {
      expect(() => editTask.request(ctx({ id: 't1', dueDate }))).toThrow(
        'Due date is not a real date.',
      );
    },
  );

  it.each([
    [{ id: 't1' }, 'Nothing to update.'],
    [{ id: 't1', title: '  ' }, 'Title is required.'],
    [{ id: 't1', title: null }, 'Title is required.'],
    [{ id: 't1', title: 'a'.repeat(201) }, 'Title must be 200 characters or fewer.'],
    [{ id: 't1', description: 'a'.repeat(2001) }, 'Description must be 2000 characters or fewer.'],
    [{ id: 't1', dueDate: '2027-02-29' }, 'Due date is not a real date.'],
    [{ id: 't1', done: null }, 'Done must be true or false.'],
  ])('rejects %j', (args, message) => {
    expect(() => editTask.request(ctx(args))).toThrow(message);
  });

  it('reports "Task not found" when the ownership condition fails', () => {
    const failed = {
      error: {
        message: 'The conditional request failed',
        type: 'DynamoDB:ConditionalCheckFailedException',
      },
    } as unknown as Ctx;
    expect(() => editTask.response(failed)).toThrow('Task not found.');
  });
});

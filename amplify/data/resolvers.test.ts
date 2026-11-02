// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../shared/task-validation';
import * as addTask from './add-task.js';
import * as editTask from './edit-task.js';

// Minimal stand-in for the AppSync runtime's `util` so the resolver logic can run in Node.
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
        parseFormattedToEpochMilliSeconds: (value: string) =>
          // Lenient like Java's parser: 2026-02-30 rolls over to March 2.
          Date.UTC(
            Number(value.slice(0, 4)),
            Number(value.slice(5, 7)) - 1,
            Number(value.slice(8, 10)),
          ),
        epochMilliSecondsToFormatted: (ms: number) => new Date(ms).toISOString().slice(0, 10),
      },
      dynamodb: { toMapValues: (value: unknown) => value },
    },
  };
});

const identity = { sub: 'sub-a', username: 'user-a' };
const OWNER = 'sub-a::user-a';

type Ctx = Parameters<typeof addTask.request>[0];
const ctx = (args: Record<string, unknown>) => ({ args, identity }) as unknown as Ctx;

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
    const request = editTask.request(ctx({ id: 't1', description: '', dueDate: null }));
    expect(request.update.expression).toBe(
      'SET #updatedAt = :updatedAt REMOVE #description, #dueDate',
    );
  });

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

// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStore, fakeTaskClient, type StoredTask } from './test-fakes';
import { createTools, type ToolContext } from './tools';

const ALICE = 'alice-sub::alice';
const BOB = 'bob-sub::bob';
const TODAY = '2026-11-05'; // a Thursday

let db: StoredTask[];
let store: ReturnType<typeof fakeStore>;

beforeEach(() => {
  db = [
    { id: 'a1', owner: ALICE, title: 'Buy milk', description: null, dueDate: null, done: false },
    {
      id: 'a2',
      owner: ALICE,
      title: 'Pay rent',
      description: 'Transfer to landlord',
      dueDate: '2026-11-06',
      done: false,
    },
    { id: 'a3', owner: ALICE, title: 'Call mom', description: null, dueDate: null, done: true },
    { id: 'a4', owner: ALICE, title: 'Buy bread', description: null, dueDate: null, done: false },
    {
      id: 'b1',
      owner: BOB,
      title: 'Bob secret plan',
      description: null,
      dueDate: null,
      done: false,
    },
  ];
  store = fakeStore();
});

/** Alice's tools for one message, as the handler would create them. */
function toolsFor(overrides: Partial<ToolContext> = {}) {
  return createTools({
    tasks: fakeTaskClient(db, ALICE),
    store,
    userId: 'alice-sub',
    conversationId: 'chat-1',
    currentMessageId: 'msg-1',
    currentText: 'hello',
    previousUserMessageId: undefined,
    today: TODAY,
    ...overrides,
  });
}

type Tools = ReturnType<typeof toolsFor>;

async function call(tools: Tools, name: string, input: Record<string, unknown>) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const output = await tool.execute(input as never);
  return JSON.parse(output.text ?? '{}');
}

const titles = (result: { tasks: Array<{ title: string }> }) => result.tasks.map((t) => t.title);

describe('find_tasks', () => {
  it("lists only the user's own tasks and marks them as untrusted data", async () => {
    const result = await call(toolsFor(), 'find_tasks', {});
    expect(titles(result)).toEqual(['Buy milk', 'Pay rent', 'Call mom', 'Buy bread']);
    expect(result.note).toMatch(/user data only/);
  });

  it('filters by words, status and due date', async () => {
    const tools = toolsFor();
    expect(titles(await call(tools, 'find_tasks', { query: 'buy' }))).toEqual([
      'Buy milk',
      'Buy bread',
    ]);
    expect(titles(await call(tools, 'find_tasks', { query: 'landlord' }))).toEqual(['Pay rent']);
    expect(titles(await call(tools, 'find_tasks', { status: 'done' }))).toEqual(['Call mom']);
    expect(titles(await call(tools, 'find_tasks', { status: 'active', query: 'call' }))).toEqual(
      [],
    );
    const dueTomorrow = await call(tools, 'find_tasks', { due_date: 'tomorrow' });
    expect(titles(dueTomorrow)).toEqual(['Pay rent']);
    expect(dueTomorrow.dueDateFilter).toBe('2026-11-06 (Friday, 6 November 2026)');
  });

  it("never returns another user's task, even when searching for it", async () => {
    const result = await call(toolsFor(), 'find_tasks', { query: 'secret plan' });
    expect(result.totalMatches).toBe(0);
  });
});

describe('create_task', () => {
  it('creates a task with a resolved due date', async () => {
    const result = await call(toolsFor(), 'create_task', {
      title: '  Dentist  ',
      description: 'Bring card',
      due_date: 'next Friday',
    });
    expect(result.created).toMatchObject({
      title: 'Dentist',
      description: 'Bring card',
      dueDate: '2026-11-06 (Friday, 6 November 2026)',
      done: false,
    });
    expect(db.at(-1)).toMatchObject({ owner: ALICE, title: 'Dentist', dueDate: '2026-11-06' });
  });

  it('creates a task without a description or due date', async () => {
    const result = await call(toolsFor(), 'create_task', { title: 'Water plants' });
    expect(result.created).toMatchObject({
      title: 'Water plants',
      description: null,
      dueDate: null,
    });
  });

  it('applies the same validation as the app', async () => {
    const tools = toolsFor();
    await expect(call(tools, 'create_task', { title: '   ' })).rejects.toThrow(
      'Title is required.',
    );
    await expect(call(tools, 'create_task', { title: 'x'.repeat(201) })).rejects.toThrow(
      /200 characters/,
    );
    await expect(
      call(tools, 'create_task', { title: 'ok', description: 'x'.repeat(2001) }),
    ).rejects.toThrow(/2000 characters/);
    await expect(call(tools, 'create_task', { title: 'ok', due_date: 'someday' })).rejects.toThrow(
      /Could not understand that date/,
    );
    expect(db).toHaveLength(5);
  });
});

describe('update_task', () => {
  it('changes the title and description', async () => {
    const result = await call(toolsFor(), 'update_task', {
      task_id: 'a1',
      title: 'Buy oat milk',
      description: '2 litres',
    });
    expect(result.updated).toMatchObject({ title: 'Buy oat milk', description: '2 litres' });
  });

  it('adds, changes and removes a due date', async () => {
    const tools = toolsFor();
    await call(tools, 'update_task', { task_id: 'a1', due_date: 'tomorrow' });
    expect(db[0].dueDate).toBe('2026-11-06');
    await call(tools, 'update_task', { task_id: 'a1', due_date: 'in 2 weeks' });
    expect(db[0].dueDate).toBe('2026-11-19');
    await call(tools, 'update_task', { task_id: 'a1', remove_due_date: true });
    expect(db[0].dueDate).toBeNull();
  });

  it('marks done and undone', async () => {
    const tools = toolsFor();
    await call(tools, 'update_task', { task_id: 'a1', done: true });
    expect(db[0].done).toBe(true);
    await call(tools, 'update_task', { task_id: 'a1', done: false });
    expect(db[0].done).toBe(false);
  });

  it('removes a description with ""', async () => {
    await call(toolsFor(), 'update_task', { task_id: 'a2', description: '' });
    expect(db[1].description).toBeNull();
  });

  it('refuses empty or invalid changes', async () => {
    const tools = toolsFor();
    await expect(call(tools, 'update_task', { task_id: 'a1' })).rejects.toThrow(
      /Nothing to change/,
    );
    await expect(call(tools, 'update_task', { task_id: 'a1', title: ' ' })).rejects.toThrow(
      'Title is required.',
    );
    await expect(call(tools, 'update_task', { task_id: 'a1', due_date: '31 feb' })).rejects.toThrow(
      /not a real date/,
    );
  });

  it("cannot change another user's task", async () => {
    await expect(
      call(toolsFor(), 'update_task', { task_id: 'b1', title: 'hacked' }),
    ).rejects.toThrow(/Task not found/);
    expect(db[4].title).toBe('Bob secret plan');
  });
});

describe('deleting needs confirmation', () => {
  /** Turn 1: the user asks to delete; the assistant calls request_delete. */
  async function askToDelete(taskId: string) {
    const result = await call(toolsFor({ currentMessageId: 'msg-1' }), 'request_delete', {
      task_id: taskId,
    });
    expect(result.confirmationRequired).toBe(true);
    return result;
  }

  /** Turn 2: the user's next message. */
  function nextTurn(text: string, previousUserMessageId = 'msg-1') {
    return toolsFor({ currentMessageId: 'msg-2', currentText: text, previousUserMessageId });
  }

  it('deletes after the user says yes in the next message', async () => {
    const asked = await askToDelete('a1');
    expect(asked.task.title).toBe('Buy milk');
    expect(db.some((task) => task.id === 'a1')).toBe(true);

    const result = await call(nextTurn('Yes, delete it'), 'delete_task', { task_id: 'a1' });
    expect(result.deleted).toEqual({ id: 'a1', title: 'Buy milk' });
    expect(db.some((task) => task.id === 'a1')).toBe(false);
    expect(store.pending.size).toBe(0);
  });

  it('refuses to delete without asking first', async () => {
    await expect(call(nextTurn('yes'), 'delete_task', { task_id: 'a1' })).rejects.toThrow(
      /not confirmed/,
    );
    expect(db.some((task) => task.id === 'a1')).toBe(true);
  });

  it('refuses to delete in the same message that asked', async () => {
    await askToDelete('a1');
    const sameTurn = toolsFor({ currentMessageId: 'msg-1', currentText: 'delete buy milk' });
    await expect(call(sameTurn, 'delete_task', { task_id: 'a1' })).rejects.toThrow(/not confirmed/);
  });

  it.each(['no', 'No, keep it', 'wait', 'cancel', 'yes... actually no', 'which one?', 'hmm'])(
    'does not delete when the reply is "%s"',
    async (reply) => {
      await askToDelete('a1');
      await expect(call(nextTurn(reply), 'delete_task', { task_id: 'a1' })).rejects.toThrow(
        /not confirmed/,
      );
      expect(db.some((task) => task.id === 'a1')).toBe(true);
    },
  );

  it('refuses to delete a different task from the one confirmed', async () => {
    await askToDelete('a1');
    await expect(call(nextTurn('yes'), 'delete_task', { task_id: 'a4' })).rejects.toThrow(
      /not confirmed/,
    );
    expect(db).toHaveLength(5);
  });

  it('refuses when the "yes" is not the very next message', async () => {
    await askToDelete('a1');
    const later = toolsFor({
      currentMessageId: 'msg-3',
      currentText: 'yes',
      previousUserMessageId: 'msg-2',
    });
    await expect(call(later, 'delete_task', { task_id: 'a1' })).rejects.toThrow(/not confirmed/);
  });

  it("cannot even ask to delete another user's task", async () => {
    await expect(call(toolsFor(), 'request_delete', { task_id: 'b1' })).rejects.toThrow(
      /Task not found/,
    );
    expect(store.pending.size).toBe(0);
  });
});

describe('cost safeguard', () => {
  it('stops after too many tool calls in one message', async () => {
    const tools = toolsFor();
    for (let i = 0; i < 8; i++) await call(tools, 'find_tasks', {});
    await expect(call(tools, 'find_tasks', {})).rejects.toThrow(/Too many steps/);
  });
});

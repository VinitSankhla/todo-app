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
  it('ignores a plain "title" field, so the current title is never mistaken for a new one', async () => {
    await expect(
      call(toolsFor(), 'update_task', { task: 'a1', title: 'Buy milk' }),
    ).rejects.toThrow(/Nothing to change/);
  });

  it('finds the task by its title, as the user said it', async () => {
    await call(toolsFor(), 'update_task', { task: 'pay RENT', new_title: 'Pay rent today' });
    expect(db[1].title).toBe('Pay rent today');
    await call(toolsFor(), 'update_task', { task: 'milk', done: true });
    expect(db[0].done).toBe(true);
  });

  it('never guesses when several tasks match', async () => {
    const error = await call(toolsFor(), 'update_task', { task: 'buy', done: true }).catch(
      (e: Error) => e.message,
    );
    expect(error).toMatch(/2 tasks match\. Do not pick one yourself/);
    expect(error).toContain('Buy milk');
    expect(error).toContain('Buy bread');
    expect(db.filter((task) => task.done)).toHaveLength(1);
  });

  it('prefers an exact title over partial matches', async () => {
    db.push({ id: 'a5', owner: ALICE, title: 'Buy milk and eggs', done: false });
    await call(toolsFor(), 'update_task', { task: 'Buy milk', done: true });
    expect(db.find((task) => task.id === 'a1')?.done).toBe(true);
    expect(db.find((task) => task.id === 'a5')?.done).toBe(false);
  });

  it('says so when no task matches', async () => {
    await expect(call(toolsFor(), 'update_task', { task: 'walk dog', done: true })).rejects.toThrow(
      /No task matches/,
    );
  });

  it('changes the title and description', async () => {
    const result = await call(toolsFor(), 'update_task', {
      task: 'a1',
      new_title: 'Buy oat milk',
      new_description: '2 litres',
    });
    expect(result.updated).toMatchObject({ title: 'Buy oat milk', description: '2 litres' });
  });

  it('adds, changes and removes a due date', async () => {
    const tools = toolsFor();
    await call(tools, 'update_task', { task: 'a1', new_due_date: 'tomorrow' });
    expect(db[0].dueDate).toBe('2026-11-06');
    await call(tools, 'update_task', { task: 'a1', new_due_date: 'in 2 weeks' });
    expect(db[0].dueDate).toBe('2026-11-19');
    await call(tools, 'update_task', { task: 'a1', remove_due_date: true });
    expect(db[0].dueDate).toBeNull();
  });

  it('marks done and undone', async () => {
    const tools = toolsFor();
    await call(tools, 'update_task', { task: 'a1', done: true });
    expect(db[0].done).toBe(true);
    await call(tools, 'update_task', { task: 'a1', done: false });
    expect(db[0].done).toBe(false);
  });

  it('removes a description with ""', async () => {
    await call(toolsFor(), 'update_task', { task: 'a2', new_description: '' });
    expect(db[1].description).toBeNull();
  });

  it('refuses empty or invalid changes', async () => {
    const tools = toolsFor();
    await expect(call(tools, 'update_task', { task: 'a1' })).rejects.toThrow(/Nothing to change/);
    await expect(call(tools, 'update_task', { task: 'a1', new_title: ' ' })).rejects.toThrow(
      'Title is required.',
    );
    await expect(
      call(tools, 'update_task', { task: 'a1', new_due_date: '31 feb' }),
    ).rejects.toThrow(/not a real date/);
  });

  it("cannot change another user's task", async () => {
    // Neither by id nor by title: another user's task looks exactly like one that does not exist.
    for (const task of ['b1', 'Bob secret plan', 'secret']) {
      await expect(call(toolsFor(), 'update_task', { task, new_title: 'hacked' })).rejects.toThrow(
        /No task matches/,
      );
    }
    expect(db[4].title).toBe('Bob secret plan');
  });
});

describe('deleting needs confirmation', () => {
  /** Turn 1: the user asks to delete; the assistant calls request_delete. */
  async function askToDelete(taskId: string) {
    const result = await call(toolsFor({ currentMessageId: 'msg-1' }), 'request_delete', {
      task: taskId,
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

    const result = await call(nextTurn('Yes, delete it'), 'confirm_delete', {});
    expect(result.deleted).toEqual({ title: 'Buy milk' });
    expect(db.some((task) => task.id === 'a1')).toBe(false);
    expect(store.pending.size).toBe(0);
  });

  it('refuses to delete without asking first', async () => {
    await expect(call(nextTurn('yes'), 'confirm_delete', {})).rejects.toThrow(/not confirmed/);
    expect(db.some((task) => task.id === 'a1')).toBe(true);
  });

  it('refuses to delete in the same message that asked', async () => {
    await askToDelete('a1');
    const sameTurn = toolsFor({ currentMessageId: 'msg-1', currentText: 'delete buy milk' });
    await expect(call(sameTurn, 'confirm_delete', {})).rejects.toThrow(/not confirmed/);
  });

  it.each(['no', 'No, keep it', 'wait', 'cancel', 'yes... actually no', 'which one?', 'hmm'])(
    'does not delete when the reply is "%s"',
    async (reply) => {
      await askToDelete('a1');
      await expect(call(nextTurn(reply), 'confirm_delete', {})).rejects.toThrow(/not confirmed/);
      expect(db.some((task) => task.id === 'a1')).toBe(true);
    },
  );

  it('deletes exactly the task that was asked about, whatever the model passes', async () => {
    await askToDelete('a4');
    await call(nextTurn('yes'), 'confirm_delete', { task: 'a1' });
    expect(db.some((task) => task.id === 'a4')).toBe(false);
    expect(db.some((task) => task.id === 'a1')).toBe(true);
  });

  it('asks which one when the title matches two tasks (the reported bug)', async () => {
    db.push({ id: 'a6', owner: ALICE, title: 'Call bank', done: false });
    const ambiguous = await call(toolsFor(), 'request_delete', { task: 'call' }).catch(
      (e: Error) => e.message,
    );
    expect(ambiguous).toMatch(/2 tasks match/);
    expect(store.pending.size).toBe(0);
    // Turn 2: the user says which; the model passes the title (it no longer has the ids).
    const asked = await call(toolsFor({ currentMessageId: 'msg-1' }), 'request_delete', {
      task: 'Call bank',
    });
    expect(asked.task.title).toBe('Call bank');
    // Turn 3: "yes" deletes exactly that task.
    await call(nextTurn('yes'), 'confirm_delete', {});
    expect(db.map((task) => task.title)).toContain('Call mom');
    expect(db.map((task) => task.title)).not.toContain('Call bank');
  });

  it('asks about only one task per message', async () => {
    const tools = toolsFor({ currentMessageId: 'msg-1' });
    await call(tools, 'request_delete', { task: 'a1' });
    await expect(call(tools, 'request_delete', { task: 'a4' })).rejects.toThrow(
      /one task can be deleted at a time/,
    );
    expect(store.pending.get('alice-sub/chat-1')?.taskId).toBe('a1');
  });

  it('refuses when the "yes" is not the very next message', async () => {
    await askToDelete('a1');
    const later = toolsFor({
      currentMessageId: 'msg-3',
      currentText: 'yes',
      previousUserMessageId: 'msg-2',
    });
    await expect(call(later, 'confirm_delete', {})).rejects.toThrow(/not confirmed/);
  });

  it("cannot even ask to delete another user's task", async () => {
    await expect(call(toolsFor(), 'request_delete', { task: 'b1' })).rejects.toThrow(
      /No task matches/,
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

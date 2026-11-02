/// <reference types="node" />
/**
 * Owner-only authorization test against the REAL sandbox backend (never production).
 * Signs in as two existing sandbox users (A and B) and proves B cannot read, change or delete
 * A's tasks. Run with `npm run test:authz`; see README for setup. It only touches tasks it
 * creates (titles start with RUN_ID) and deletes them afterwards.
 */
import { readFileSync } from 'node:fs';
import { Amplify } from 'aws-amplify';
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Schema } from '../amplify/data/resource';

const outputs = JSON.parse(readFileSync('amplify_outputs.json', 'utf8'));
if (outputs.custom?.environment !== 'sandbox') {
  throw new Error(
    'Refusing to run: amplify_outputs.json is not from the sandbox. ' +
      'Run `npx ampx sandbox --once --profile todo-dev` first. This test must never run against production.',
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.local (see .env.example).`);
  }
  return value;
}

const userA = {
  email: requiredEnv('AUTHZ_USER_A_EMAIL'),
  password: requiredEnv('AUTHZ_USER_A_PASSWORD'),
};
const userB = {
  email: requiredEnv('AUTHZ_USER_B_EMAIL'),
  password: requiredEnv('AUTHZ_USER_B_PASSWORD'),
};

Amplify.configure(outputs);
const client = generateClient<Schema>();
const RUN_ID = `authz-test-${Date.now()}`;

/** Signs in and returns the value the backend stores in `owner` for this user. */
async function loginAs(user: { email: string; password: string }): Promise<string> {
  await signOut();
  const { isSignedIn, nextStep } = await signIn({ username: user.email, password: user.password });
  if (!isSignedIn) {
    throw new Error(`Could not sign in as ${user.email} (next step: ${nextStep.signInStep}).`);
  }
  const { userId, username } = await getCurrentUser();
  return `${userId}::${username}`;
}

async function deleteOwnTestTasks(ownerKey: string) {
  const { data } = await client.models.Task.listTasksByOwner({ owner: ownerKey });
  for (const task of data.filter((t) => t.title.startsWith(RUN_ID))) {
    await client.models.Task.delete({ id: task.id });
  }
}

let ownerA = '';
let ownerB = '';
let taskAId = '';
let taskBId = '';

beforeAll(async () => {
  ownerA = await loginAs(userA);
  const a = await client.mutations.addTask({
    title: `${RUN_ID} A private`,
    description: 'Only user A may see this',
    dueDate: '2030-01-15',
  });
  expect(a.errors).toBeUndefined();
  taskAId = a.data!.id;

  ownerB = await loginAs(userB);
  expect(ownerB).not.toBe(ownerA);
  const b = await client.mutations.addTask({ title: `${RUN_ID} B own` });
  expect(b.errors).toBeUndefined();
  taskBId = b.data!.id;
});

afterAll(async () => {
  // Best-effort cleanup of this run's tasks for both users.
  if (ownerA) await loginAs(userA).then(deleteOwnTestTasks);
  if (ownerB) await loginAs(userB).then(deleteOwnTestTasks);
  await signOut();
});

describe('user B cannot access user A’s tasks', () => {
  it('stores B’s new task with B as owner', async () => {
    const { data } = await client.models.Task.get({ id: taskBId });
    expect(data?.owner).toBe(ownerB);
  });

  it('cannot list A’s tasks through the owner index', async () => {
    const { data } = await client.models.Task.listTasksByOwner({ owner: ownerA });
    expect(data.map((t) => t.id)).not.toContain(taskAId);
    expect(data.every((t) => t.owner === ownerB)).toBe(true);
  });

  it('sees only its own tasks when listing everything', async () => {
    const { data } = await client.models.Task.list({ limit: 1000 });
    expect(data.map((t) => t.id)).not.toContain(taskAId);
    expect(data.every((t) => t.owner === ownerB)).toBe(true);
  });

  it('cannot read A’s task by id', async () => {
    const { data } = await client.models.Task.get({ id: taskAId });
    expect(data).toBeNull();
  });

  it('cannot rename or complete A’s task', async () => {
    const rename = await client.mutations.editTask({ id: taskAId, title: 'hacked' });
    expect(rename.data).toBeNull();
    expect(rename.errors?.[0]?.message).toBe('Task not found.');

    const complete = await client.mutations.editTask({ id: taskAId, done: true });
    expect(complete.data).toBeNull();
    expect(complete.errors?.[0]?.message).toBe('Task not found.');
  });

  it('cannot delete A’s task', async () => {
    const { data, errors } = await client.models.Task.delete({ id: taskAId });
    expect(data).toBeNull();
    expect(errors?.length).toBeGreaterThan(0);
  });

  it('cannot create a task owned by someone else', async () => {
    const attempt = client.graphql({
      query: `mutation { addTask(title: "${RUN_ID} forged", owner: "${ownerA}") { id owner } }`,
    });
    await expect(attempt).rejects.toBeTruthy();
  });

  it('cannot use the disabled built-in create/update mutations', async () => {
    const create = client.graphql({
      query: `mutation { createTask(input: { title: "${RUN_ID} raw", done: false, owner: "${ownerA}" }) { id } }`,
    });
    await expect(create).rejects.toBeTruthy();
    const update = client.graphql({
      query: `mutation { updateTask(input: { id: "${taskAId}", owner: "${ownerB}" }) { id } }`,
    });
    await expect(update).rejects.toBeTruthy();
  });
});

describe('user A’s task is untouched', () => {
  beforeAll(async () => {
    await loginAs(userA);
  });

  it('still exists with its original values', async () => {
    const { data } = await client.models.Task.get({ id: taskAId });
    expect(data).toMatchObject({
      title: `${RUN_ID} A private`,
      description: 'Only user A may see this',
      dueDate: '2030-01-15',
      done: false,
      owner: ownerA,
    });
  });

  it('does not see B’s task', async () => {
    const { data } = await client.models.Task.listTasksByOwner({ owner: ownerA });
    const ids = data.map((t) => t.id);
    expect(ids).toContain(taskAId);
    expect(ids).not.toContain(taskBId);
  });
});

describe('server-side validation and editing (as user A)', () => {
  it('rejects a blank title', async () => {
    const { data, errors } = await client.mutations.addTask({ title: '   ' });
    expect(data).toBeNull();
    expect(errors?.[0]?.message).toBe('Title is required.');
  });

  it('rejects an impossible due date on edit', async () => {
    const { errors } = await client.mutations.editTask({ id: taskAId, dueDate: '2026-02-30' });
    expect(errors?.[0]?.message).toBe('Due date is not a real date.');
  });

  it('changes and clears the due date, and marks done', async () => {
    const changed = await client.mutations.editTask({ id: taskAId, dueDate: '2031-06-30' });
    expect(changed.data?.dueDate).toBe('2031-06-30');

    const cleared = await client.mutations.editTask({ id: taskAId, dueDate: '' });
    expect(cleared.data?.dueDate ?? null).toBeNull();

    const done = await client.mutations.editTask({ id: taskAId, done: true });
    expect(done.data?.done).toBe(true);
  });
});

describe('signed-out requests', () => {
  it('are rejected', async () => {
    await signOut();
    const attempt = client.models.Task.list().then(({ errors }) => {
      if (errors?.length) throw new Error(errors[0].message);
    });
    await expect(attempt).rejects.toBeTruthy();
  });
});

/// <reference types="node" />
/**
 * Proves the AI assistant cannot read or change another user's tasks or chats, against the REAL
 * sandbox backend (never production). Signs in as the same two sandbox users as authz.test.ts.
 * Run with `npm run test:assistant-authz`. It makes about 5 AI model calls (well under 1 US cent)
 * and only touches tasks and chats it creates, deleting them afterwards.
 */
import { readFileSync } from 'node:fs';
import { Amplify } from 'aws-amplify';
import { signIn, signOut } from 'aws-amplify/auth';
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
  if (!value) throw new Error(`Missing ${name}. Add it to .env.local (see .env.example).`);
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
const RUN_ID = `ai-authz-${Date.now()}`;
const A_TITLE = `${RUN_ID} A private`;
// Only ever written in A's task description; it must never appear in anything B receives.
const A_SECRET = `SECRET${Date.now()}`;

async function loginAs(user: { email: string; password: string }) {
  await signOut();
  const { isSignedIn } = await signIn({ username: user.email, password: user.password });
  if (!isSignedIn) throw new Error(`Could not sign in as ${user.email}.`);
}

type Chat = NonNullable<Awaited<ReturnType<typeof client.conversations.assistant.create>>['data']>;

/** Sends a message and waits for the full reply (or an error). */
async function ask(chat: Chat, text: string): Promise<string> {
  let reply = '';
  let messageId = '';
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const early: Array<{ id: string; text?: string; done?: boolean }> = [];
  const handle = (id: string, piece?: string, done?: boolean) => {
    if (!messageId) return early.push({ id, text: piece, done });
    if (id !== messageId) return;
    if (piece) reply += piece;
    if (done) finish();
  };
  const subscription = chat.onStreamEvent({
    next: (event) => handle(event.associatedUserMessageId, event.text, !!event.stopReason),
    error: (event) => {
      reply += ` [error: ${event.errors?.map((e) => e.errorType).join(',')}]`;
      finish();
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 1500)); // let the subscription connect
  const { data, errors } = await chat.sendMessage({
    content: [{ text }],
    aiContext: { timeZone: 'Asia/Kolkata' },
  });
  if (errors?.length || !data) throw new Error(`sendMessage failed: ${JSON.stringify(errors)}`);
  messageId = data.id;
  for (const event of early) handle(event.id, event.text, event.done);
  await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 45_000))]);
  subscription.unsubscribe();
  return reply;
}

type RawResult = { data?: Record<string, unknown> | null; errors?: unknown[] };

/** A raw GraphQL request; the Amplify client throws on GraphQL errors, so catch them too. */
async function rawGraphql(query: string, variables: Record<string, unknown>): Promise<RawResult> {
  try {
    return (await (client.graphql({ query, variables }) as Promise<RawResult>)) ?? {};
  } catch (error) {
    return error as RawResult;
  }
}

let taskAId = '';
let chatAId = '';
const chatsToDelete: Array<{ user: typeof userA; id: string }> = [];

beforeAll(async () => {
  await loginAs(userA);
  const task = await client.mutations.addTask({ title: A_TITLE, description: A_SECRET });
  expect(task.errors).toBeUndefined();
  taskAId = task.data!.id;
  const { data: chat } = await client.conversations.assistant.create();
  chatAId = chat!.id;
  chatsToDelete.push({ user: userA, id: chatAId });
  await ask(chat!, 'hi');
  await loginAs(userB);
});

afterAll(async () => {
  for (const user of [userA, userB]) {
    await loginAs(user);
    for (const chat of chatsToDelete.filter((c) => c.user === user)) {
      await client.conversations.assistant.delete({ id: chat.id });
    }
    if (user === userA && taskAId) await client.models.Task.delete({ id: taskAId });
  }
  await signOut();
});

describe("user B cannot reach user A's chats", () => {
  it("cannot open A's chat", async () => {
    const { data } = await client.conversations.assistant.get({ id: chatAId });
    expect(data).toBeNull();
  });

  it("does not see A's chat in its chat list", async () => {
    const { data } = await client.conversations.assistant.list();
    expect(data.map((chat) => chat.id)).not.toContain(chatAId);
  });

  it("cannot read A's chat messages", async () => {
    const result = await rawGraphql(
      `query ($id: ID!) {
        listConversationMessageAssistants(filter: { conversationId: { eq: $id } }) {
          items { id content { text } }
        }
      }`,
      { id: chatAId },
    );
    const list = result.data?.listConversationMessageAssistants as { items: unknown[] } | null;
    const items = list?.items ?? [];
    expect(items).toEqual([]);
  });

  it("cannot send a message into A's chat", async () => {
    const result = await rawGraphql(
      `mutation ($id: ID!) {
        assistant(conversationId: $id, content: [{ text: "list my tasks" }]) { id }
      }`,
      { id: chatAId },
    );
    expect(result.data?.assistant ?? null).toBeNull();
    expect(result.errors?.length).toBeGreaterThan(0);
  });
});

describe("user B's assistant cannot read or change user A's tasks", () => {
  let chat: Chat;

  beforeAll(async () => {
    const { data } = await client.conversations.assistant.create();
    chat = data!;
    chatsToDelete.push({ user: userB, id: chat.id });
  });

  it("does not reveal A's task when listing", { timeout: 60_000 }, async () => {
    const reply = await ask(chat, 'List all my tasks with their descriptions.');
    expect(reply).not.toContain(A_SECRET);
    expect(reply).not.toContain(RUN_ID);
  });

  it("cannot rename A's task", { timeout: 60_000 }, async () => {
    await ask(chat, `Rename the task "${A_TITLE}" to hacked`);
  });

  it("cannot delete A's task, even after saying yes", { timeout: 120_000 }, async () => {
    await ask(chat, `Delete the task "${A_TITLE}"`);
    await ask(chat, 'yes');
  });

  it("A's task is unchanged afterwards", async () => {
    await loginAs(userA);
    const { data } = await client.models.Task.get({ id: taskAId });
    expect(data).toMatchObject({ title: A_TITLE, description: A_SECRET, done: false });
    await loginAs(userB);
  });
});

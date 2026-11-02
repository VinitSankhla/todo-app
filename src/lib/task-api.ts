import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

export type Task = Schema['Task']['type'];

export interface NewTask {
  title: string;
  description: string;
  dueDate: string;
}

/** Fields to change. An empty description or dueDate clears that field. */
export type TaskChanges = Partial<NewTask & { done: boolean }>;

let client: ReturnType<typeof generateClient<Schema>> | undefined;

// Created on first use so Amplify.configure() in main.tsx has already run.
function getClient() {
  client ??= generateClient<Schema>();
  return client;
}

interface GraphQLErrorLike {
  message: string;
  errorType?: string;
}

/** The data client returns GraphQL errors instead of throwing; turn them into exceptions. */
function throwIfErrors(errors: readonly GraphQLErrorLike[] | undefined): void {
  const first = errors?.[0];
  if (!first) return;
  const error = new Error(first.message);
  error.name = first.errorType ?? 'TaskApiError';
  throw error;
}

/** All of the signed-in user's tasks, newest first (follows pagination). */
export async function listTasks(ownerKey: string): Promise<Task[]> {
  const tasks: Task[] = [];
  let nextToken: string | null | undefined;
  do {
    const result = await getClient().models.Task.listTasksByOwner(
      { owner: ownerKey },
      { sortDirection: 'DESC', limit: 100, nextToken },
    );
    throwIfErrors(result.errors);
    tasks.push(...result.data);
    nextToken = result.nextToken;
  } while (nextToken);
  return tasks;
}

export async function addTask(input: NewTask): Promise<Task> {
  const { data, errors } = await getClient().mutations.addTask({
    title: input.title,
    description: input.description || undefined,
    dueDate: input.dueDate || undefined,
  });
  throwIfErrors(errors);
  if (!data) throw new Error('The task could not be saved. Please try again.');
  return data;
}

export async function editTask(id: string, changes: TaskChanges): Promise<Task> {
  const { data, errors } = await getClient().mutations.editTask({
    id,
    ...(changes.title !== undefined && { title: changes.title }),
    ...(changes.description !== undefined && { description: changes.description }),
    ...(changes.dueDate !== undefined && { dueDate: changes.dueDate || null }),
    ...(changes.done !== undefined && { done: changes.done }),
  });
  throwIfErrors(errors);
  if (!data) throw new Error('The task could not be updated. Please try again.');
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  const { errors } = await getClient().models.Task.delete({ id });
  throwIfErrors(errors);
}

/** Friendly message for anything thrown by the functions above. */
export function getTaskErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong. Please try again.';
  if (error.name === 'Unauthorized' || error.name === 'UserUnAuthenticatedException') {
    return 'Your session has expired. Please log out and log in again.';
  }
  if (error.name === 'NetworkError' || error.message === 'Network Error') {
    return 'Network error. Check your internet connection and try again.';
  }
  return error.message || 'Something went wrong. Please try again.';
}

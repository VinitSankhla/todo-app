// In-memory stand-ins for the task API and the assistant's DynamoDB table, used by unit tests.
import { TaskApiError, type TaskClient, type TaskRecord } from './task-client';
import type { AssistantStore, PendingDelete } from './usage-store';

export interface StoredTask extends TaskRecord {
  owner: string;
}

/**
 * Behaves like the real API for one signed-in user: it can only see and change tasks whose
 * owner is `ownerKey`; other users' tasks look exactly like tasks that do not exist.
 */
export function fakeTaskClient(db: StoredTask[], ownerKey: string): TaskClient {
  let nextId = 1;
  const own = (id: string) => db.find((task) => task.id === id && task.owner === ownerKey);
  const view = (task: StoredTask): TaskRecord => {
    const { owner, ...visible } = task;
    void owner; // the real API never returns the owner field to the assistant either
    return visible;
  };
  return {
    async listTasks() {
      return db.filter((task) => task.owner === ownerKey).map(view);
    },
    async getTask(id) {
      const task = own(id);
      return task ? view(task) : null;
    },
    async addTask(input) {
      const task: StoredTask = {
        id: `new-${nextId++}`,
        owner: ownerKey,
        title: input.title,
        description: input.description || null,
        dueDate: input.dueDate || null,
        done: false,
      };
      db.push(task);
      return view(task);
    },
    async editTask(id, changes) {
      const task = own(id);
      if (!task) throw new TaskApiError('Task not found.');
      if (changes.title !== undefined) task.title = changes.title;
      if (changes.description !== undefined) task.description = changes.description || null;
      if (changes.dueDate !== undefined) task.dueDate = changes.dueDate || null;
      if (changes.done !== undefined) task.done = changes.done;
      return view(task);
    },
    async deleteTask(id) {
      const task = own(id);
      if (!task) throw new TaskApiError('Task not found.');
      db.splice(db.indexOf(task), 1);
    },
  };
}

export function fakeStore(): AssistantStore & { pending: Map<string, PendingDelete> } {
  const pending = new Map<string, PendingDelete>();
  const key = (userId: string, conversationId: string) => `${userId}/${conversationId}`;
  return {
    pending,
    async countRequest() {
      return null;
    },
    async getPendingDelete(userId, conversationId) {
      return pending.get(key(userId, conversationId)) ?? null;
    },
    async setPendingDelete(userId, conversationId, value) {
      pending.set(key(userId, conversationId), value);
    },
    async clearPendingDelete(userId, conversationId) {
      pending.delete(key(userId, conversationId));
    },
  };
}

/**
 * The assistant's only way to touch tasks: the app's own GraphQL API (listTasksByOwner, getTask,
 * addTask, editTask, deleteTask), called with the signed-in user's own token.
 * So the assistant gets exactly the same server-side validation and owner-only authorization as
 * the buttons in the app. It has no direct database access and no way to act as another user.
 */

export interface TaskRecord {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  done: boolean;
  createdAt?: string | null;
}

export interface TaskChanges {
  title?: string;
  description?: string;
  /** YYYY-MM-DD, or "" to remove the due date. */
  dueDate?: string;
  done?: boolean;
}

export interface TaskClient {
  listTasks(): Promise<TaskRecord[]>;
  getTask(id: string): Promise<TaskRecord | null>;
  addTask(input: { title: string; description?: string; dueDate?: string }): Promise<TaskRecord>;
  editTask(id: string, changes: TaskChanges): Promise<TaskRecord>;
  deleteTask(id: string): Promise<void>;
}

export type GraphqlRequest = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** An error from the task API that is safe to show the AI model (and so the user). */
export class TaskApiError extends Error {
  override name = 'TaskApiError';
}

const TASK_FIELDS = 'id title description dueDate done createdAt';
/** The most tasks the assistant reads in one request. */
export const MAX_TASKS_READ = 500;

export function createGraphqlRequest(
  endpoint: string,
  authorization: string,
  fetchFn: typeof fetch = fetch,
): GraphqlRequest {
  return async (query, variables) => {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new TaskApiError('The task service is unavailable.');
    const body = (await response.json()) as {
      data?: Record<string, unknown>;
      errors?: Array<{ message?: string; errorType?: string }>;
    };
    const error = body.errors?.[0];
    if (error) {
      // Authorization failures look the same as "not found" so nothing leaks about other users.
      if (
        /unauthori[sz]ed|not authori[sz]ed|ConditionalCheckFailed/i.test(
          `${error.errorType} ${error.message}`,
        )
      ) {
        throw new TaskApiError('Task not found.');
      }
      throw new TaskApiError(error.message ?? 'The task request failed.');
    }
    return body.data ?? {};
  };
}

export function createTaskClient(request: GraphqlRequest, ownerKey: string): TaskClient {
  return {
    async listTasks() {
      const tasks: TaskRecord[] = [];
      let nextToken: string | null = null;
      do {
        const data = await request(
          `query ListTasks($owner: String!, $nextToken: String) {
            listTasksByOwner(owner: $owner, sortDirection: DESC, limit: 100, nextToken: $nextToken) {
              items { ${TASK_FIELDS} }
              nextToken
            }
          }`,
          { owner: ownerKey, nextToken },
        );
        const page = data.listTasksByOwner as { items: TaskRecord[]; nextToken: string | null };
        tasks.push(...page.items);
        nextToken = page.nextToken;
      } while (nextToken && tasks.length < MAX_TASKS_READ);
      return tasks;
    },

    async getTask(id) {
      const data = await request(
        `query GetTask($id: ID!) { getTask(id: $id) { ${TASK_FIELDS} } }`,
        {
          id,
        },
      );
      return (data.getTask as TaskRecord | null) ?? null;
    },

    async addTask(input) {
      const data = await request(
        `mutation AddTask($title: String!, $description: String, $dueDate: AWSDate) {
          addTask(title: $title, description: $description, dueDate: $dueDate) { ${TASK_FIELDS} }
        }`,
        {
          title: input.title,
          description: input.description || null,
          dueDate: input.dueDate || null,
        },
      );
      if (!data.addTask) throw new TaskApiError('The task could not be saved.');
      return data.addTask as TaskRecord;
    },

    async editTask(id, changes) {
      const data = await request(
        `mutation EditTask($id: ID!, $title: String, $description: String, $dueDate: String, $done: Boolean) {
          editTask(id: $id, title: $title, description: $description, dueDate: $dueDate, done: $done) { ${TASK_FIELDS} }
        }`,
        { id, ...changes },
      );
      if (!data.editTask) throw new TaskApiError('Task not found.');
      return data.editTask as TaskRecord;
    },

    async deleteTask(id) {
      const data = await request(
        `mutation DeleteTask($input: DeleteTaskInput!) { deleteTask(input: $input) { id } }`,
        { input: { id } },
      );
      if (!data.deleteTask) throw new TaskApiError('Task not found.');
    },
  };
}

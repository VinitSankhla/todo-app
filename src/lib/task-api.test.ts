import { beforeEach, describe, expect, it, vi } from 'vitest';

const editTaskMutation = vi.fn();
const addTaskMutation = vi.fn();

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    mutations: { editTask: editTaskMutation, addTask: addTaskMutation },
  }),
}));

const { addTask, editTask } = await import('./task-api');

beforeEach(() => {
  editTaskMutation.mockReset().mockResolvedValue({ data: { id: 't1' }, errors: undefined });
  addTaskMutation.mockReset().mockResolvedValue({ data: { id: 't1' }, errors: undefined });
});

describe('task-api arguments sent to the server', () => {
  // Regression: clearing a date sent null, which the resolver treated as "unchanged".
  it('sends an empty string (not null) to clear the due date and description', async () => {
    await editTask('t1', { title: 'T', description: '', dueDate: '' });
    expect(editTaskMutation).toHaveBeenCalledWith({
      id: 't1',
      title: 'T',
      description: '',
      dueDate: '',
    });
  });

  it('only sends the fields being changed', async () => {
    await editTask('t1', { done: true });
    expect(editTaskMutation).toHaveBeenCalledWith({ id: 't1', done: true });
  });

  it('omits empty optional fields when adding', async () => {
    await addTask({ title: 'T', description: '', dueDate: '' });
    expect(addTaskMutation).toHaveBeenCalledWith({
      title: 'T',
      description: undefined,
      dueDate: undefined,
    });
  });

  it('throws the first GraphQL error returned by the server', async () => {
    editTaskMutation.mockResolvedValue({
      data: null,
      errors: [{ message: 'Task not found.', errorType: 'NotFound' }],
    });
    await expect(editTask('t1', { done: true })).rejects.toMatchObject({
      name: 'NotFound',
      message: 'Task not found.',
    });
  });
});

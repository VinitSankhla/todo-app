import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { addTask, deleteTask, editTask, listTasks, type Task } from '../lib/task-api';
import TasksPage from '../pages/TasksPage';

vi.mock('../lib/task-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/task-api')>()),
  listTasks: vi.fn(),
  addTask: vi.fn(),
  editTask: vi.fn(),
  deleteTask: vi.fn(),
}));

const OWNER = 'sub-1::user-1';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Buy milk',
    description: null,
    dueDate: null,
    done: false,
    owner: OWNER,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  } as Task;
}

function serverError(message: string, name = 'ValidationError') {
  const error = new Error(message);
  error.name = name;
  return error;
}

function renderTasks() {
  const auth: AuthContextValue = {
    state: {
      status: 'signedIn',
      user: { userId: 'sub-1', ownerKey: OWNER, email: 'vinit@gmail.com', name: 'Vinit' },
    },
    refresh: vi.fn(),
    logout: vi.fn(),
  };
  const user = userEvent.setup();
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return user;
}

const addForm = () => within(screen.getByRole('region', { name: 'Add a task' }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loading tasks', () => {
  it('shows a loading state, then only the signed-in user’s tasks', async () => {
    vi.mocked(listTasks).mockResolvedValue([
      makeTask(),
      makeTask({ id: 't2', title: 'Pay rent', done: true }),
    ]);
    renderTasks();

    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks…');
    expect(await screen.findByText('Buy milk')).toBeInTheDocument();
    expect(screen.getByText('Pay rent')).toBeInTheDocument();
    expect(listTasks).toHaveBeenCalledWith(OWNER);
    expect(screen.getByRole('button', { name: /^All/ })).toHaveTextContent('All (2)');
    expect(screen.getByRole('button', { name: /^Active/ })).toHaveTextContent('Active (1)');
    expect(screen.getByRole('button', { name: /^Done/ })).toHaveTextContent('Done (1)');
  });

  it('shows an empty state when there are no tasks', async () => {
    vi.mocked(listTasks).mockResolvedValue([]);
    renderTasks();
    expect(await screen.findByText('No tasks yet. Add your first task above.')).toBeInTheDocument();
  });

  it('shows an error with a working "Try again" button', async () => {
    vi.mocked(listTasks)
      .mockRejectedValueOnce(serverError('Network Error', 'Error'))
      .mockResolvedValueOnce([makeTask()]);
    const user = renderTasks();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your tasks. Network error.',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Buy milk')).toBeInTheDocument();
  });
});

describe('adding a task', () => {
  it('requires a title and does not call the server without one', async () => {
    vi.mocked(listTasks).mockResolvedValue([]);
    const user = renderTasks();
    await screen.findByText(/No tasks yet/);

    await user.type(addForm().getByLabelText('Title'), '   ');
    await user.click(addForm().getByRole('button', { name: 'Add task' }));
    expect(addForm().getByText('Title is required.')).toBeInTheDocument();
    await waitFor(() => expect(addForm().getByLabelText('Title')).toHaveFocus());
    expect(addTask).not.toHaveBeenCalled();
  });

  it('adds a trimmed task to the top of the list and clears the form', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    vi.mocked(addTask).mockResolvedValue(
      makeTask({ id: 'new', title: 'Call mom', description: 'Sunday', dueDate: '2030-01-05' }),
    );
    const user = renderTasks();
    await screen.findByText('Buy milk');

    await user.type(addForm().getByLabelText('Title'), '  Call mom  ');
    await user.type(addForm().getByLabelText(/Description/), 'Sunday');
    await user.click(addForm().getByRole('button', { name: 'Add task' }));

    expect(addTask).toHaveBeenCalledWith({ title: 'Call mom', description: 'Sunday', dueDate: '' });
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Call mom');
    expect(items[0]).toHaveTextContent('Due');
    expect(addForm().getByLabelText('Title')).toHaveValue('');
  });

  it('shows validation errors returned by the server', async () => {
    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(addTask).mockRejectedValue(serverError('Title must be 200 characters or fewer.'));
    const user = renderTasks();
    await screen.findByText(/No tasks yet/);

    await user.type(addForm().getByLabelText('Title'), 'Something');
    await user.click(addForm().getByRole('button', { name: 'Add task' }));
    expect(await addForm().findByRole('alert')).toHaveTextContent(
      'Title must be 200 characters or fewer.',
    );
    expect(addForm().getByLabelText('Title')).toHaveValue('Something');
  });
});

describe('editing a task', () => {
  it('edits title, description and due date', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask({ description: 'old' })]);
    vi.mocked(editTask).mockResolvedValue(makeTask({ title: 'Buy oat milk', description: null }));
    const user = renderTasks();

    await user.click(await screen.findByRole('button', { name: 'Edit “Buy milk”' }));
    const item = within(screen.getByRole('listitem'));
    await user.clear(item.getByLabelText('Title'));
    await user.type(item.getByLabelText('Title'), 'Buy oat milk');
    await user.clear(item.getByLabelText(/Description/));
    await user.click(item.getByRole('button', { name: 'Save changes' }));

    expect(editTask).toHaveBeenCalledWith('t1', {
      title: 'Buy oat milk',
      description: '',
      dueDate: '',
    });
    expect(await screen.findByText('Buy oat milk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('can cancel editing without saving', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    const user = renderTasks();
    await user.click(await screen.findByRole('button', { name: 'Edit “Buy milk”' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(editTask).not.toHaveBeenCalled();
  });

  it('shows "Task not found" if the server refuses the edit', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    vi.mocked(editTask).mockRejectedValue(serverError('Task not found.', 'NotFound'));
    const user = renderTasks();
    await user.click(await screen.findByRole('button', { name: 'Edit “Buy milk”' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found.');
  });
});

describe('done / undone and filters', () => {
  it('marks a task done and filters by status', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask(), makeTask({ id: 't2', title: 'Pay rent' })]);
    vi.mocked(editTask).mockResolvedValue(makeTask({ done: true }));
    const user = renderTasks();

    await user.click(await screen.findByRole('checkbox', { name: 'Mark “Buy milk” as done' }));
    expect(editTask).toHaveBeenCalledWith('t1', { done: true });
    expect(
      await screen.findByRole('checkbox', { name: 'Mark “Buy milk” as not done' }),
    ).toBeChecked();

    await user.click(screen.getByRole('button', { name: /^Done/ }));
    expect(screen.getByRole('button', { name: /^Done/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(screen.queryByText('Pay rent')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Active/ }));
    expect(screen.getByText('Pay rent')).toBeInTheDocument();
    expect(screen.queryByText('Buy milk')).not.toBeInTheDocument();
  });

  it('marks a done task as not done', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask({ done: true })]);
    vi.mocked(editTask).mockResolvedValue(makeTask({ done: false }));
    const user = renderTasks();
    await user.click(await screen.findByRole('checkbox', { name: 'Mark “Buy milk” as not done' }));
    expect(editTask).toHaveBeenCalledWith('t1', { done: false });
  });

  it('shows filter-specific empty messages', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    const user = renderTasks();
    await screen.findByText('Buy milk');
    await user.click(screen.getByRole('button', { name: /^Done/ }));
    expect(screen.getByText('No completed tasks yet.')).toBeInTheDocument();
  });

  it('highlights overdue tasks that are not done', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask({ dueDate: '2001-01-01' })]);
    renderTasks();
    expect(await screen.findByText(/Overdue — was due/)).toBeInTheDocument();
  });
});

describe('deleting a task', () => {
  it('asks for confirmation; Cancel and Escape keep the task', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    const user = renderTasks();

    await user.click(await screen.findByRole('button', { name: 'Delete “Buy milk”' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete task?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete “Buy milk”' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('keeps keyboard focus inside the dialog', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    const user = renderTasks();
    await user.click(await screen.findByRole('button', { name: 'Delete “Buy milk”' }));
    const dialog = within(screen.getByRole('alertdialog'));
    await user.tab();
    expect(dialog.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.tab();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('deletes after confirmation', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    vi.mocked(deleteTask).mockResolvedValue();
    const user = renderTasks();

    await user.click(await screen.findByRole('button', { name: 'Delete “Buy milk”' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(deleteTask).toHaveBeenCalledWith('t1');
    expect(await screen.findByText('No tasks yet. Add your first task above.')).toBeInTheDocument();
  });

  it('shows an error and keeps the task if deleting fails', async () => {
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    vi.mocked(deleteTask).mockRejectedValue(serverError('Not Authorized', 'Unauthorized'));
    const user = renderTasks();

    await user.click(await screen.findByRole('button', { name: 'Delete “Buy milk”' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has expired.');
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });
});

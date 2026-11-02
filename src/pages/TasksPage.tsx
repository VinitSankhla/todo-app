import { useCallback, useEffect, useState } from 'react';
import type { TaskInput } from '../../shared/task-validation';
import { useAuth } from '../auth/auth-context';
import { TaskForm } from '../components/TaskForm';
import { TaskItem } from '../components/TaskItem';
import { Alert, Button, Spinner } from '../components/ui';
import {
  addTask,
  deleteTask,
  editTask,
  getTaskErrorMessage,
  listTasks,
  type Task,
  type TaskChanges,
} from '../lib/task-api';

type Filter = 'all' | 'active' | 'done';

const FILTERS: { value: Filter; label: string; empty: string }[] = [
  { value: 'all', label: 'All', empty: 'No tasks yet. Add your first task above.' },
  { value: 'active', label: 'Active', empty: 'No active tasks. Nice work!' },
  { value: 'done', label: 'Done', empty: 'No completed tasks yet.' },
];

type LoadState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; tasks: Task[] };

export default function TasksPage() {
  const { state, logout } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;
  const ownerKey = user?.ownerKey ?? '';
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');
  const [loggingOut, setLoggingOut] = useState(false);

  const fetchTasks = useCallback(
    () =>
      listTasks(ownerKey).then(
        (tasks): LoadState => ({ status: 'ready', tasks }),
        (error: unknown): LoadState => ({ status: 'error', message: getTaskErrorMessage(error) }),
      ),
    [ownerKey],
  );

  useEffect(() => {
    let active = true;
    fetchTasks().then((next) => {
      if (active) setLoad(next);
    });
    return () => {
      active = false;
    };
  }, [fetchTasks]);

  async function handleRetry() {
    setLoad({ status: 'loading' });
    setLoad(await fetchTasks());
  }

  const updateTasks = (change: (tasks: Task[]) => Task[]) =>
    setLoad((current) =>
      current.status === 'ready' ? { status: 'ready', tasks: change(current.tasks) } : current,
    );

  async function handleAdd(input: TaskInput) {
    const created = await addTask(input);
    updateTasks((tasks) => [created, ...tasks]);
  }

  async function handleEdit(id: string, changes: TaskChanges) {
    const updated = await editTask(id, changes);
    updateTasks((tasks) => tasks.map((task) => (task.id === id ? updated : task)));
  }

  async function handleDelete(id: string) {
    await deleteTask(id);
    updateTasks((tasks) => tasks.filter((task) => task.id !== id));
  }

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  const tasks = load.status === 'ready' ? load.tasks : [];
  const counts: Record<Filter, number> = {
    all: tasks.length,
    active: tasks.filter((task) => !task.done).length,
    done: tasks.filter((task) => task.done).length,
  };
  const visible = tasks.filter((task) =>
    filter === 'all' ? true : filter === 'done' ? task.done : !task.done,
  );
  const currentFilter = FILTERS.find((f) => f.value === filter)!;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <p className="truncate text-sm text-slate-700">
            Signed in as <span className="font-medium text-slate-900">{user?.name}</span>
          </p>
          <Button variant="secondary" loading={loggingOut} onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
        <h1 className="text-2xl font-semibold text-slate-900">My tasks</h1>

        <section
          aria-labelledby="add-task-heading"
          className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6"
        >
          <h2 id="add-task-heading" className="mb-3 text-lg font-medium text-slate-900">
            Add a task
          </h2>
          <TaskForm submitLabel="Add task" onSubmit={handleAdd} resetOnSuccess />
        </section>

        <section aria-labelledby="task-list-heading" className="space-y-4">
          <h2 id="task-list-heading" className="sr-only">
            Task list
          </h2>
          <div role="group" aria-label="Filter tasks" className="flex flex-wrap gap-2">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  filter === value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100'
                }`}
              >
                {label} <span aria-hidden="true">({counts[value]})</span>
                <span className="sr-only">, {counts[value]} tasks</span>
              </button>
            ))}
          </div>

          {load.status === 'loading' && (
            <div className="py-8 text-center text-slate-600">
              <Spinner label="Loading tasks…" />
            </div>
          )}

          {load.status === 'error' && (
            <div className="space-y-3">
              <Alert kind="error">Could not load your tasks. {load.message}</Alert>
              <Button variant="secondary" onClick={handleRetry}>
                Try again
              </Button>
            </div>
          )}

          {load.status === 'ready' &&
            (visible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-600">
                {currentFilter.empty}
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map((task) => (
                  <TaskItem key={task.id} task={task} onEdit={handleEdit} onDelete={handleDelete} />
                ))}
              </ul>
            ))}
        </section>
      </main>
    </div>
  );
}

import { useState } from 'react';
import type { TaskInput } from '../../shared/task-validation';
import { formatDueDate, todayISODate } from '../lib/dates';
import { getTaskErrorMessage, type Task, type TaskChanges } from '../lib/task-api';
import { ConfirmDialog } from './ConfirmDialog';
import { TaskForm } from './TaskForm';
import { Alert, Button } from './ui';

interface TaskItemProps {
  task: Task;
  onEdit: (id: string, changes: TaskChanges) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function TaskItem({ task, onEdit, onDelete }: TaskItemProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null);
  const [error, setError] = useState('');

  const overdue = !task.done && !!task.dueDate && task.dueDate < todayISODate();

  async function handleToggle() {
    setError('');
    setBusy('toggle');
    try {
      await onEdit(task.id, { done: !task.done });
    } catch (err) {
      setError(getTaskErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSave(input: TaskInput) {
    await onEdit(task.id, input);
    setEditing(false);
  }

  async function handleDelete() {
    setError('');
    setBusy('delete');
    try {
      await onDelete(task.id);
      // On success the parent removes this item, so no state updates here.
    } catch (err) {
      setError(getTaskErrorMessage(err));
      setBusy(null);
      setConfirmingDelete(false);
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-indigo-200">
        <h3 className="sr-only">Edit task “{task.title}”</h3>
        <TaskForm
          initial={{
            title: task.title,
            description: task.description ?? '',
            dueDate: task.dueDate ?? '',
          }}
          submitLabel="Save changes"
          onSubmit={handleSave}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id={`done-${task.id}`}
          checked={task.done}
          disabled={busy !== null}
          onChange={handleToggle}
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-indigo-600"
          aria-label={`Mark “${task.title}” as ${task.done ? 'not done' : 'done'}`}
        />
        <div className="min-w-0 flex-1">
          <p
            className={`break-words font-medium ${task.done ? 'text-slate-500 line-through' : 'text-slate-900'}`}
          >
            {task.title}
          </p>
          {task.description && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">
              {task.description}
            </p>
          )}
          {task.dueDate && (
            <p
              className={`mt-1 text-xs ${overdue ? 'font-medium text-red-700' : 'text-slate-500'}`}
            >
              {overdue ? 'Overdue — was due ' : 'Due '}
              <time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time>
            </p>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => setEditing(true)}
          disabled={busy !== null}
          aria-label={`Edit “${task.title}”`}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          onClick={() => setConfirmingDelete(true)}
          disabled={busy !== null}
          aria-label={`Delete “${task.title}”`}
          className="text-red-700"
        >
          Delete
        </Button>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete task?"
          message={`“${task.title}” will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete"
          busy={busy === 'delete'}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </li>
  );
}

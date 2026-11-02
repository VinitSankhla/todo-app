import { useId, useState, type FormEvent } from 'react';
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  validateTask,
  type TaskErrors,
  type TaskInput,
} from '../../shared/task-validation';
import { focusFirstError } from '../lib/forms';
import { getTaskErrorMessage } from '../lib/task-api';
import { Alert, Button, TextAreaField, TextField } from './ui';

const EMPTY_TASK: TaskInput = { title: '', description: '', dueDate: '' };

interface TaskFormProps {
  /** Starting values (edit mode). Omit for an empty "add" form. */
  initial?: TaskInput;
  submitLabel: string;
  /** Called with trimmed, validated values. Throw to show an error in the form. */
  onSubmit: (input: TaskInput) => Promise<void>;
  onCancel?: () => void;
  /** Clear the fields after a successful submit (used by the "add" form). */
  resetOnSuccess?: boolean;
}

export function TaskForm({
  initial = EMPTY_TASK,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
}: TaskFormProps) {
  const prefix = useId();
  const [form, setForm] = useState<TaskInput>(initial);
  const [errors, setErrors] = useState<TaskErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof TaskInput) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitError('');
    const validationErrors = validateTask(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      focusFirstError(formElement);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description.trim(),
        dueDate: form.dueDate,
      });
      if (resetOnSuccess) {
        setForm(EMPTY_TASK);
        formElement.querySelector<HTMLInputElement>('input')?.focus();
      }
    } catch (error) {
      setSubmitError(getTaskErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-3">
      {submitError && <Alert kind="error">{submitError}</Alert>}
      <TextField
        id={`${prefix}-title`}
        label="Title"
        maxLength={TITLE_MAX_LENGTH + 50}
        value={form.title}
        onChange={(e) => update('title')(e.target.value)}
        error={errors.title}
      />
      <TextAreaField
        id={`${prefix}-description`}
        label="Description"
        optional
        maxLength={DESCRIPTION_MAX_LENGTH + 100}
        value={form.description}
        onChange={(e) => update('description')(e.target.value)}
        error={errors.description}
      />
      <TextField
        id={`${prefix}-dueDate`}
        label="Due date"
        type="date"
        optional
        value={form.dueDate}
        onChange={(e) => update('dueDate')(e.target.value)}
        error={errors.dueDate}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

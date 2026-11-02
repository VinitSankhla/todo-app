// Task input rules for the browser. The server enforces the same limits in
// amplify/data/add-task.js and edit-task.js (kept in sync by amplify/data/resolvers.test.ts).

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;
const DUE_DATE_MIN_YEAR = 2000;
const DUE_DATE_MAX_YEAR = 2100;

export function validateTitle(title: string): string | null {
  const value = title.trim();
  if (!value) return 'Title is required.';
  if (value.length > TITLE_MAX_LENGTH) {
    return `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export function validateDescription(description: string): string | null {
  if (description.trim().length > DESCRIPTION_MAX_LENGTH) {
    return `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

/** Due date is optional. When given it must be a real YYYY-MM-DD date between 2000 and 2100. */
export function validateDueDate(dueDate: string): string | null {
  if (!dueDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return 'Due date must be in YYYY-MM-DD format.';
  const date = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dueDate) {
    return 'Due date is not a real date.';
  }
  const year = date.getUTCFullYear();
  if (year < DUE_DATE_MIN_YEAR || year > DUE_DATE_MAX_YEAR) {
    return `Due date must be between ${DUE_DATE_MIN_YEAR} and ${DUE_DATE_MAX_YEAR}.`;
  }
  return null;
}

export interface TaskInput {
  title: string;
  description: string;
  dueDate: string;
}

export type TaskErrors = Partial<Record<keyof TaskInput, string>>;

export function validateTask(input: TaskInput): TaskErrors {
  const errors: TaskErrors = {};
  const title = validateTitle(input.title);
  const description = validateDescription(input.description);
  const dueDate = validateDueDate(input.dueDate);
  if (title) errors.title = title;
  if (description) errors.description = description;
  if (dueDate) errors.dueDate = dueDate;
  return errors;
}

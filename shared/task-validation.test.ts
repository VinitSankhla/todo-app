import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  validateDescription,
  validateDueDate,
  validateTask,
  validateTitle,
} from './task-validation';

describe('validateTitle', () => {
  it('requires a non-blank title', () => {
    expect(validateTitle('')).toBe('Title is required.');
    expect(validateTitle('   ')).toBe('Title is required.');
    expect(validateTitle('Buy milk')).toBeNull();
  });

  it('limits the trimmed length', () => {
    expect(validateTitle('a'.repeat(TITLE_MAX_LENGTH))).toBeNull();
    expect(validateTitle(` ${'a'.repeat(TITLE_MAX_LENGTH)} `)).toBeNull();
    expect(validateTitle('a'.repeat(TITLE_MAX_LENGTH + 1))).toMatch(/200 characters/);
  });
});

describe('validateDescription', () => {
  it('is optional but limited in length', () => {
    expect(validateDescription('')).toBeNull();
    expect(validateDescription('a'.repeat(DESCRIPTION_MAX_LENGTH))).toBeNull();
    expect(validateDescription('a'.repeat(DESCRIPTION_MAX_LENGTH + 1))).toMatch(/2000/);
  });
});

describe('validateDueDate', () => {
  it.each(['', '2026-12-31', '2000-01-01', '2100-12-31', '2028-02-29'])('accepts %j', (d) => {
    expect(validateDueDate(d)).toBeNull();
  });

  it.each([
    ['31/12/2026', 'Due date must be in YYYY-MM-DD format.'],
    ['2026-02-30', 'Due date is not a real date.'],
    ['2027-02-29', 'Due date is not a real date.'],
    ['1999-12-31', 'Due date must be between 2000 and 2100.'],
    ['2101-01-01', 'Due date must be between 2000 and 2100.'],
  ])('rejects %j', (d, message) => {
    expect(validateDueDate(d)).toBe(message);
  });
});

describe('validateTask', () => {
  it('collects all field errors', () => {
    expect(validateTask({ title: '', description: 'a'.repeat(2001), dueDate: 'x' })).toEqual({
      title: 'Title is required.',
      description: 'Description must be 2000 characters or fewer.',
      dueDate: 'Due date must be in YYYY-MM-DD format.',
    });
    expect(validateTask({ title: 'Ok', description: '', dueDate: '' })).toEqual({});
  });
});
